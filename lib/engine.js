// dsh-model-fingerprint — 检测引擎。
//
// 把「生成提示词 → 通过宿主已接入的模型取样 → 算分 → 出排名」串成一次作业，
// 供设置页的后台作业使用。取样走 lib/llm.js（宿主的 llm 服务），所以插件
// 不需要任何 baseURL / apiKey。作业状态放在内存里，历史记录落到
// $DSH_HOME/storages/dsh-model-fingerprint/state.json。

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { generateChallenges } from './challenge.js'
import { cacheDir, loadDetector, modelDirectory, supportsSharedDetector } from './detector.js'
import { analyzeOutputs, minimumNumbers, parseNumbers } from './fingerprint.js'
import { collectSamples } from './llm.js'

const STATE_VERSION = 2
// 总览要按「provider/model 取最新一次」铺开，所以留够每次测过的模型的记录
const HISTORY_LIMIT = 400
const JOB_TTL_MS = 30 * 60 * 1000

export const DEFAULT_CONFIG = {
  provider: '',
  model: '',
  effort: '',
  samples: 3,
  parallel: true,
  relaxed: true,
}

export function normalizeConfig(input) {
  const source = input && typeof input === 'object' ? input : {}
  const samples = Number(source.samples)
  return {
    provider: String(source.provider ?? '').trim(),
    model: String(source.model ?? '').trim(),
    effort: String(source.effort ?? '').trim(),
    samples: Number.isFinite(samples) ? Math.min(3, Math.max(1, Math.trunc(samples))) : 3,
    parallel: source.parallel !== false,
    relaxed: source.relaxed !== false,
  }
}

function stateFile() {
  return path.join(cacheDir(), 'state.json')
}

// 模型目录单独存一份：面板每次打开都要用，但扫描一遍要问遍所有 provider（几百毫秒），
// 而且它跟「配置 / 历史 / 最近结果」没有关系，没必要挤在同一份 state.json 里互相覆盖。
function catalogFile() {
  return path.join(cacheDir(), 'catalog.json')
}

function emptyState() {
  return { version: STATE_VERSION, config: { ...DEFAULT_CONFIG }, history: [], lastRun: null, savedAt: null }
}

// 目录里只留面板要用的字段：宿主 provider 对象上还挂着别的东西，没必要抄进 state.json
function normalizeCatalog(input) {
  if (!input || !Array.isArray(input.providers)) return null
  return {
    providers: input.providers.map(provider => ({
      id: String(provider?.id ?? ''),
      name: String(provider?.name ?? provider?.id ?? ''),
      error: provider?.error ? String(provider.error) : null,
      models: (Array.isArray(provider?.models) ? provider.models : []).map(model => ({
        id: String(model?.id ?? ''),
        name: String(model?.name ?? model?.id ?? ''),
        description: model?.description ? String(model.description) : '',
        badge: model?.badge ? String(model.badge) : '',
      })),
    })),
    default: input.default && input.default.provider && input.default.model
      ? {
          provider: String(input.default.provider),
          model: String(input.default.model),
          effort: input.default.effort ? String(input.default.effort) : '',
        }
      : null,
  }
}

export function readState() {
  try {
    const raw = fs.readFileSync(stateFile(), 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== STATE_VERSION) return emptyState()
    return {
      version: STATE_VERSION,
      config: normalizeConfig(parsed.config),
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, HISTORY_LIMIT) : [],
      lastRun: parsed.lastRun && typeof parsed.lastRun === 'object' ? parsed.lastRun : null,
      savedAt: parsed.savedAt ?? null,
    }
  } catch {
    return emptyState()
  }
}

let writeSeq = 0
let writeQueue = Promise.resolve()

async function writeState(state) {
  const file = stateFile()
  await fsp.mkdir(path.dirname(file), { recursive: true })
  // 每次写用不同的临时名：检测结束时会连着写两次（记 history、记最近结果），
  // 同名临时文件会被先完成的那次 rename 走掉，后一次就 ENOENT。
  const temp = `${file}.${process.pid}.${(writeSeq += 1)}.tmp`
  await fsp.writeFile(temp, JSON.stringify({ ...state, savedAt: new Date().toISOString() }, null, 2), 'utf8')
  await fsp.rename(temp, file)
}

