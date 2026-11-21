// dsh-model-fingerprint — 走 DSH 已接入模型的取样层。
//
// 这里不碰任何 baseURL / apiKey：模型来自宿主 `llm` 服务里已经注册的
// provider 目录，取样就是对该 provider 发一次普通的 chat 调用（和你在
// 对话里选模型用的是同一条链路），所以插件不需要保管任何凭据。

import crypto from 'node:crypto'
import { minimumNumbers, parseNumbers } from './fingerprint.js'

/** 单条样本的硬上限，和官方实现一致（250s）。 */
const SAMPLE_TIMEOUT_MS = 250_000
/** 让模型写 300 个整数需要一点余量，但不需要无限输出。 */
const MAX_OUTPUT_TOKENS = 8192
/** 每次采样失败的兜底提示。 */
const EMPTY_OUTPUT = '没有取到数字。'
/**
 * 取够数字之后再多收一会儿。
 *
 * 宽松模式一凑够目标数字就截断正文，但 usage（输出词数）只在整条流结尾才发，
 * 截断太早会拿不到它，也就没法算输出速度。所以截断之后继续读、丢掉正文，只为
 * 等到 usage/finish；超过这个时间或字数还等不到就放弃（报告里只是没有速度）。
 */
const CAP_GRACE_MS = 12_000
const CAP_GRACE_CHARS = 6_000
/**
 * 判定「上游把整段正文憋着一次性下发」的阈值。
 *
 * 正常逐字下发的流，解码窗口（首字→结束）会占总时长的大头；如果首字来得极晚、
 * 之后正文瞬间到齐（解码窗口不到总时长的这个比例），那说明首字时刻根本不是
 * 真实的解码起点，按「首字→结束」算会得到几千 tok/s 的假速度。这种情况下改用
 * 整段请求时长做分母。
 */
const CAP_BURST_RATIO = 0.5

/**
 * 取宿主的 `llm` 服务。
 * @param ctx 插件上下文。
 * @returns { provider 目录与流式调用都在这里 }。
 * @throws 当宿主没有挂载 llm 服务时抛中文错误。
 */
export function llmService(ctx) {
  const llm = ctx?.get?.('llm') ?? ctx?.llm
  if (!llm || typeof llm.stream !== 'function' || typeof llm.listProviders !== 'function') {
    throw new Error('宿主没有挂载 llm 服务，无法读取已接入的模型。')
  }
  return llm
}

/** 当前对话默认选中的 provider/model（可能不存在）。 */
export function defaultSelection(ctx) {
  try {
    const service = ctx?.get?.('agentDefaultModel') ?? ctx?.agentDefaultModel
    const current = service?.currentSelection?.()
    if (!current || !current.provider || !current.model) return null
    return {
      provider: current.provider,
      model: current.model,
      effort: current.reasoningEffort ? String(current.reasoningEffort) : '',
    }
  } catch {
    return null
  }
}

/**
 * 列出宿主的 provider 与各自可选的模型。
 * @param ctx 插件上下文。
 * @param options.provider 只查一个 provider（可选）。
 * @returns `{ providers, default }`，每个 provider 带模型列表。
 */
export async function listCatalog(ctx, options = {}) {
  const llm = llmService(ctx)
  const providers = llm.listProviders()
  const only = options.provider ? String(options.provider) : ''
  const wanted = only ? providers.filter((provider) => provider.id === only) : providers
  const catalog = []
  for (const provider of wanted) {
    let models = []
    let error = null
    try {
      models = await llm.listModels(provider.id)
    } catch (cause) {
      // 目录是 advisory：一个 provider 没有模型清单不影响其它 provider。
      error = messageOf(cause)
    }
    catalog.push({
      id: provider.id,
      name: provider.name || provider.id,
      models: models.map((model) => ({
        id: model.id,
        name: model.name || model.id,
        description: model.description ?? '',
        badge: model.badge?.text ?? '',
      })),
      error,
    })
  }
  return { providers: catalog, default: defaultSelection(ctx) }
}

