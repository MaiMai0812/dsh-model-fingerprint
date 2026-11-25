// dsh-model-fingerprint — Host 半边。
//
// 负责：读取/解码检测器数据、通过宿主已接入的模型取样、算分、把作业状态
// 推给浏览器半边。
//
// 取样不经过任何 baseURL/apiKey：模型来自宿主 `llm` 服务里注册的 provider，
// 和你在这台 DSH 里选模型用的是同一条链路。浏览器半边（client.js）只做
// 渲染，所有网络与持久化都在这里。

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_CONFIG,
  activeJob,
  activeJobs,
  cancelJob,
  clearHistory,
  detectorInfo,
  generateChallenges,
  lastJob,
  pruneHistory,
  readCatalog,
  readJob,
  readState,
  saveConfig,
  startJob,
  writeCatalog,
} from './lib/engine.js'
import { defaultSelection, listCatalog, modelDetail } from './lib/llm.js'

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url))
const ROUTE_PREFIX = '/dsh-model-fingerprint'
const MAX_BODY_BYTES = 2 * 1024 * 1024

// ---------------------------------------------------------------- HTTP 工具

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  const host = req.headers.host
  if (!host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('请求体过大。')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function apply(ctx, config = {}) {
  const state = {
    info: null,
    loading: null,
  }

  const loadInfo = async (options = {}) => {
    if (!options.refresh && state.info) return state.info
    if (!options.refresh && state.loading) return state.loading
    const task = detectorInfo(PACKAGE_ROOT, options)
      .then((info) => {
        state.info = info
        return info
      })
      .finally(() => {
        state.loading = null
      })
    state.loading = task
    return task
  }

  const describeDetector = (info) => ({
    ready: info.supported,
    source: info.source,
    built_at: info.builtAt,
    models: info.models.length,
    bytes: info.bytes,
  })

  ctx.effect(() => {
    loadInfo().catch(() => {})
    return () => {
      state.info = null
    }
  }, 'dsh-model-fingerprint: warm detector')

  // ------------------------------------------------------------ Web 路由

  ctx.inject(['webServer'], (wctx) => {
    wctx.effect(() => {
      const routes = []
      const register = (routePath, handler) => {
        try {
          routes.push(wctx.webServer.register({ kind: 'exact', path: ROUTE_PREFIX + routePath, handler }))
        } catch {
          /* 路由已被别的实例占用 */
        }
      }
      const guarded = (handler) => async (req, res) => {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, message: '已拒绝跨站请求。' })
        try {
          return await handler(req, res)
        } catch (error) {
          const status = error?.statusCode || 500
          return sendJson(res, status, { ok: false, message: error?.message || String(error) })
        }
      }
      const post = (handler) => guarded(async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, message: 'POST only' })
        return handler(req, res)
      })

      register('/state', guarded(async (req, res) => {
        const stored = readState()
        let info = state.info
        if (!info) {
          try {
            info = await loadInfo()
          } catch (error) {
            return sendJson(res, 200, {
              ok: true,
              config: stored.config,
              defaults: DEFAULT_CONFIG,
              history: stored.history,
              detector: { ready: false, error: error?.message || String(error) },
              selection: defaultSelection(ctx),
              active: activeJob(),
            })
          }
        }
        sendJson(res, 200, {
          ok: true,
          config: stored.config,
          defaults: DEFAULT_CONFIG,
          history: stored.history,
          detector: describeDetector(info),
          selection: defaultSelection(ctx),
          active: activeJob(),
        })
      }))

      // 页面重新打开时用：把还在后台跑的作业接回来；顺便把上一次跑完的结果也给它，
      // 面板切走再切回时用它还原样本卡片和排名。
      // `jobs` 是全部在跑的作业（允许同时重试多条，`job` 只留最新那一个给旧逻辑）。
      register('/active', guarded(async (req, res) => {
        sendJson(res, 200, { ok: true, job: activeJob(), jobs: activeJobs(), last: lastJob() })
      }))

      // 宿主已经接入的 provider 与模型。两条路径：
      //   GET  —— 只回上一次扫到的那份（面板打开时用，几毫秒，不去问宿主）；
      //   POST —— 真的重新扫一遍（问遍所有 provider，几百毫秒），落盘后回新的那份。
      // 顺手把「已经不在目录里的模型」的旧记录清掉：总览只该显示这台 DSH 上还剩的
      // 模型，删掉的模型不该继续占一行。
      register('/catalog', guarded(async (req, res) => {
        if (req.method !== 'POST') {
          return sendJson(res, 200, {
            ok: true,
            ...readCatalog(),
            cached: true,
            history: readState().history,
          })
        }
        const catalog = await listCatalog(ctx)
        const pruned = await pruneHistory(catalog.providers)
        const saved = await writeCatalog(catalog)
        sendJson(res, 200, {
          ok: true,
          ...saved,
          pruned,
          cached: false,
          history: readState().history,
        })
      }))

      // 单个模型的推理强度等元信息
      register('/model-info', guarded(async (req, res) => {
        const url = new URL(req.url || '', 'http://localhost')
        let provider = url.searchParams.get('provider') || ''
        let model = url.searchParams.get('model') || ''
        if (req.method === 'POST') {
          const body = await readBody(req)
          provider = String(body?.provider ?? provider)
          model = String(body?.model ?? model)
        }
        if (!provider || !model) return sendJson(res, 400, { ok: false, message: '需要 provider 与 model。' })
        sendJson(res, 200, { ok: true, ...(await modelDetail(ctx, provider, model)) })
      }))

      register('/config', post(async (req, res) => {
        const body = await readBody(req)
        if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, message: '请求体必须是 JSON。' })
        const saved = await saveConfig(body.config ?? body)
        sendJson(res, 200, { ok: true, config: saved })
      }))

      register('/history', post(async (req, res) => {
        const body = await readBody(req)
        if (body && body.action === 'clear') {
          await clearHistory()
          return sendJson(res, 200, { ok: true, history: [] })
        }
        sendJson(res, 200, { ok: true, history: readState().history })
      }))

      register('/challenges', post(async (req, res) => {
        const body = await readBody(req)
        const count = Number(body?.count) > 0 ? Math.min(3, Number(body.count)) : 3
        const usedLengths = Array.isArray(body?.usedLengths) ? body.usedLengths.map(Number).filter(Number.isFinite) : []
        sendJson(res, 200, { ok: true, challenges: generateChallenges(count, usedLengths) })
      }))

      register('/refresh', post(async (req, res) => {
        const info = await loadInfo({ refresh: true })
        sendJson(res, 200, { ok: true, detector: describeDetector(info) })
      }))

      register('/detect', post(async (req, res) => {
        const body = await readBody(req)
        if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, message: '请求体必须是 JSON。' })
        const id = startJob(PACKAGE_ROOT, body, { ctx })
        sendJson(res, 200, { ok: true, jobId: id })
      }))

      // 单独重跑一条样本，再拿其余样本一起重新算分
      register('/retry', post(async (req, res) => {
        const body = await readBody(req)
        if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, message: '请求体必须是 JSON。' })
        if (!body.challenge || typeof body.challenge.prompt !== 'string') {
          return sendJson(res, 400, { ok: false, message: '缺少要重跑的样本。' })
        }
        const id = startJob(PACKAGE_ROOT, { ...body, mode: 'retry' }, { ctx })
        sendJson(res, 200, { ok: true, jobId: id })
      }))

      register('/job', guarded(async (req, res) => {
        const url = new URL(req.url || '', 'http://localhost')
        const id = url.searchParams.get('id') || ''
        const job = readJob(id)
        if (!job) return sendJson(res, 404, { ok: false, message: '作业不存在或已过期。' })
        sendJson(res, 200, { ok: true, job })
      }))

      register('/cancel', post(async (req, res) => {
        const body = await readBody(req)
        const id = String(body?.id ?? '')
        sendJson(res, 200, { ok: true, cancelled: cancelJob(id) })
      }))

      // 参考库里的全部模型（检测器数据，不是宿主接入的模型）
      register('/library', guarded(async (req, res) => {
        const info = await loadInfo()
        sendJson(res, 200, { ok: true, built_at: info.builtAt, models: info.models })
      }))

      return () => {
        for (const dispose of routes) {
          try {
            dispose?.()
          } catch {
            /* 已释放 */
          }
        }
      }
    }, 'dsh-model-fingerprint: routes')
  })
}