// 改 state 一律排队执行：读、改、写三步在队列里完成，后一次才不会拿着旧快照
// 把前一次刚写进去的内容盖掉（检测结束会连续写「历史」和「最近结果」两份）。
function withState(mutate) {
  const run = writeQueue.then(async () => {
    const state = readState()
    const next = (await mutate(state)) || state
    await writeState(next)
    return next
  })
  writeQueue = run.catch(() => {})
  return run
}

export async function saveConfig(config) {
  const state = await withState(current => {
    current.config = normalizeConfig(config)
  })
  return state.config
}

export async function clearHistory() {
  return withState(state => {
    state.history = []
  })
}

const EMPTY_CATALOG = { providers: [], default: null, scanned_at: null }

/**
 * 上一次扫到的模型目录。面板打开时先拿这份显示，不再自己去扫一遍宿主——
 * 扫一遍要挨个问 provider（实测 80 来个 provider 约 300 ms，慢的 provider 更久），
 * 每次开面板都等它没必要。用户点「重新扫描」才重新问宿主。
 */
export function readCatalog() {
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogFile(), 'utf8'))
    const normalized = normalizeCatalog(parsed)
    if (!normalized) return { ...EMPTY_CATALOG }
    const scannedAt = typeof parsed.scanned_at === 'string' ? parsed.scanned_at : null
    return { ...normalized, scanned_at: scannedAt }
  } catch {
    return { ...EMPTY_CATALOG }
  }
}

/** 扫描结果落盘。跟 state.json 分开存，两边互不覆盖。 */
export async function writeCatalog(catalog) {
  const normalized = normalizeCatalog(catalog)
  if (!normalized) throw new Error('目录格式不对。')
  const payload = { ...normalized, scanned_at: new Date().toISOString() }
  const file = catalogFile()
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  await fsp.writeFile(temp, JSON.stringify(payload, null, 2), 'utf8')
  await fsp.rename(temp, file)
  return payload
}

/**
 * 只留还在目录里的模型：某个模型从宿主里删掉之后，它那条测试记录也一起清掉，
 * 总览里不再留一行已经删掉的模型。`providers` 就是 /catalog 那份清单。
 *
 * 两个保底：
 * - 目录整个是空的（宿主还没接任何模型，或者这次没读到）时不动手，免得把历史全删了；
 * - 某个 provider 这次没读到模型清单（`error` 非空）时，它名下的记录先留着，
 *   读失败不等于模型被删。
 *
 * @returns 删掉的行数。
 */
export async function pruneHistory(providers) {
  const list = Array.isArray(providers) ? providers : []
  if (list.length === 0) return 0
  const keep = new Set()
  const unknown = new Set()
  for (const provider of list) {
    if (!provider || !provider.id) continue
    if (provider.error) unknown.add(provider.id)
    for (const model of Array.isArray(provider.models) ? provider.models : []) {
      if (model && model.id) keep.add(`${provider.id}\u0000${model.id}`)
    }
  }
  if (keep.size === 0 && unknown.size === 0) return 0
  const stale = (row) => {
    if (!row || !row.provider || !row.model) return true
    if (unknown.has(row.provider)) return false
    return !keep.has(`${row.provider}\u0000${row.model}`)
  }
  // 没有要删的就不写盘：面板每次打开都会问一遍目录，没必要为此改写 state.json
  if (!readState().history.some(stale)) return 0
  let removed = 0
  await withState((current) => {
    const before = current.history.length
    current.history = current.history.filter(row => !stale(row))
    removed = before - current.history.length
  })
  return removed
}

// 解码一份 4 MB 检测器要几百毫秒，一次检测里会被问好几遍（detect / retry / library）。
// 这里留一份缓存，refresh 时覆盖。
const infoCache = new Map()
/** 检测器与参考库清单：带上展示名，供 UI 复用。 */
export async function detectorInfo(packageRoot, options = {}) {
  const key = packageRoot
  if (!options.refresh && infoCache.has(key)) return infoCache.get(key)
  const loaded = await loadDetector(packageRoot, options)
  const supported = supportsSharedDetector(loaded.bundle, loaded.artifact)
  const info = {
    artifact: loaded.artifact,
    bundle: loaded.bundle,
    source: loaded.source,
    supported,
    builtAt: loaded.bundle?.built_at ?? loaded.artifact?.bank_built_at ?? '',
    bytes: loaded.detectorBytes,
    models: modelDirectory(loaded.bundle, loaded.artifact),
  }
  infoCache.set(key, info)
  return info
}