/**
 * 读取单个模型的元信息，主要是可选的推理强度。
 * @returns `{ name, efforts, defaultEffort, contextWindow }`，失败时 efforts 为空。
 */
export async function modelDetail(ctx, provider, model) {
  const llm = llmService(ctx)
  try {
    const info = await llm.resolveModelInfo(provider, model)
    return {
      name: info.name || model,
      efforts: (info.reasoning?.efforts ?? []).map((effort) => ({ id: effort.id, name: effort.name })),
      defaultEffort: info.reasoning?.defaultEffort ?? '',
      contextWindow: info.context?.contextWindow ?? null,
    }
  } catch (cause) {
    return { name: model, efforts: [], defaultEffort: '', contextWindow: null, error: messageOf(cause) }
  }
}

function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error ?? '')
}

/** 卡片状态行里的速度尾巴，例如 ` · 41.2 tok/s`；没有速度时留空。 */
function speedLabel(tps) {
  return typeof tps === 'number' && Number.isFinite(tps) && tps > 0 ? ` · ${tps >= 10 ? Math.round(tps) : tps.toFixed(1)} tok/s` : ''
}

function codeOf(error) {
  const code = error?.code
  return typeof code === 'string' ? code : ''
}

/**
 * 把一条挑战发出去，边收边拼文本。
 * @param ctx 插件上下文。
 * @param request provider/model/effort/prompt/signal/maxNumbers/onText。
 * @returns `{ text, capped, finish }`。
 */
export async function streamSample(ctx, request) {
  const llm = llmService(ctx)
  const {
    provider,
    model,
    effort = '',
    prompt,
    system,
    signal,
    maxNumbers,
    onText = () => {},
  } = request
  if (!provider || !model) throw new Error('请先选择 provider 与模型。')

  const messages = [
    {
      id: `mf-${crypto.randomUUID()}`,
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'dsh-model-fingerprint' },
    },
  ]
  const timeout = AbortSignal.timeout(SAMPLE_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const options = {
    provider,
    model,
    maxTokens: MAX_OUTPUT_TOKENS,
    messages,
    ...(system ? { system } : {}),
    ...(effort && effort !== 'default' ? { reasoningEffort: effort } : {}),
    signal: combined,
    purpose: 'model-fingerprint',
  }

  let text = ''
  let finish = null
  let usage = null
  let capped = false
  let firstTokenAt = 0
  let stream
  try {
    stream = llm.stream(options)
  } catch (cause) {
    throw sampleError(cause)
  }
  const startedAt = Date.now()
  // 截断之后继续收流的截止时刻；0 表示还没截断
  let drainUntil = 0
  try {
    for await (const chunk of stream) {
      if (!chunk || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta') {
        if (typeof chunk.text !== 'string' || chunk.text.length === 0) continue
        if (!firstTokenAt) firstTokenAt = Date.now()
        if (capped) {
          // 已经取够数字了，正文丢掉，只等 usage / finish。
          if (Date.now() > drainUntil) break
          continue
        }
        text += chunk.text
        onText(chunk.text, text)
        if (maxNumbers && parseNumbers(text).length >= maxNumbers) {
          const numbers = parseNumbers(text)
          text = numbers.slice(0, maxNumbers).join(', ')
          capped = true
          drainUntil = Date.now() + CAP_GRACE_MS
        }
      } else if (chunk.type === 'usage') {
        if (chunk.usage && typeof chunk.usage === 'object') usage = chunk.usage
        // 速度只用这一个数，拿到它就不必再等 finish。
        if (capped) break
      } else if (chunk.type === 'finish') {
        finish = chunk.reason ?? null
        break
      }
    }
  } catch (cause) {
    // 截断之后只是为了等 usage，这期间上游断流不该让整条样本失败。
    if (!capped) throw sampleError(cause)
  } finally {
    // break 之后主动关掉上游迭代器，避免连接挂着。
    try {
      await stream?.return?.()
    } catch {
      /* 上游已经结束 */
    }
  }

  if (finish && finish.kind === 'error') {
    throw sampleError(Object.assign(new Error(finish.failure?.message || EMPTY_OUTPUT), { code: finish.failure?.code }))
  }
  if (finish && finish.kind === 'aborted') {
    const failure = finish.failure
    throw sampleError(Object.assign(new Error(failure?.message || '已停止'), { code: failure?.code || 'ABORTED' }))
  }
  if (!text.trim()) throw new Error(EMPTY_OUTPUT)
  return { text, capped, finish: finish?.kind ?? '', usage: normalizeUsage(usage), timing: timingOf(startedAt, firstTokenAt, usage) }
}

