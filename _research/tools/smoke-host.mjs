// smoke-host.mjs — 在桩环境里跑 host 半边（不需要真实 DSH 进程）。
//
// 用假的 `llm` 服务替代宿主模型：listProviders / listModels / resolveModelInfo
// 返回假目录，stream() 吐一串数字。这样能验证路由、作业状态机、算分串联，
// 而不用真的花一次模型调用。
//
// 用法：node smoke-host.mjs

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 用临时 DSH_HOME，别把假配置写进真正的 storages 目录
process.env.DSH_HOME = path.join(os.tmpdir(), 'dsh-model-fingerprint-smoke')
// 上一次跑的 state.json 里会留着 lastRun，不清掉「还没有最近结果」那条断言必然失败
fs.rmSync(path.join(process.env.DSH_HOME, 'storages', 'dsh-model-fingerprint', 'state.json'), { force: true })

const here = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(here, '..', '..')
const { apply } = await import(new URL('file://' + path.join(packageRoot, 'index.js').replace(/\\/g, '/')).href)

// ---------------------------------------------------------------- 假 llm

const NUMBERS = []
let seed = 12345
for (let i = 0; i < 320; i += 1) {
  seed = (seed * 1103515245 + 12345) % 2147483648
  NUMBERS.push(1 + (seed % 355))
}

const calls = []

