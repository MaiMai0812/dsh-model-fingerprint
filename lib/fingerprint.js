// dsh-model-fingerprint — 指纹算法核心。
//
// 这一段是 Ikaleio/lm-detector 里 shared_fingerprint-core.js +
// shared_positional.ts + shared_shared-detector.ts 的逐行移植：把模型随手写出
// 的一串整数变成 429 维特征（频次 355 + 分块 74），再用检测器里打包好的
// LDA 头、参考样本最近邻、基线质心和位置特征加权成一个 70 维排名，
// 最后用 ranking-temperature 校准成闭集概率。
//
// 移植结果已用官方 unified_reference.jsonl 里 70 个模型各 3 条参考回答验证：
// top1 = 70/70。

export const VALUE_MIN = 1
export const VALUE_MAX = 355
export const DIMENSION = VALUE_MAX - VALUE_MIN + 1
const ALPHA = 0.5

// ---------------------------------------------------------------- 解析

/**
 * 取一段文本里最长的连续整数 run（中间夹字母就断开），只保留 1..355。
 * 模型常在数字前后写说明文字，官方实现就是靠这个规则把正文挑出来。
 */
export function parseNumbers(text) {
  const runs = []
  let current = []
  let previousEnd = 0
  const source = String(text ?? '')
  for (const match of source.matchAll(/\d+/g)) {
    const separator = source.slice(previousEnd, match.index)
    const value = Number(match[0])
    if (current.length && /\p{L}/u.test(separator)) {
      runs.push(current)
      current = []
    }
    if (value >= VALUE_MIN && value <= VALUE_MAX) current.push(value)
    previousEnd = match.index + match[0].length
  }
  if (current.length) runs.push(current)
  return runs.reduce((best, run) => (run.length > best.length ? run : best), [])
}

export function countNumbers(numbers) {
  const counts = Array(DIMENSION).fill(0)
  for (const n of numbers) counts[n - VALUE_MIN] += 1
  return counts
}

// ---------------------------------------------------------------- 数值工具

const sum = (values) => values.reduce((a, b) => a + b, 0)
const mean = (values) => sum(values) / values.length

function standardize(values) {
  const center = mean(values)
  const variance = mean(values.map((v) => (v - center) ** 2))
  const scale = Math.max(Math.sqrt(variance), 1e-12)
  return values.map((v) => (v - center) / scale)
}

const dot = (a, b) => {
  let total = 0
  for (let i = 0; i < a.length; i++) total += a[i] * b[i]
  return total
}
const norm = (v) => Math.sqrt(dot(v, v))
const normalized = (v) => {
  const size = Math.max(norm(v), 1e-12)
  return v.map((x) => x / size)
}