/** 只保留算速度要用到的字段，避免把整个 usage 塞进进度载荷。 */
function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null
  const output = Number(usage.outputTokens)
  const input = Number(usage.inputTokens)
  return {
    outputTokens: Number.isFinite(output) ? output : null,
    inputTokens: Number.isFinite(input) ? input : null,
  }
}

/**
 * 输出速度：输出词数 ÷ 生成秒数。
 *
 * 和官方界面的口径一致——生成时长从**第一个正文 token** 算到流结束，
 * 不含首 token 之前的等待（TTFT），所以是纯解码速度。
 *
 * 例外：有些上游（尤其是转发的第三方接口）不是逐字下发，而是憋到生成完
 * 一次性把正文怼过来。这时「首字→结束」只剩几十毫秒，算出来会是几千 tok/s
 * 的假速度。判据是解码窗口不到总时长的一半并且首字等待占了绝大部分，
 * 这种情况改用「整段请求时长」做分母，并标记 buffered 让界面说明清楚。
 */
function timingOf(startedAt, firstTokenAt, usage) {
  const endedAt = Date.now()
  const outputTokens = Number(usage?.outputTokens)
  const totalMs = Math.max(0, endedAt - startedAt)
  const decodeMs = firstTokenAt > 0 ? Math.max(0, endedAt - firstTokenAt) : 0
  const ttftMs = firstTokenAt > 0 ? Math.max(0, firstTokenAt - startedAt) : 0
  const buffered = totalMs > 0 && ttftMs > 0 && decodeMs < totalMs * CAP_BURST_RATIO
  const basisMs = buffered ? totalMs : decodeMs
  const tps = Number.isFinite(outputTokens) && outputTokens > 0 && basisMs > 0
    ? outputTokens / (basisMs / 1000)
    : null
  return {
    output_tokens: Number.isFinite(outputTokens) ? outputTokens : null,
    decode_ms: decodeMs,
    ttft_ms: ttftMs,
    total_ms: totalMs,
    basis_ms: basisMs,
    basis: buffered ? 'total' : 'decode',
    buffered,
    tps,
  }
}

function sampleError(cause) {
  const code = codeOf(cause)
  const message = messageOf(cause) || EMPTY_OUTPUT
  const error = new Error(code && !/^[A-Z_]+$/.test(message) ? message : `${message}${code ? `（${code}）` : ''}`)
  error.code = code
  return error
}

/**
 * 按挑战清单逐条取样，并把进度回放给调用方。
 * @param ctx 插件上下文。
 * @param spec `{ provider, model, effort, challenges, samples, parallel, relaxed }`。
 * @param options `{ signal, onProgress }`。
 * @returns `{ outputs, slots }`，outputs 供算分，slots 供 UI 展示每条的状态。
 */