const fakeLlm = {
  listProviders() {
    return [
      { id: 'fake-provider', name: 'Fake Provider' },
      { id: 'empty-provider', name: 'Empty Provider' },
    ]
  },
  async listModels(provider) {
    if (provider === 'empty-provider') throw new Error('该服务商未配置模型')
    return [
      { provider, id: 'fake-small', name: 'Fake Small' },
      { provider, id: 'fake-large', name: 'Fake Large' },
    ]
  },
  async resolveModelInfo(provider, model) {
    return {
      provider,
      id: model,
      name: model === 'fake-large' ? 'Fake Large' : 'Fake Small',
      reasoning: { efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }], defaultEffort: 'low' },
      context: { contextWindow: 128000 },
    }
  },
  async *stream(options) {
    calls.push({ provider: options.provider, model: options.model, effort: options.reasoningEffort ?? null })
    const text = NUMBERS.join(', ')
    // 逐片下发并留出间隔：速度是按「首片到达 → 流结束」量的，
    // 桩里如果一口气全吐出来，量到的解码窗口会接近 0，算出来的速度没有意义。
    for (let index = 0; index < text.length; index += 90) {
      yield { type: 'text-delta', index: 0, text: text.slice(index, index + 90) }
      await new Promise(resolve => setTimeout(resolve, 60))
    }
    // 真宿主在 finish 之前先发 usage：输出速度要用它算，所以桩里也得有。
    yield { type: 'usage', usage: { inputTokens: 120, outputTokens: 128, totalTokens: 248 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}

const fakeDefaultModel = {
  currentSelection() {
    return { provider: 'fake-provider', model: 'fake-large', reasoningEffort: 'high' }
  },
}

// ---------------------------------------------------------------- 假 ctx

const routes = []
const injectCalls = []
const effects = []

const ctx = {
  get(name) {
    if (name === 'llm') return fakeLlm
    if (name === 'agentDefaultModel') return fakeDefaultModel
    return undefined
  },
  effect(fn, label) {
    effects.push(label)
    const dispose = fn()
    if (typeof dispose === 'function') effects.push(`${label}:cleanup`)
    return () => {}
  },
  inject(deps, callback) {
    injectCalls.push(deps)
    const wctx = {
      webServer: {
        register(route) {
          routes.push(route)
          return () => {
            const index = routes.indexOf(route)
            if (index >= 0) routes.splice(index, 1)
          }
        },
      },
      effect(fn, label) {
        effects.push(label)
        return fn()
      },
    }
    callback(wctx)
  },
}

apply(ctx, {})

console.log('injected services:', JSON.stringify(injectCalls))
console.log('routes:', routes.length, routes.map(route => route.path.replace('/dsh-model-fingerprint', '')).join(' '))
console.log('only webServer injected:', injectCalls.every(deps => deps.length === 1 && deps[0] === 'webServer'))
console.log('tool registration present:', injectCalls.some(deps => deps.includes('tools')))

// ---------------------------------------------------------------- 假请求

function makeReq(method, url, body, headers = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  return {
    method,
    url,
    headers: { host: '127.0.0.1:61530', ...headers },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value
    },
    end(payload) {
      res.body = payload ?? ''
    },
  }
  return res
}

async function call(method, target, body, headers) {
  const [routePath, query = ''] = target.split('?')
  const url = `/dsh-model-fingerprint${routePath}${query ? `?${query}` : ''}`
  const route = routes.find(item => item.path === `/dsh-model-fingerprint${routePath}`)
  if (!route) throw new Error(`route not found: ${routePath}`)
  const res = makeRes()
  await route.handler(makeReq(method, url, method === 'GET' ? undefined : body, headers), res)
  let json = null
  try {
    json = JSON.parse(res.body)
  } catch {
    json = res.body
  }
  return { status: res.statusCode, json }
}

function check(label, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

const state = await call('GET', '/state')
check('GET /state', state.status === 200 && state.json.ok === true,
  `ready=${state.json.detector?.ready} models=${state.json.detector?.models} selection=${state.json.selection?.provider}/${state.json.selection?.model}`)
check('state has no api key field', JSON.stringify(state.json.config).includes('apiKey') === false, JSON.stringify(state.json.config))

const catalog = await call('GET', '/catalog')
check('GET /catalog', catalog.status === 200 && catalog.json.providers?.length === 2,
  `providers=${catalog.json.providers?.map(p => `${p.id}(${p.models.length} models${p.error ? ',error' : ''})`).join(',')}`)
check('catalog default', catalog.json.default?.provider === 'fake-provider', JSON.stringify(catalog.json.default))

// 页面重开时用 /active 把后台还在跑的作业接回来；没有在跑的就回 null
const idle = await call('GET', '/active')
check('GET /active (idle)', idle.status === 200 && idle.json.ok === true && idle.json.job === null,
  `job=${JSON.stringify(idle.json.job)}`)
check('GET /active lists running jobs', Array.isArray(idle.json.jobs) && idle.json.jobs.length === 0,
  `jobs=${JSON.stringify(idle.json.jobs)}`)
check('GET /active (no last run yet)', idle.json.last === null, `last=${JSON.stringify(idle.json.last)}`)

const info = await call('GET', '/model-info?provider=fake-provider&model=fake-large')
check('GET /model-info', info.status === 200 && info.json.efforts?.length === 2,
  `name=${info.json.name} efforts=${info.json.efforts?.map(e => e.id).join('/')} ctx=${info.json.contextWindow}`)

const saved = await call('POST', '/config', { config: { provider: ' fake-provider ', model: 'fake-large', effort: 'high', samples: 2 } })
check('POST /config', saved.status === 200 && saved.json.config.provider === 'fake-provider' && saved.json.config.samples === 2,
  JSON.stringify(saved.json.config))

const challenges = await call('POST', '/challenges', { count: 2 })
check('POST /challenges', challenges.status === 200 && challenges.json.challenges?.length === 2,
  `lens=${challenges.json.challenges?.map(c => c.prompt.length).join(',')}`)

const detect = await call('POST', '/detect', { config: { provider: 'fake-provider', model: 'fake-large', effort: 'high', samples: 2, parallel: true, relaxed: true } })
check('POST /detect', detect.status === 200 && typeof detect.json.jobId === 'string', `jobId=${detect.json.jobId}`)

const jobId = detect.json.jobId
let job = null
for (let attempt = 0; attempt < 100; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 60))
  const polled = await call('GET', `/job?id=${encodeURIComponent(jobId)}`)
  job = polled.json.job
  if (job && job.status !== 'running') break
}
check('GET /job reached terminal', job?.status === 'done', `status=${job?.status} error=${job?.error ?? ''}`)
if (job?.status === 'done') {
  const result = job.result
  check('result shape', typeof result.decision === 'string' && Array.isArray(result.results),
    `decision=${result.decision} used=${result.used_outputs} top=${result.top?.display_name ?? result.top?.id ?? 'none'} sampled=${result.sampled}`)
  check('result carries route', result.provider === 'fake-provider' && result.model === 'fake-large')
  check('llm received effort', calls.every(call => call.effort === 'high'), JSON.stringify(calls.slice(0, 2)))
  const slot = Array.isArray(result.challenges) ? result.challenges[0] : null
  check('sample carries output speed', Boolean(slot) && typeof slot.tps === 'number' && slot.tps > 0,
    `tps=${slot?.tps} tokens=${slot?.output_tokens} decode_ms=${slot?.decode_ms}`)
  check('speed shows in sample status', typeof slot?.status === 'string' && slot.status.includes('tok/s'), slot?.status ?? '')
}

