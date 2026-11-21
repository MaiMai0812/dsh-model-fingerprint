// dsh-model-fingerprint — 检测器数据的读取与解码。
//
// 数据来自 https://lm.ikale.io/data/ 的两个文件：
//   bundle.json        模型清单（id / display_name / family / response_count）
//   shared_detector.bin  打包好的检测器（JSON 头 + 按位置分组的 float32）
//
// 插件随包带一份数据副本，首次使用时校验；缺失或损坏时按 manifest 里的
// zst 分片重新下载，解压后落到 $DSH_HOME/storages/dsh-model-fingerprint/。
//
// 刷新（refresh）之后拿到的那份 bundle.json 与检测器都会留在缓存目录里，
// 下次启动按 built_at 比一比：缓存比随包副本新就用缓存的，否则用随包的。
// 否则刷新过的新数据会在重启后又被包内旧副本顶掉。
// 数据格式与官方 shared_detector-codec.ts 完全一致。

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import zlib from 'node:zlib'

const DATA_ORIGIN = 'https://lm.ikale.io/data'
const CACHE_DIR_NAME = 'dsh-model-fingerprint'

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function cacheDir() {
  return path.join(dshHome(), 'storages', CACHE_DIR_NAME)
}

/**
 * 解码 shared_detector.bin。
 * 布局：u32 LE 头长度 → UTF-8 JSON 头 → 4 字节对齐后的 float32 数组。
 * float 不是顺序排列的，而是按“字节位置”分组：第 b 个字节整体排在
 * data[start + b * count + i]，取回时要重新交织。
 */
export function decodeDetector(data) {
  const view = Buffer.isBuffer(data) ? data : Buffer.from(data)
  if (view.length < 8) throw new Error('检测器文件过短。')
  const headerLength = view.readUInt32LE(0)
  if (headerLength <= 0 || 4 + headerLength > view.length) throw new Error('检测器头长度无效。')
  const start = Math.ceil((4 + headerLength) / 4) * 4
  const count = Math.floor((view.length - start) / 4)
  if (count <= 0) throw new Error('检测器没有浮点数据。')
  const interleaved = Buffer.alloc(count * 4)
  for (let b = 0; b < 4; b++) {
    for (let i = 0; i < count; i++) interleaved[i * 4 + b] = view[start + b * count + i]
  }
  const floats = new Float32Array(count)
  for (let i = 0; i < count; i++) floats[i] = interleaved.readFloatLE(i * 4)
  const header = view.subarray(4, 4 + headerLength).toString('utf8')
  return JSON.parse(header, (_, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && '$f32' in value) {
      return Array.from(floats.subarray(value.$f32, value.$f32 + value.n))
    }
    return value
  })
}

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

/** 本地数据目录：包内 data/ 与缓存目录（相同时不再重复）。 */
function candidateDirs(packageRoot) {
  const packaged = path.join(packageRoot, 'data')
  const cached = cacheDir()
  return packaged === cached ? [packaged] : [packaged, cached]
}

function readIfPresent(file) {
  try {
    return fs.readFileSync(file)
  } catch {
    return null
  }
}

/** 读一份 bundle.json；不存在或不是合法 JSON 就返回 null。 */
function readBundle(dir) {
  const buffer = readIfPresent(path.join(dir, 'bundle.json'))
  if (!buffer || buffer.length === 0) return null
  try {
    const bundle = JSON.parse(buffer.toString('utf8'))
    if (!bundle || typeof bundle !== 'object') return null
    return { dir, buffer, bundle }
  } catch {
    return null
  }
}

/** bundle 的构建时间（毫秒）；解析不出来当 0，比较时自然排最后。 */
function builtAtTime(bundle) {
  const value = Date.parse(String(bundle?.built_at ?? ''))
  return Number.isFinite(value) ? value : 0
}

async function writeAtomic(file, buffer) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  await fsp.writeFile(temp, buffer)
  await fsp.rename(temp, file)
}

async function download(url, timeoutMs = 60000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status} ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

function zstd(buffer) {
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('当前 Node 运行时不支持 zstd 解压，请改用随包数据。')
  }
  return zlib.zstdDecompressSync(buffer)
}

/**
 * 按 manifest 里的分片列表下载并拼装一个数据文件。
 *
 * 分片是按「压缩后字节」切流的：所有 chunk 先接起来才是完整的 zstd 帧，
 * 单独解一个 4 MB 的 .0.zst 只会报 unexpected end of file。
 * 所以先把字节拼齐再解压；万一上游真的改成一片一帧，再退回逐片解压。
 */
async function fetchPart(entry) {
  const parts = []
  for (const part of entry.parts || []) {
    parts.push(await download(`${DATA_ORIGIN}/chunks/${part}`))
  }
  const joined = Buffer.concat(parts)
  try {
    return zstd(joined)
  } catch (error) {
    if (parts.length <= 1) throw error
    const decoded = []
    for (const part of parts) decoded.push(zstd(part))
    return Buffer.concat(decoded)
  }
}