/** 把 artifact 里的 id 换成展示名，UI 就用同一份形状。 */
function describeResults(results, models) {
  const byId = new Map(models.map((model) => [model.id, model]))
  return results.map((result) => {
    const model = byId.get(result.id)
    return {
      id: result.id,
      display_name: model?.display_name || result.id,
      family_name: model?.family_name || '',
      response_count: model?.response_count ?? 0,
      score: result.score,
      probability: result.probability,
    }
  })
}

function summarize(analysis, models, extra) {
  if (analysis.decision === 'unscorable' || analysis.decision === 'not_model') {
    return {
      decision: analysis.decision,
      reason: analysis.reason,
      used_outputs: analysis.used_outputs,
      sequence: analysis.sequence ?? null,
      diagnostics: analysis.diagnostics,
      results: [],
      top: null,
      ...extra,
    }
  }
  const results = describeResults(analysis.results, models)
  return {
    decision: analysis.decision,
    used_outputs: analysis.used_outputs,
    sequence: analysis.sequence ?? null,
    diagnostics: analysis.diagnostics,
    probability_status: analysis.probability_status,
    results: results.slice(0, 20),
    top: results[0] ?? null,
    ...extra,
  }
}

/** 取样的完整一轮：生成提示词、走宿主模型取样、算分。 */
export async function runDetection(packageRoot, spec, options = {}) {
  const config = normalizeConfig(spec?.config)
  if (!config.provider || !config.model) throw new Error('请先选择要检测的模型。')
  const ctx = options.ctx
  if (!ctx) throw new Error('缺少宿主上下文，无法取样。')
  const report = options.onProgress || (() => {})
  const challenges = Array.isArray(spec?.challenges) && spec.challenges.length > 0
    ? spec.challenges.slice(0, 3).map((challenge, index) => ({
        id: String(challenge.id ?? `probe-${index + 1}`),
        expected_count: Number(challenge.expected_count) || 300,
        prompt: String(challenge.prompt ?? ''),
      }))
    : generateChallenges(config.samples)

  report({
    stage: 'sampling',
    message: '准备取样',
    completed: 0,
    total: challenges.length,
    accepted: 0,
    challenges: challenges.map((challenge) => ({
      id: challenge.id,
      expected_count: challenge.expected_count,
      prompt: challenge.prompt,
      text: '',
      count: 0,
      state: 'pending',
      status: '',
      error: null,
    })),
    outputs: [],
  })

  const collected = await collectSamples(ctx, {
    provider: config.provider,
    model: config.model,
    effort: config.effort,
    challenges,
    parallel: config.parallel,
    relaxed: config.relaxed,
  }, {
    signal: options.signal,
    onProgress: (progress) => report({ stage: 'sampling', ...progress }),
  })

  report({ stage: 'scoring', message: '正在计算指纹', accepted: collected.outputs.length })
  const info = await detectorInfo(packageRoot)
  if (!info.supported) throw new Error('检测器与模型清单不匹配，请刷新数据后重试。')
  const analysis = analyzeOutputs(collected.outputs, info.artifact, { allowPartial: true })
  const summary = summarize(analysis, info.models, {
    provider: config.provider,
    model: config.model,
    effort: config.effort,
    sampled: collected.outputs.length,
  })

  await recordHistory(summary)

  return {
    ...summary,
    challenges: collected.slots,
    builtAt: info.builtAt,
    source: info.source,
    models: info.models,
  }
}

// ---------------------------------------------------------------- 后台作业

/** 用一批已有文本重新算分（重跑单条样本后整体刷新排名，不写历史）。 */
async function analyzeTexts(packageRoot, outputs) {
  const info = await detectorInfo(packageRoot)
  if (!info.supported) throw new Error('检测器与模型清单不匹配，请刷新数据后重试。')
  const prepared = outputs
    .map((output) => ({
      text: String(output.text ?? ''),
      expectedCount: Number(output.expectedCount) || 300,
    }))
    .filter((output) => output.text.trim().length > 0)
  if (prepared.length === 0) throw new Error('没有可检测的回复文本。')
  const analysis = analyzeOutputs(prepared, info.artifact, { allowPartial: true })
  return { analysis, info }
}