// 作业跑完之后 /active 不该再有在跑的作业，但要留一份「上次结果」，
// 面板切到别的页面再切回来靠它把卡片和排名摆回去
const afterRun = await call('GET', '/active')
check('GET /active (finished) has no running job', afterRun.json.job === null, `job=${JSON.stringify(afterRun.json.job)}`)
check('last run is kept for panel remount',
  afterRun.json.last?.status === 'done'
    && afterRun.json.last?.mode === 'detect'
    && afterRun.json.last?.result?.decision === job?.result?.decision
    && Array.isArray(afterRun.json.last?.result?.challenges)
    && afterRun.json.last.result.challenges.length === job?.result?.challenges?.length,
  `last=${afterRun.json.last?.status}/${afterRun.json.last?.mode} challenges=${afterRun.json.last?.result?.challenges?.length}`)
check('last run keeps sample text', typeof afterRun.json.last?.result?.challenges?.[0]?.text === 'string'
  && afterRun.json.last.result.challenges[0].text.length > 0)
// 参考库清单只在「结果排名」里用，恢复界面用不到；留着会让 state.json 变很大
check('kept run drops the model list', afterRun.json.last?.result
  && Object.prototype.hasOwnProperty.call(afterRun.json.last.result, 'models') === false,
  `keys=${Object.keys(afterRun.json.last?.result ?? {}).length}`)

// 宿主重启后内存里的快照没了，靠 state.json 里那份把界面摆回来
await new Promise(resolve => setTimeout(resolve, 150))
const engine = await import(new URL('file://' + path.join(packageRoot, 'lib', 'engine.js').replace(/\\/g, '/')).href)
const persisted = engine.readState().lastRun
check('last run is written to state.json',
  persisted?.status === 'done' && Array.isArray(persisted?.result?.challenges)
    && persisted.result.challenges.length === job?.result?.challenges?.length,
  `persisted=${persisted?.status ?? 'none'} challenges=${persisted?.result?.challenges?.length ?? 0}`)
// 历史与最近结果是两次写，排队之后不该互相覆盖
check('history survived the snapshot write', engine.readState().history.length > 0,
  `history=${engine.readState().history.length}`)
// 同一个 provider/model 只留最新一行，否则总览会攒一堆同名的旧记录
const sameKeyRows = engine.readState().history
  .filter(row => row && row.provider === 'fake-provider' && row.model === 'fake-large')
check('history keeps one row per model', sameKeyRows.length === 1,
  `rows=${sameKeyRows.length} decision=${sameKeyRows[0]?.decision} prob=${sameKeyRows[0]?.top?.probability ?? 'null'}`)

let scoreGone = false
try {
  await call('POST', '/score', { outputs: [{ text: NUMBERS.slice(0, 220).join(' '), expectedCount: 300 }] })
} catch {
  scoreGone = true
}
check('POST /score removed', scoreGone, '/score 路由已随粘贴评分一起删除')

const library = await call('GET', '/library')
// 参考库条数不能写死：随包副本与缓存哪份新就用哪份，以 /state 报的为准
const libraryState = await call('GET', '/state')
check('GET /library', library.status === 200
  && library.json.models?.length > 0
  && library.json.models?.length === libraryState.json.detector?.models,
`count=${library.json.models?.length} detector=${libraryState.json.detector?.models}`)

// 单独重跑一条样本：只发这一条提示词，回来把新输出与其余样本一起重新算分
const retryChallenge = {
  id: 'probe-retry',
  expected_count: 300,
  prompt: '请随便写 300 个 1 到 355 之间的整数。',
}
const retry = await call('POST', '/retry', {
  config: { provider: 'fake-provider', model: 'fake-large', effort: 'high', samples: 2, parallel: true, relaxed: true },
  challenge: retryChallenge,
  outputs: [{ text: NUMBERS.slice(0, 240).join(' '), expectedCount: 300 }],
})
check('POST /retry', retry.status === 200 && typeof retry.json.jobId === 'string', `jobId=${retry.json.jobId}`)