function subtractBasis(values, basis) {
  const out = values.slice()
  for (const vector of basis || []) {
    const projection = dot(out, vector)
    for (let i = 0; i < out.length; i++) out[i] -= projection * vector[i]
  }
  return out
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

// ---------------------------------------------------------------- 特征

function hellingerFeature(counts) {
  const total = sum(counts) + ALPHA * DIMENSION
  return counts.map((v) => Math.sqrt((v + ALPHA) / total))
}

function splitIntoFour(values) {
  const base = Math.floor(values.length / 4)
  const remainder = values.length % 4
  const chunks = []
  let start = 0
  for (let i = 0; i < 4; i++) {
    const size = base + (i < remainder ? 1 : 0)
    chunks.push(values.slice(start, start + size))
    start += size
  }
  return chunks
}

/** 前四段各 16 个区间桶 + 末位数字 10 桶，共 74 维。 */
function orderedBlockFeature(numbers) {
  const pieces = []
  for (const chunk of splitIntoFour(numbers)) {
    const bins = Array(16).fill(0.5)
    for (const value of chunk) bins[Math.min(15, Math.floor(((value - 1) / 355) * 16))] += 1
    const total = sum(bins)
    pieces.push(...bins.map((v) => Math.sqrt(v / total)))
  }
  const lastDigits = Array(10).fill(0.5)
  for (const value of numbers) lastDigits[value % 10] += 1
  const lastTotal = sum(lastDigits)
  pieces.push(...lastDigits.map((v) => Math.sqrt(v / lastTotal)))
  return pieces
}

const POSITIONAL_WEIGHTS = [0.6, 0.15, 0.125, 0.125]
const CENTRES = Array.from({ length: 24 }, (_, i) => 1 + (i * 354) / 23)
const LAGS = [1, 2, 3, 5, 8, 13, 21, 34]

const fraction = (length, test) => {
  let hits = 0
  for (let i = 0; i < length; i++) if (test(i)) hits++
  return hits / length
}

/** 24 个高斯核 + 10 个末位 one-hot，各自乘 3 个 Legendre 基，共 102 维。 */
function positionKernel(x) {
  const n = x.length
  const out = Array(34 * 3).fill(0)
  x.forEach((value, position) => {
    const t = ((position + 0.5) * 2) / n - 1
    const basis = [t, 0.5 * (3 * t * t - 1), 0.5 * (5 * t ** 3 - 3 * t)]
    const features = [
      ...CENTRES.map((centre) => Math.exp(-0.5 * ((value - centre) / 20) ** 2)),
      ...Array.from({ length: 10 }, (_, digit) => (digit === value % 10 ? 1 : 0)),
    ]
    features.forEach((weight, k) => {
      basis.forEach((b, j) => {
        out[k * 3 + j] += (weight * b) / n
      })
    })
  })
  return out
}

/** +0.5 平滑的联合分布减去行列边缘积：保留“A 后面跟 B”的耦合，去掉单独频率。 */
function centredTransitions(symbols, bins) {
  const joint = Array(bins * bins).fill(0.5)
  const total = symbols.length - 1 + 0.5 * bins * bins
  for (let i = 1; i < symbols.length; i++) joint[symbols[i - 1] * bins + symbols[i]] += 1
  for (let i = 0; i < joint.length; i++) joint[i] /= total
  const rows = Array.from({ length: bins }, (_, a) => sum(joint.slice(a * bins, a * bins + bins)))
  const columns = Array.from({ length: bins }, (_, b) => sum(rows.map((_, a) => joint[a * bins + b])))
  return joint.map((value, i) => value - rows[Math.floor(i / bins)] * columns[i % bins])
}

/** 8 个滞后的自相关/步长统计 + 两张转移矩阵 + 5 个形状比例，共 220 维。 */
function sequenceFeatures(x) {
  const n = x.length
  const m = mean(x)
  const sd = Math.max(Math.sqrt(mean(x.map((v) => (v - m) ** 2))), 1)
  const s = x.map((v) => (v - m) / sd)
  const out = []
  for (const lag of LAGS) {
    const count = n - lag
    const d = Array.from({ length: count }, (_, i) => x[i + lag] - x[i])
    out.push(
      mean(d.map((_, i) => s[i + lag] * s[i])),
      mean(d.map(Math.abs)) / 355,
      fraction(count, (i) => d[i] > 0),
      fraction(count, (i) => d[i] === 0),
      fraction(count, (i) => Math.abs(d[i]) <= 5),
      fraction(count, (i) => Math.abs(d[i]) <= 20),
    )
  }
  out.push(...centredTransitions(x.map((v) => Math.min(7, Math.floor(((v - 1) * 8) / 355))), 8))
  out.push(...centredTransitions(x.map((v) => v % 10), 10))
  const difference = Array.from({ length: n - 1 }, (_, i) => x[i + 1] - x[i])
  const zStep = Array.from({ length: n - 1 }, (_, i) => Math.abs(s[i + 1] - s[i]))
  out.push(
    fraction(n - 2, (i) => Math.sign(difference[i + 1]) === Math.sign(difference[i])),
    fraction(n - 2, (i) => difference[i + 1] === difference[i]),
    fraction(n - 1, (i) => x[i] % 10 === x[i + 1] % 10),
    fraction(n - 1, (i) => zStep[i] > 1),
    fraction(n - 1, (i) => zStep[i] > 2),
  )
  const buckets = x.map((v) => Math.min(15, Math.floor(((v - 1) * 16) / 355)))
  for (const width of [4, 8, 16]) {
    let total = 0
    for (let i = 0; i + width <= n; i++) total += new Set(buckets.slice(i, i + width)).size / width
    out.push(total / (n - width + 1))
  }
  return out
}

const positionalFeatures = (numbers) => [
  hellingerFeature(countNumbers(numbers)),
  orderedBlockFeature(numbers),
  positionKernel(numbers),
  sequenceFeatures(numbers),
]

function positionalDecision(numbers, head) {
  const parts = positionalFeatures(numbers)
  const x = parts.flatMap((block, j) => {
    const p = head.params[j]
    const scaled = block.map((v, i) => (v - p.mean[i]) / p.scale[i])
    const length = Math.max(Math.sqrt(sum(scaled.map((v) => v * v))), 1e-12)
    return scaled.map((v) => (v / length) * Math.sqrt(POSITIONAL_WEIGHTS[j]))
  })
  return head.weights.map((row, k) => row.reduce((total, w, i) => total + w * x[i], head.bias[k]))
}

// ---------------------------------------------------------------- 排名

const z = (values) => {
  const m = mean(values)
  const s = Math.max(Math.sqrt(mean(values.map((x) => (x - m) ** 2))), 1e-12)
  return values.map((x) => (x - m) / s)
}
const columnMean = (rows) => rows[0].map((_, i) => mean(rows.map((r) => r[i])))

const blocksOf = (numbers) => [hellingerFeature(countNumbers(numbers)), orderedBlockFeature(numbers)]

const transform = (blocks, params) =>
  blocks.flatMap((block, j) =>
    normalized(block.map((x, i) => (x - params[j].mean[i]) / params[j].scale[i])).map(
      (x) => x * Math.sqrt(j === 0 ? 0.75 : 0.25),
    ),
  )

const centered = (values, params) => values.map((x, i) => (x - params.feature_mean[i]) / params.feature_scale[i])

const referenceNorms = new WeakMap()

/** 到某条参考样本的距离取前 7 小值的均值；距离平方用展开式避免逐维循环。 */
function nearest(x, references) {
  let norms = referenceNorms.get(references)
  if (!norms) {
    norms = references.map((r) => dot(r, r))
    referenceNorms.set(references, norms)
  }
  const xx = dot(x, x)
  return mean(
    references
      .map((r, i) => Math.max(0, xx + norms[i] - 2 * dot(x, r)))
      .sort((a, b) => a - b)
      .slice(0, 7),
  )
}

function baseline(blocks, bank) {
  const h = bank.hellinger
  const o = bank.ordered_blocks
  const hUnit = normalized(subtractBasis(centered(blocks[0], h), h.nuisance_basis))
  const marginal = h.centroids.map((row) => dot(hUnit, row))
  const oCentered = centered(blocks[1], o)
  const raw = normalized(oCentered)
  const projected = normalized(subtractBasis(oCentered, o.nuisance_basis))
  const templates = o.centroids.map((_, i) => Math.max(...o.environment_centroids.map((rows) => dot(raw, rows[i]))))
  const nuisance = o.centroids.map((row) => dot(projected, row))
  const tz = z(templates)
  const nz = z(nuisance)
  const ordered = z(tz.map((v, i) => 0.5 * v + 0.5 * nz[i]))
  const mz = z(marginal)
  return mz.map((v, i) => 0.5 * v + 0.5 * ordered[i])
}

export function rankSharedNumbers(numbers, artifact) {
  const a = artifact.ranker
  const full = numbers.map(blocksOf)
  const ax = full.map((blocks) => transform(blocks, a.full_params))
  const lda = numbers.map((n) => {
    const x = transform(blocksOf(n.slice(0, 128)), a.head_params)
    return z(a.lda_weights.map((row, i) => dot(row, x) + a.lda_bias[i]))
  })
  const l = z(columnMean(lda))
  const near = z(a.references.map((ref) => median(ax.map((x) => -nearest(x, ref)))))
  const base = z(columnMean(full.map((blocks) => baseline(blocks, a.bank))))
  const frequency = z(l.map((x, i) => 0.5 * x + 0.25 * near[i] + 0.25 * base[i]))
  const positional = z(columnMean(numbers.map((n) => z(positionalDecision(n, a.positional)))))
  return frequency.map((x, i) => a.blend.frequency * x + a.blend.positional * positional[i])
}

/** 闭集 softmax。绑定校验不过就返回 null，让上层降级成“未校准排名”。 */
export function calibrateRanking(ranking, artifact) {
  const head = artifact.calibration
  const binding = head && head.binding
  if (!head || !binding) return null
  if (head.schema !== 'shared-confidence-v2' || head.method !== 'ranking-temperature') return null
  if (binding.base_sha256 !== artifact.base_sha256) return null
  if (binding.reference_sha256 !== artifact.source_reference_sha256) return null
  if (!Array.isArray(binding.model_ids) || binding.model_ids.length !== ranking.length) return null
  if (!Number.isFinite(head.tau) || head.tau <= 0) return null
  const logits = ranking.map((score) => head.tau * score)
  const maximum = Math.max(...logits)
  const weights = logits.map((v) => Math.exp(v - maximum))
  const total = sum(weights)
  return weights.map((v) => v / total)
}

// ---------------------------------------------------------------- 形态判定

export const SEQUENCE_LIMITS = { autocorrelation: -0.23, small_step_share: 0.05 }

/**
 * 模型随手写的序列相邻值会互相拉扯（负自相关）或步长偏大；程序生成的
 * 排序/打乱序列则两者都不满足。判不出来就不给排名。
 */
export function sequenceShape(numbers) {
  const shapes = numbers.map((n) => {
    const m = mean(n)
    const variance = mean(n.map((x) => (x - m) ** 2))
    const steps = n.slice(1).map((x, i) => x - n[i])
    return {
      autocorrelation: variance ? mean(steps.map((_, i) => (n[i + 1] - m) * (n[i] - m))) / variance : 1,
      small_step_share: mean(steps.map((d) => (Math.abs(d) <= 20 ? 1 : 0))),
    }
  })
  const autocorrelation = median(shapes.map((s) => s.autocorrelation))
  const small_step_share = median(shapes.map((s) => s.small_step_share))
  return {
    autocorrelation,
    small_step_share,
    model_like:
      autocorrelation <= SEQUENCE_LIMITS.autocorrelation || small_step_share <= SEQUENCE_LIMITS.small_step_share,
  }
}

// ---------------------------------------------------------------- 汇总

export function minimumNumbers(expectedCount) {
  return Math.max(80, Math.ceil(expectedCount * 0.55))
}

/**
 * 把若干条模型回复变成一次检测结论。
 * @param outputs [{ text, expectedCount }]
 * @param artifact 解码后的 shared detector
 * @param options { allowPartial }
 */
export function analyzeOutputs(outputs, artifact, options = {}) {
  const allowPartial = options.allowPartial !== false
  const usable = outputs
    .map((output, index) => ({
      index,
      expectedCount: output.expectedCount,
      minimum: minimumNumbers(output.expectedCount),
      numbers: parseNumbers(output.text),
    }))
    .filter((entry) => entry.numbers.length >= entry.minimum)

  const diagnostics = outputs.map((output, index) => {
    const numbers = parseNumbers(output.text)
    const minimum = minimumNumbers(output.expectedCount)
    return {
      index,
      numbers: numbers.length,
      minimum,
      ok: numbers.length >= minimum,
    }
  })

  if (usable.length === 0) {
    return {
      decision: 'unscorable',
      reason: 'no_valid_output',
      diagnostics,
      used_outputs: 0,
      results: [],
    }
  }

  const shape = sequenceShape(usable.map((entry) => entry.numbers))
  if (!shape.model_like) {
    return {
      decision: 'not_model',
      reason: 'sequence_shape',
      sequence: shape,
      diagnostics,
      used_outputs: usable.length,
      results: [],
    }
  }

  const partial = usable.length < 3
  if (partial && !allowPartial) {
    return {
      decision: 'unscorable',
      reason: 'insufficient_outputs',
      sequence: shape,
      diagnostics,
      used_outputs: usable.length,
      results: [],
    }
  }

  const ranking = rankSharedNumbers(usable.map((entry) => entry.numbers), artifact)
  const probabilities = partial ? null : calibrateRanking(ranking, artifact)
  const order = artifact.model_ids.map((_, i) => i).sort((a, b) => ranking[b] - ranking[a])
  const results = order.map((index) => ({
    id: artifact.model_ids[index],
    score: ranking[index],
    probability: probabilities ? probabilities[index] : null,
  }))

  return {
    decision: partial ? 'partial' : 'scored',
    sequence: shape,
    diagnostics,
    used_outputs: usable.length,
    results,
    ranking_score: ranking[order[0]],
    probability_status: probabilities ? 'reference_calibrated' : 'unavailable',
  }
}