/**
 * 只重跑一条样本：用同一条提示词重新取样，再拿「这条的新输出 + 其余未失败样本」
 * 重新排名。返回 { slot, result }，供 UI 原地替换那一张卡片。
 */
export async function retrySample(packageRoot, spec, options = {}) {
  const config = normalizeConfig(spec?.config)
  if (!config.provider || !config.model) throw new Error('请先选择要检测的模型。')
  const ctx = options.ctx
  if (!ctx) throw new Error('缺少宿主上下文，无法取样。')
  const report = options.onProgress || (() => {})
  const source = spec?.challenge
  if (!source || typeof source.prompt !== 'string' || !source.prompt.trim()) {
    throw new Error('缺少要重跑的样本。')
  }
  const challenge = {
    id: String(source.id ?? 'probe-retry'),
    expected_count: Number(source.expected_count) || 300,
    prompt: source.prompt,
  }

  const others = Array.isArray(spec?.outputs) ? spec.outputs : []
  let slot = null
  let lastChallenges = []
  try {
    const collected = await collectSamples(ctx, {
      provider: config.provider,
      model: config.model,
      effort: config.effort,
      challenges: [challenge],
      parallel: false,
      relaxed: config.relaxed,
    }, {
      signal: options.signal,
      onProgress: (progress) => {
        if (Array.isArray(progress?.challenges) && progress.challenges.length > 0) {
          lastChallenges = progress.challenges
        }
        report({ stage: 'sampling', ...progress })
      },
    })
    slot = collected.slots[0] ?? null
    if (Array.isArray(collected.slots) && collected.slots.length > 0) lastChallenges = collected.slots
  } catch (error) {
    // 这一条没拿到合格输出不算整体失败：把卡片刷成「无效 + 原因」，其余样本照旧参与排名
    const reason = error instanceof Error ? error.message : String(error)
    slot = lastChallenges[0] ?? null
    slot = slot
      ? { ...slot, state: 'rejected', status: slot.status || '无效', error: slot.error || reason }
      : {
          id: challenge.id,
          expected_count: challenge.expected_count,
          prompt: challenge.prompt,
          text: '',
          count: 0,
          state: 'rejected',
          status: '无效',
          error: reason,
        }
  }
  if (!slot) {
    slot = {
      id: challenge.id,
      expected_count: challenge.expected_count,
      prompt: challenge.prompt,
      text: '',
      count: 0,
      state: 'rejected',
      status: '无效',
      error: '没有拿到输出',
    }
  }

  report({ stage: 'scoring', message: '正在重新计算指纹', accepted: 1 })
  // 重跑没拿到合格输出时不动排名，只把这张卡片刷成「无效 + 原因」，
  // 免得一次失败的重试把界面上已经算好的结果抹掉。
  const usable = slot.count >= minimumNumbers(challenge.expected_count)
    ? [...others, { text: slot.text, expectedCount: challenge.expected_count }]
    : []
  if (usable.length === 0) return { slot, result: null }
  const { analysis, info } = await analyzeTexts(packageRoot, usable)
  const summary = summarize(analysis, info.models, {
    provider: config.provider,
    model: config.model,
    effort: config.effort,
    sampled: analysis.used_outputs,
  })

  return {
    ...summary,
    slot,
    result: summary,
    builtAt: info.builtAt,
    source: info.source,
  }
}

const jobs = new Map()

// 最近一次跑完的检测结果。面板切成别的页面时组件会被卸载，回来时组件状态已经没了，
// 靠这份快照把「上次的样本卡片 + 排名」原样摆回界面上（作业本身跑完就过期了，这里单独留一份）。
// 只留一份，不参与 JOB_TTL_MS 过期，下次检测覆盖。
let lastRun = null

// 快照落盘：面板重新打开时哪怕宿主进程已经重启过，也还能把上次结果摆回来。
// 走 withState 排队，免得和后一步刚写的 history 互相覆盖。
function persistLastRun(snapshot) {
  lastRun = snapshot
  withState(state => {
    state.lastRun = snapshot
  }).catch(() => {
    // 落盘失败不影响内存里的快照
  })
}