async function ensureCacheFile(file, entry) {
  const existing = readIfPresent(file)
  if (existing && (!entry.sha256 || sha256(existing) === entry.sha256)) return existing
  const fetched = await fetchPart(entry)
  if (entry.sha256 && sha256(fetched) !== entry.sha256) {
    throw new Error('下载的数据校验失败（sha256 不符）。')
  }
  await writeAtomic(file, fetched)
  return fetched
}

/**
 * 读取并解码检测器。返回 { artifact, bundle, source, detectorBytes }。
 *
 * `refresh` 为真时忽略本地副本，直接从上游拉最新数据，并把拉到的 bundle.json
 * 一起写进缓存目录 —— 只写检测器不写清单的话，重启后又会先命中包内那份旧清单，
 * 旧清单的 sha256 只认得旧的检测器，等于把刷新过的数据整个丢掉。
 */
export async function loadDetector(packageRoot, options = {}) {
  const refresh = options.refresh === true
  const dirs = candidateDirs(packageRoot)
  const packageDir = dirs[0]
  const cacheRoot = dirs[dirs.length - 1]
  const useCache = cacheRoot !== packageDir || refresh

  const parse = (buffer) => {
    try {
      return JSON.parse(buffer.toString('utf8'))
    } catch {
      throw new Error('bundle.json 不是合法 JSON。')
    }
  }

  let chosen = null
  if (refresh) {
    const buffer = await download(`${DATA_ORIGIN}/bundle.json`)
    const bundle = parse(buffer)
    chosen = { dir: cacheRoot, buffer, bundle }
    await writeAtomic(path.join(cacheRoot, 'bundle.json'), buffer).catch(() => {
      // 写不进缓存也不影响这一次使用，只是下次启动又得重新下载
    })
  } else {
    const local = dirs.map(readBundle).filter(Boolean)
    if (local.length === 0) {
      const buffer = await download(`${DATA_ORIGIN}/bundle.json`)
      const bundle = parse(buffer)
      chosen = { dir: cacheRoot, buffer, bundle }
      await writeAtomic(path.join(cacheRoot, 'bundle.json'), buffer).catch(() => {})
    } else {
      // 谁 built_at 更新用谁：刷新过的新清单在缓存里，随包升级后的新清单在包内
      chosen = local.reduce((best, item) => (builtAtTime(item.bundle) > builtAtTime(best.bundle) ? item : best))
    }
  }

  const bundle = chosen.bundle
  const entry = bundle?.files?.['shared_detector.bin']
  if (!entry) throw new Error('bundle.json 里没有 shared_detector.bin 条目。')
  const wanted = typeof entry.sha256 === 'string' ? entry.sha256 : ''

  // 只接受 sha256 与所选清单一致的那份检测器，否则等于拿两版数据算分。
  // 与清单同目录的副本优先，另一处兜底。
  const order = chosen.dir === cacheRoot && useCache
    ? [cacheRoot, packageDir].filter((dir, index, list) => list.indexOf(dir) === index)
    : [packageDir, cacheRoot].filter((dir, index, list) => list.indexOf(dir) === index)
  let detectorBuffer = null
  let source = 'package'
  for (const dir of order) {
    const buffer = readIfPresent(path.join(dir, 'shared_detector.bin'))
    if (!buffer || buffer.length === 0) continue
    if (wanted && sha256(buffer) !== wanted) continue
    detectorBuffer = buffer
    source = dir === cacheRoot && dir !== packageDir ? 'cache' : 'package'
    break
  }
  if (!detectorBuffer) {
    source = 'cache'
    detectorBuffer = await ensureCacheFile(path.join(cacheRoot, 'shared_detector.bin'), entry)
  }

  const artifact = decodeDetector(detectorBuffer)
  return { artifact, bundle, source, detectorBytes: detectorBuffer.length }
}

/** 检测器与模型清单是否对得上（官方 supportsSharedDetector 的三重校验）。 */
export function supportsSharedDetector(bundle, artifact) {
  if (!artifact || artifact.schema !== 'shared-detector-v2') return false
  if (!bundle || bundle.built_at !== artifact.bank_built_at) return false
  const models = Array.isArray(bundle.models) ? bundle.models : []
  if (models.length !== artifact.model_ids.length) return false
  return models.every((model, index) => {
    if (model.id !== artifact.model_ids[index]) return false
    const expected = artifact.response_counts?.[index]
    return expected === undefined || model.response_count === expected
  })
}

/** 把 artifact 里的 id 与 bundle 里的展示名对上，供 UI 和工具输出使用。 */
export function modelDirectory(bundle, artifact) {
  const byId = new Map((bundle?.models || []).map((model) => [model.id, model]))
  return artifact.model_ids.map((id) => {
    const model = byId.get(id)
    return {
      id,
      display_name: model?.display_name || id,
      family: model?.family || '',
      family_name: model?.family_name || '',
      response_count: model?.response_count ?? 0,
    }
  })
}