const retryJobId = retry.json.jobId
let retryJob = null
for (let attempt = 0; attempt < 100; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 60))
  const polled = await call('GET', `/job?id=${encodeURIComponent(retryJobId)}`)
  retryJob = polled.json.job
  if (retryJob && retryJob.status !== 'running') break
}
check('GET /job (retry) reached terminal', retryJob?.status === 'done', `status=${retryJob?.status} error=${retryJob?.error ?? ''}`)
check('retry job reports mode', retryJob?.mode === 'retry', `mode=${retryJob?.mode}`)
if (retryJob?.status === 'done') {
  const slot = retryJob.result?.slot
  check('retry returns one slot', Boolean(slot) && slot.id === 'probe-retry',
    `state=${slot?.state} count=${slot?.count} expected=${slot?.expected_count}`)
  check('retry re-ran exactly one sample', calls.length === 3, `llm calls=${calls.length}`)
  check('retry rescored with both outputs', retryJob.result?.used_outputs === 2,
    `used=${retryJob.result?.used_outputs} decision=${retryJob.result?.decision}`)
}

// 重跑完的新排名要并回「上次结果」，否则切走再回来看到的是重跑之前的界面
const afterRetry = await call('GET', '/active')
check('retry updates the kept run',
  afterRetry.json.last?.result?.used_outputs === 2
    && afterRetry.json.last?.result?.decision === retryJob?.result?.result?.decision,
  `used=${afterRetry.json.last?.result?.used_outputs} decision=${afterRetry.json.last?.result?.decision}`)
check('retry keeps sample cards',
  Array.isArray(afterRetry.json.last?.result?.challenges)
    && afterRetry.json.last.result.challenges.length === job?.result?.challenges?.length,
  `challenges=${afterRetry.json.last?.result?.challenges?.length}`)

const retryMissing = await call('POST', '/retry', { config: { provider: 'fake-provider', model: 'fake-large' } })
check('POST /retry without challenge -> 400', retryMissing.status === 400, retryMissing.json.message)

// 允许同时重试：两条一起发出去，宿主各跑各的，回来时两条卡片都要更新，
// 排名要按「两条都更新之后」的样本文本重算，不能被先跑完那条的旧文本带偏。
const retryConfig = { provider: 'fake-provider', model: 'fake-large', effort: 'high', samples: 2, parallel: true, relaxed: true }
const parallelA = await call('POST', '/retry', {
  config: retryConfig,
  challenge: { ...retryChallenge, id: 'probe-a' },
  outputs: [],
  index: 0,
})
const parallelB = await call('POST', '/retry', {
  config: retryConfig,
  challenge: { ...retryChallenge, id: 'probe-b' },
  outputs: [],
  index: 1,
})
const bothRunning = await call('GET', '/active')
const runningRetries = Array.isArray(bothRunning.json.jobs) ? bothRunning.json.jobs.filter(job => job.mode === 'retry') : []
check('two retries run at once', runningRetries.length === 2,
  `jobs=${runningRetries.map(job => `${job.id.slice(0, 8)}#${job.index}`).join(',')}`)
check('both retries are listed', [parallelA.json.jobId, parallelB.json.jobId].every(id => runningRetries.some(job => job.id === id)))

async function waitJob(id) {
  let last = null
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 60))
    const polled = await call('GET', `/job?id=${encodeURIComponent(id)}`)
    last = polled.json.job
    if (last && last.status !== 'running') return last
  }
  return last
}

const doneA = await waitJob(parallelA.json.jobId)
const doneB = await waitJob(parallelB.json.jobId)
check('both retries finished', doneA?.status === 'done' && doneB?.status === 'done',
  `a=${doneA?.status} b=${doneB?.status}`)
const afterBoth = await call('GET', '/active')
const mergedSlots = afterBoth.json.last?.result?.challenges ?? []
check('kept run merged both retries',
  mergedSlots.length === 2
    && mergedSlots.every(slot => typeof slot?.text === 'string' && slot.text.length > 0)
    && afterBoth.json.last?.result?.used_outputs === 2,
  `challenges=${mergedSlots.length} used=${afterBoth.json.last?.result?.used_outputs}`)
check('merged run is rescored from every sample',
  typeof afterBoth.json.last?.result?.decision === 'string'
    && Array.isArray(afterBoth.json.last?.result?.results),
  `decision=${afterBoth.json.last?.result?.decision}`)