function rememberRun(job) {
  if (job.mode !== 'detect' || job.status !== 'done' || !job.result) return
  // models 是整份参考库清单（70 个模型），面板恢复用不到，落盘时剔掉免得 state.json 变大
  const { models: _models, ...result } = job.result
  persistLastRun({
    id: job.id,
    mode: job.mode,
    index: null,
    status: 'done',
    created_at: job.createdAt,
    finished_at: Date.now(),
    progress: { stage: 'done', message: '检测完成' },
    result,
    error: null,
  })
}

// 单条重跑结束后把新卡片和重算后的排名并回上次结果，
// 这样切走再回来看到的是重跑之后的界面，而不是重跑之前的。
//
// 允许同时重试多条之后，每条作业发出去的时候带的是「点击那一刻」其他样本的文本，
// 先跑完的那条会把还没跑完的那条的旧文本算进排名里。所以这里不用作业自己算好的
// 那份 summary，而是拿合并后的全部样本文本重算一遍，排名才和卡片上看到的一致。
// 重算失败就退回作业自己算的那份，至少卡片是新的。
async function mergeRetry(job, packageRoot) {
  if (job.mode !== 'retry' || !job.result) return
  const payload = job.result
  const index = Number.isInteger(job.index) ? job.index : null
  const base = lastRun || null
  const previous = base?.result || {}
  const challenges = Array.isArray(previous.challenges) ? previous.challenges.slice() : []
  if (payload.slot && index !== null) {
    challenges[index] = { ...(challenges[index] || {}), ...payload.slot }
  }
  const raw = payload.result || (payload.decision ? payload : null)
  let summary = null
  if (raw) {
    // retrySample 的返回是 { ...summary, slot, result: summary }，这里只要排名字段
    const { slot: _slot, result: _nested, ...rest } = raw
    summary = rest
  }
  const usable = challenges
    .filter(slot => slot && (slot.state === 'done' || slot.state === 'capped'))
    .filter(slot => typeof slot.text === 'string' && slot.text.trim().length > 0)
    .filter(slot => Number(slot.count) >= minimumNumbers(Number(slot.expected_count) || 300))
    .map(slot => ({ text: slot.text, expectedCount: Number(slot.expected_count) || 300 }))
  if (usable.length > 0) {
    try {
      const { analysis, info } = await analyzeTexts(packageRoot, usable)
      summary = summarize(analysis, info.models, {
        provider: payload.provider ?? previous.provider ?? '',
        model: payload.model ?? previous.model ?? '',
        effort: payload.effort ?? previous.effort ?? '',
        sampled: analysis.used_outputs,
      })
    } catch {
      // 重算失败：用作业自己算好的那份
    }
  }
  const result = { ...previous, ...(summary || {}), challenges }
  const snapshot = base || {
    id: job.id,
    mode: 'retry',
    index: null,
    status: 'done',
    created_at: job.createdAt,
    progress: { stage: 'done', message: '检测完成' },
  }
  persistLastRun({ ...snapshot, finished_at: Date.now(), status: 'done', result, error: null })
  // 重跑把「部分样本」补成了带概率的校准排名时，历史里那一行也要跟着换掉，
  // 否则界面上方已经有百分比、下方总览还写着部分样本。
  await recordHistory(result, { onlyWhenCalibrated: true })
}

/**
 * 把一次算好的结果写成历史的一条（同一 provider/model 只留最新的一条）。
 * `onlyWhenCalibrated`：重跑合并时只有补出校准概率才动历史——没概率的那次
 * 不该把历史里已有的一条覆盖成「部分样本」。
 */
async function recordHistory(summary, options = {}) {
  if (!summary || !summary.provider || !summary.model) return
  const probability = summary.top && typeof summary.top.probability === 'number' && Number.isFinite(summary.top.probability)
    ? summary.top.probability
    : null
  if (options.onlyWhenCalibrated && probability === null) return
  const row = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    provider: summary.provider,
    model: summary.model,
    decision: summary.decision,
    used_outputs: summary.used_outputs,
    top: summary.top
      ? { id: summary.top.id, display_name: summary.top.display_name, probability }
      : null,
  }
  await withState((current) => {
    current.history = [
      row,
      ...current.history.filter(item => !(item && item.provider === row.provider && item.model === row.model)),
    ].slice(0, HISTORY_LIMIT)
  })
}