export async function collectSamples(ctx, spec, options = {}) {
  const { provider, model, effort = '', parallel = true, relaxed = true } = spec
  const challenges = Array.isArray(spec.challenges) ? spec.challenges : []
  const total = challenges.length
  if (total === 0) throw new Error('没有可用的提示词。')
  const signal = options.signal
  const report = options.onProgress || (() => {})

  const slots = challenges.map((challenge) => ({
    id: challenge.id,
    expected_count: challenge.expected_count,
    prompt: challenge.prompt,
    text: '',
    count: 0,
    state: 'pending',
    status: '',
    error: null,
    errorCode: '',
    // 输出速度相关：只在真的拿到 usage 时才有值
    output_tokens: null,
    decode_ms: 0,
    basis_ms: 0,
    basis: 'decode',
    buffered: false,
    tps: null,
  }))
  let completed = 0
  let accepted = 0
  let lastReport = 0

  const emit = (message, force = false) => {
    const now = Date.now()
    if (!force && now - lastReport < 120) return
    lastReport = now
    report({
      stage: 'sampling',
      message,
      completed,
      total,
      accepted,
      challenges: slots.map((slot) => ({ ...slot })),
      outputs: slots.filter((slot) => slot.state === 'done' || slot.state === 'capped').map((slot) => ({
        text: slot.text,
        expectedCount: slot.expected_count,
      })),
    })
  }

  emit(`正在通过 ${provider} / ${model} 取样`, true)

  const runOne = async (index) => {
    const challenge = challenges[index]
    const slot = slots[index]
    slot.state = 'requesting'
    slot.status = '发送提示词'
    emit(`第 ${index + 1} 条：发送提示词`, true)
    try {
      const result = await streamSample(ctx, {
        provider,
        model,
        effort,
        prompt: challenge.prompt,
        signal,
        maxNumbers: relaxed ? challenge.expected_count : undefined,
        onText(delta, whole) {
          slot.text = whole
          slot.count = parseNumbers(whole).length
          slot.state = 'streaming'
          slot.status = `已收到 ${slot.count} 个数字`
          emit(`第 ${index + 1} 条：${slot.count} 个数字`)
          void delta
        },
      })
      slot.text = result.text
      slot.count = parseNumbers(result.text).length
      // 输出速度：宿主在流结尾发的 usage + 我们自己量的解码时长
      slot.output_tokens = result.timing?.output_tokens ?? null
      slot.decode_ms = result.timing?.decode_ms ?? 0
      slot.basis_ms = result.timing?.basis_ms ?? 0
      slot.basis = result.timing?.basis ?? 'decode'
      slot.buffered = Boolean(result.timing?.buffered)
      slot.tps = result.timing?.tps ?? null
      const enough = slot.count >= minimumNumbers(challenge.expected_count)
      if (enough) {
        accepted += 1
        slot.state = result.capped ? 'capped' : 'done'
        slot.status = `${slot.count} 个数字${result.capped ? '（取够即停）' : ''}${speedLabel(slot.tps)}`
      } else {
        slot.state = 'rejected'
        slot.status = `只有 ${slot.count} 个数字`
        slot.error = `数字太少（需要至少 ${minimumNumbers(challenge.expected_count)} 个）`
        slot.errorCode = 'insufficient_numbers'
      }
    } catch (cause) {
      slot.state = 'rejected'
      slot.status = '失败'
      slot.error = messageOf(cause) || EMPTY_OUTPUT
      slot.errorCode = codeOf(cause)
      if (signal?.aborted) throw cause
    } finally {
      completed += 1
      emit(`已完成 ${completed}/${total}`, true)
    }
  }

  if (parallel) {
    await Promise.all(challenges.map((_, index) => runOne(index)))
  } else {
    for (let index = 0; index < challenges.length; index += 1) {
      if (signal?.aborted) break
      await runOne(index)
    }
  }

  const outputs = slots
    .filter((slot) => slot.state === 'done' || slot.state === 'capped')
    .map((slot) => ({ text: slot.text, expectedCount: slot.expected_count }))
  if (outputs.length === 0) {
    const first = slots.find((slot) => slot.error)
    const error = new Error(first?.error ? `没有取到可用的样本：${first.error}` : '没有取到可用的样本。')
    error.code = 'no_output'
    throw error
  }
  return { outputs, slots }
}