const crossSite = await call('GET', '/state', undefined, { origin: 'https://evil.example' })
check('cross-site -> 403', crossSite.status === 403, crossSite.json.message)

const badMethod = await call('GET', '/config')
check('GET /config -> 405', badMethod.status === 405, badMethod.json.message)

// 刷新过的数据必须留在缓存里，否则下次启动又先命中包内那份旧副本，
// 手动更新过的模型库一重启就回到随包版本。
// 先删掉缓存里的清单，这样「落盘」和「重启后仍在」才真的被验证到，而不是白拿上一次的残留。
const cachedBundle = path.join(process.env.DSH_HOME, 'storages', 'dsh-model-fingerprint', 'bundle.json')
fs.rmSync(cachedBundle, { force: true })
const refresh = await call('POST', '/refresh', {})
check('POST /refresh', refresh.status === 200 && refresh.json.detector?.ready === true, `status=${refresh.status} source=${refresh.json.detector?.source} body=${JSON.stringify(refresh.json).slice(0, 300)}`)
check('refresh persists bundle.json to cache', fs.existsSync(cachedBundle), cachedBundle)
const detectorModule = await import(new URL('file://' + path.join(packageRoot, 'lib', 'detector.js').replace(/\\/g, '/')).href)
const reloaded = await detectorModule.loadDetector(packageRoot)
check('restart keeps the refreshed build',
  reloaded.bundle?.built_at === refresh.json.detector?.built_at,
  `built_at=${reloaded.bundle?.built_at} refreshed=${refresh.json.detector?.built_at} source=${reloaded.source}`)
check('restart loads a matching detector pair',
  reloaded.detectorBytes > 0 && detectorModule.supportsSharedDetector(reloaded.bundle, reloaded.artifact),
  `bytes=${reloaded.detectorBytes} models=${reloaded.artifact?.model_ids?.length}`)


const cancelled = await call('POST', '/cancel', { id: jobId })
check('POST /cancel finished job', cancelled.status === 200 && cancelled.json.cancelled === true)

// 在跑的作业应该能被 /active 找到，并且带上索引与耗时，页面据此接回进度
const busySpec = { config: { provider: 'fake-provider', model: 'fake-large', effort: 'high', samples: 3, parallel: false, relaxed: true } }
const busy = await call('POST', '/detect', busySpec)
check('POST /detect (attach probe)', busy.status === 200 && typeof busy.json.jobId === 'string', `jobId=${busy.json.jobId}`)
const probing = await call('GET', '/active')
check('GET /active (running)', probing.status === 200 && probing.json.job?.id === busy.json.jobId,
  `active=${probing.json.job?.id} status=${probing.json.job?.status} elapsed=${probing.json.job?.elapsed_ms}ms`)
check('active job reports mode/index', probing.json.job?.mode === 'detect' && probing.json.job?.index === null,
  `mode=${probing.json.job?.mode} index=${JSON.stringify(probing.json.job?.index)}`)
await call('POST', '/cancel', { id: busy.json.jobId })
const afterCancel = await call('GET', '/active')
check('GET /active (after cancel)', afterCancel.json.job === null, `job=${JSON.stringify(afterCancel.json.job)}`)

// 单条重跑的作业要记住自己对应界面上第几张卡片
const retryIndexed = await call('POST', '/retry', {
  config: { provider: 'fake-provider', model: 'fake-large', effort: 'high', samples: 1, parallel: false, relaxed: true },
  challenge: retryChallenge,
  outputs: [],
  index: 1,
})
const indexed = await call('GET', '/active')
check('retry job carries index', indexed.json.job?.mode === 'retry' && indexed.json.job?.index === 1,
  `mode=${indexed.json.job?.mode} index=${JSON.stringify(indexed.json.job?.index)}`)
await call('POST', '/cancel', { id: retryIndexed.json.jobId })

// 重跑这么多次之后，历史里同一个模型仍然只有一行：
// 没补出概率的重跑不写历史，补出来的那次会替掉同名行而不是新增
const finalRows = engine.readState().history
  .filter(row => row && row.provider === 'fake-provider' && row.model === 'fake-large')
check('history stays deduped after retries', finalRows.length === 1,
  `rows=${finalRows.length} total=${engine.readState().history.length}`)

console.log('effects:', effects.join(' | '))