// 重试的合并要一条一条来：并发重试时两条作业同时读改写 lastRun 会互相盖掉。
let mergeQueue = Promise.resolve()

function queueMerge(job, packageRoot) {
  const run = mergeQueue.then(() => mergeRetry(job, packageRoot)).catch(() => {})
  mergeQueue = run
  return run
}

/** 面板挂载时拿它恢复上一次的检测界面；没有就返回 null。 */
export function lastJob() {
  if (lastRun) return lastRun
  // 内存里没有（宿主重启过）就去落盘的那份里找
  const stored = readState().lastRun
  if (stored && stored.result) lastRun = stored
  return lastRun
}

function pruneJobs() {
  const now = Date.now()
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > JOB_TTL_MS) jobs.delete(id)
  }
}

export function startJob(packageRoot, spec, options = {}) {
  pruneJobs()
  const id = crypto.randomUUID()
  const mode = spec?.mode === 'retry' ? 'retry' : 'detect'
  const job = {
    id,
    mode,
    // 单条重跑要知道自己对应界面上第几张卡片，页面重开接回作业时靠它归位
    index: Number.isInteger(spec?.index) ? spec.index : null,
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    progress: { stage: 'starting', message: '准备中' },
    result: null,
    error: null,
    controller: new AbortController(),
  }
  jobs.set(id, job)
  const runner = mode === 'retry' ? retrySample : runDetection
  const run = runner(packageRoot, spec, {
    ctx: options.ctx,
    signal: job.controller.signal,
    onProgress: (progress) => {
      job.progress = progress
      job.updatedAt = Date.now()
    },
  })
  run
    .then(async (result) => {
      job.result = result
      try {
        // 重试要并回快照之后才算完成：客户端看到 done 时拿到的排名已经是合并后的那份，
        // 同时重试好几条时也是一条一条排队合并，不会互相覆盖。
        if (mode === 'retry') {
          await queueMerge(job, packageRoot)
          if (lastRun && lastRun.result) job.result = { ...result, merged: lastRun.result }
        }
      } finally {
        job.status = 'done'
        job.progress = { stage: 'done', message: '检测完成' }
        job.updatedAt = Date.now()
        if (mode !== 'retry') rememberRun(job)
      }
    })
    .catch((error) => {
      job.status = 'error'
      job.error = error instanceof Error ? error.message : String(error)
      job.progress = { stage: 'error', message: job.error }
      job.updatedAt = Date.now()
    })
  return id
}

function describeJob(job) {
  return {
    id: job.id,
    mode: job.mode,
    index: job.index,
    status: job.status,
    created_at: job.createdAt,
    progress: job.progress,
    result: job.result,
    error: job.error,
    elapsed_ms: Date.now() - job.createdAt,
  }
}

export function readJob(id) {
  const job = jobs.get(id)
  if (!job) return null
  return describeJob(job)
}

// 页面关掉再打开时，用它把还没跑完的作业接回来继续显示进度。
// 作业本来就活在 Host 进程里，这里只是把「当前在跑的」都找出来：
// 允许同时重试多条之后，running 的作业可能不止一个。
export function activeJobs() {
  pruneJobs()
  const running = []
  for (const job of jobs.values()) {
    if (job.status !== 'running') continue
    running.push(job)
  }
  running.sort((a, b) => b.createdAt - a.createdAt)
  return running.map(describeJob)
}

/** 最新一个还在跑的作业（检测只可能有一个，兼容旧的单作业接回逻辑）。 */
export function activeJob() {
  const all = activeJobs()
  return all.length > 0 ? all[0] : null
}

export function cancelJob(id) {
  const job = jobs.get(id)
  if (!job) return false
  job.controller.abort()
  job.status = 'cancelled'
  job.progress = { stage: 'cancelled', message: '已停止' }
  job.updatedAt = Date.now()
  return true
}

export { generateChallenges, minimumNumbers, parseNumbers }
