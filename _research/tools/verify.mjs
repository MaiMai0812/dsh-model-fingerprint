// Reimplementation check: mirror the shared detector algorithm in plain JS and score
// reference replies from unified_reference.jsonl. If the top-1 matches the sample's own
// model most of the time, the port is faithful.
import fs from 'node:fs'
import path from 'node:path'

const DATA = 'D:/IT/DSH工作区/DSH插件/dsh-model-fingerprint/_research/data'
const VALUE_MIN = 1
const VALUE_MAX = 355
const DIMENSION = VALUE_MAX - VALUE_MIN + 1
const ALPHA = 0.5

function parseNumbers(text) {
  const runs = []
  let current = []
  let previousEnd = 0
  for (const match of String(text).matchAll(/\d+/g)) {
    const separator = String(text).slice(previousEnd, match.index)
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

const countNumbers = (numbers) => {
  const counts = Array(DIMENSION).fill(0)
  numbers.forEach((n) => { counts[n - VALUE_MIN] += 1 })
  return counts
}
const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length
function standardize(values) {
  const center = mean(values)
  const variance = mean(values.map((v) => (v - center) ** 2))
  const scale = Math.max(Math.sqrt(variance), 1e-12)
  return values.map((v) => (v - center) / scale)
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }
const norm = (v) => Math.sqrt(dot(v, v))
const normalized = (v) => { const s = Math.max(norm(v), 1e-12); return v.map((x) => x / s) }
function subtractBasis(values, basis) {
  const out = values.slice()
  for (const vector of basis || []) {
    const projection = dot(out, vector)
    for (let i = 0; i < out.length; i++) out[i] -= projection * vector[i]
  }
  return out
}
function hellingerFeature(counts) {
  const total = counts.reduce((s, v) => s + v, 0) + ALPHA * DIMENSION
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
function orderedBlockFeature(numbers) {
  const pieces = []
  for (const chunk of splitIntoFour(numbers)) {
    const bins = Array(16).fill(0.5)
    for (const value of chunk) bins[Math.min(15, Math.floor(((value - 1) / 355) * 16))] += 1
    const total = bins.reduce((s, v) => s + v, 0)
    pieces.push(...bins.map((v) => Math.sqrt(v / total)))
  }
  const lastDigits = Array(10).fill(0.5)
  numbers.forEach((value) => { lastDigits[value % 10] += 1 })
  const lastTotal = lastDigits.reduce((s, v) => s + v, 0)
  pieces.push(...lastDigits.map((v) => Math.sqrt(v / lastTotal)))
  return pieces
}

const POSITIONAL_WEIGHTS = [0.6, 0.15, 0.125, 0.125]
const CENTRES = Array.from({ length: 24 }, (_, i) => 1 + (i * 354) / 23)
const LAGS = [1, 2, 3, 5, 8, 13, 21, 34]
const fraction = (length, test) => { let hits = 0; for (let i = 0; i < length; i++) if (test(i)) hits++; return hits / length }
function positionKernel(x) {
  const n = x.length
  const out = Array(34 * 3).fill(0)
  x.forEach((value, position) => {
    const t = ((position + 0.5) * 2) / n - 1
    const basis = [t, 0.5 * (3 * t * t - 1), 0.5 * (5 * t ** 3 - 3 * t)]
    const features = [...CENTRES.map((centre) => Math.exp(-0.5 * ((value - centre) / 20) ** 2)),
      ...Array.from({ length: 10 }, (_, digit) => (digit === value % 10 ? 1 : 0))]
    features.forEach((weight, k) => basis.forEach((b, j) => { out[k * 3 + j] += (weight * b) / n }))
  })
  return out
}
function centredTransitions(symbols, bins) {
  const joint = Array(bins * bins).fill(0.5)
  const total = symbols.length - 1 + 0.5 * bins * bins
  for (let i = 1; i < symbols.length; i++) joint[symbols[i - 1] * bins + symbols[i]] += 1
  for (let i = 0; i < joint.length; i++) joint[i] /= total
  const rows = Array.from({ length: bins }, (_, a) => joint.slice(a * bins, a * bins + bins).reduce((s, v) => s + v, 0))
  const columns = Array.from({ length: bins }, (_, b) => rows.reduce((s, _, a) => s + joint[a * bins + b], 0))
  return joint.map((value, i) => value - rows[Math.floor(i / bins)] * columns[i % bins])
}
function sequenceFeatures(x) {
  const n = x.length
  const m = mean(x)
  const sd = Math.max(Math.sqrt(mean(x.map((v) => (v - m) ** 2))), 1)
  const s = x.map((v) => (v - m) / sd)
  const out = []
  for (const lag of LAGS) {
    const count = n - lag
    const d = Array.from({ length: count }, (_, i) => x[i + lag] - x[i])
    out.push(mean(d.map((_, i) => s[i + lag] * s[i])), mean(d.map(Math.abs)) / 355, fraction(count, (i) => d[i] > 0),
      fraction(count, (i) => d[i] === 0), fraction(count, (i) => Math.abs(d[i]) <= 5), fraction(count, (i) => Math.abs(d[i]) <= 20))
  }
  out.push(...centredTransitions(x.map((v) => Math.min(7, Math.floor(((v - 1) * 8) / 355))), 8))
  out.push(...centredTransitions(x.map((v) => v % 10), 10))
  const difference = Array.from({ length: n - 1 }, (_, i) => x[i + 1] - x[i])
  const zStep = Array.from({ length: n - 1 }, (_, i) => Math.abs(s[i + 1] - s[i]))
  out.push(fraction(n - 2, (i) => Math.sign(difference[i + 1]) === Math.sign(difference[i])),
    fraction(n - 2, (i) => difference[i + 1] === difference[i]),
    fraction(n - 1, (i) => x[i] % 10 === x[i + 1] % 10),
    fraction(n - 1, (i) => zStep[i] > 1), fraction(n - 1, (i) => zStep[i] > 2))
  const buckets = x.map((v) => Math.min(15, Math.floor(((v - 1) * 16) / 355)))
  for (const width of [4, 8, 16]) {
    let sum = 0
    for (let i = 0; i + width <= n; i++) sum += new Set(buckets.slice(i, i + width)).size / width
    out.push(sum / (n - width + 1))
  }
  return out
}
const positionalFeatures = (numbers) => [hellingerFeature(countNumbers(numbers)), orderedBlockFeature(numbers), positionKernel(numbers), sequenceFeatures(numbers)]
function positionalDecision(numbers, head) {
  const parts = positionalFeatures(numbers)
  const x = parts.flatMap((block, j) => {
    const p = head.params[j]
    const scaled = block.map((v, i) => (v - p.mean[i]) / p.scale[i])
    const length = Math.max(Math.sqrt(scaled.reduce((s, v) => s + v * v, 0)), 1e-12)
    return scaled.map((v) => (v / length) * Math.sqrt(POSITIONAL_WEIGHTS[j]))
  })
  return head.weights.map((row, k) => row.reduce((sum, w, i) => sum + w * x[i], head.bias[k]))
}

const z = (a) => { const m = mean(a); const s = Math.max(Math.sqrt(mean(a.map((x) => (x - m) ** 2))), 1e-12); return a.map((x) => (x - m) / s) }
const columnMean = (a) => a[0].map((_, i) => mean(a.map((r) => r[i])))
const median = (a) => { const v = [...a].sort((x, y) => x - y); const i = Math.floor(v.length / 2); return v.length % 2 ? v[i] : (v[i - 1] + v[i]) / 2 }
const blocks = (n) => [hellingerFeature(countNumbers(n)), orderedBlockFeature(n)]
const transform = (b, p) => b.flatMap((v, j) => normalized(v.map((x, i) => (x - p[j].mean[i]) / p[j].scale[i])).map((x) => x * Math.sqrt(j === 0 ? 0.75 : 0.25)))
const centered = (v, p) => v.map((x, i) => (x - p.feature_mean[i]) / p.feature_scale[i])
function subtract(v, basis) {
  const coefficients = basis.map((row) => dot(v, row))
  return v.map((x, i) => x - basis.reduce((sum, row, j) => sum + coefficients[j] * row[i], 0))
}
const referenceNorms = new WeakMap()
function nearest(x, references) {
  let norms = referenceNorms.get(references)
  if (!norms) { norms = references.map((r) => dot(r, r)); referenceNorms.set(references, norms) }
  const xx = dot(x, x)
  return mean(references.map((r, i) => Math.max(0, xx + norms[i] - 2 * dot(x, r))).sort((a, b) => a - b).slice(0, 7))
}
function baseline(b, bank) {
  const h = bank.hellinger
  const o = bank.ordered_blocks
  const hUnit = normalized(subtract(centered(b[0], h), h.nuisance_basis))
  const marginal = h.centroids.map((row) => dot(hUnit, row))
  const oCentered = centered(b[1], o)
  const raw = normalized(oCentered)
  const projected = normalized(subtract(oCentered, o.nuisance_basis))
  const templates = o.centroids.map((_, i) => Math.max(...o.environment_centroids.map((rows) => dot(raw, rows[i]))))
  const nuisance = o.centroids.map((row) => dot(projected, row))
  const tz = z(templates)
  const nz = z(nuisance)
  const ordered = z(tz.map((v, i) => 0.5 * v + 0.5 * nz[i]))
  const mz = z(marginal)
  return mz.map((v, i) => 0.5 * v + 0.5 * ordered[i])
}
function rankSharedNumbers(numbers, artifact) {
  const a = artifact.ranker
  const full = numbers.map(blocks)
  const ax = full.map((b) => transform(b, a.full_params))
  const lda = numbers.map((n) => {
    const x = transform(blocks(n.slice(0, 128)), a.head_params)
    return z(a.lda_weights.map((row, i) => dot(row, x) + a.lda_bias[i]))
  })
  const l = z(columnMean(lda))
  const near = z(a.references.map((ref) => median(ax.map((x) => -nearest(x, ref)))))
  const base = z(columnMean(full.map((b) => baseline(b, a.bank))))
  const frequency = z(l.map((x, i) => 0.5 * x + 0.25 * near[i] + 0.25 * base[i]))
  const positional = z(columnMean(numbers.map((n) => z(positionalDecision(n, a.positional)))))
  return frequency.map((x, i) => a.blend.frequency * x + a.blend.positional * positional[i])
}
function calibrateRanking(ranking, artifact) {
  const head = artifact.calibration
  const binding = head && head.binding
  if (!head || !binding || head.schema !== 'shared-confidence-v2' || head.method !== 'ranking-temperature') return null
  if (binding.base_sha256 !== artifact.base_sha256 || binding.reference_sha256 !== artifact.source_reference_sha256) return null
  if (binding.model_ids.length !== ranking.length) return null
  const logits = ranking.map((score) => head.tau * score)
  const maximum = Math.max(...logits)
  const weights = logits.map((v) => Math.exp(v - maximum))
  const sum = weights.reduce((a, b) => a + b, 0)
  return weights.map((v) => v / sum)
}

const SEQUENCE_LIMITS = { autocorrelation: -0.23, small_step_share: 0.05 }
function sequenceShape(numbers) {
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
  return { autocorrelation, small_step_share, model_like: autocorrelation <= SEQUENCE_LIMITS.autocorrelation || small_step_share <= SEQUENCE_LIMITS.small_step_share }
}

// ---- load data ----
const bundle = JSON.parse(fs.readFileSync(path.join(DATA, 'bundle.json'), 'utf8'))
const raw = fs.readFileSync(path.join(DATA, 'shared_detector.bin'))
const headerLength = raw.readUInt32LE(0)
const start = Math.ceil((4 + headerLength) / 4) * 4
const count = (raw.length - start) / 4
const floats = new Float32Array(count)
{
  const interleaved = Buffer.alloc(count * 4)
  for (let b = 0; b < 4; b++) for (let i = 0; i < count; i++) interleaved[i * 4 + b] = raw[start + b * count + i]
  for (let i = 0; i < count; i++) floats[i] = interleaved.readFloatLE(i * 4)
}
const artifact = JSON.parse(raw.subarray(4, 4 + headerLength).toString('utf8'), (_, value) =>
  value && typeof value === 'object' && '$f32' in value ? Array.from(floats.subarray(value.$f32, value.$f32 + value.n)) : value)
console.log('schema', artifact.schema, 'models', artifact.model_ids.length, 'tau', artifact.calibration.tau)
console.log('blend', artifact.ranker.blend)

// ---- score reference replies ----
const rows = fs.readFileSync(path.join(DATA, 'unified_reference.decoded'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const byModel = new Map()
for (const row of rows) {
  const id = row.model.id
  if (!byModel.has(id)) byModel.set(id, [])
  for (const sample of row.samples) byModel.get(id).push(sample)
}
let tested = 0
let top1 = 0
let top3 = 0
let top5 = 0
let skipped = 0
const failures = []
for (const [model, samples] of byModel) {
  const usable = samples.map((s) => ({ text: s.text || '', expected: s.expected_count || 0 }))
    .filter((s) => parseNumbers(s.text).length >= Math.max(80, Math.ceil(s.expected * 0.55)))
  if (usable.length < 3) { skipped++; continue }
  const picked = usable.slice(0, 3)
  const parsed = picked.map((s) => parseNumbers(s.text))
  const shape = sequenceShape(parsed)
  if (!shape.model_like) { failures.push([model, 'not_model', shape.autocorrelation, shape.small_step_share]); continue }
  const ranking = rankSharedNumbers(parsed, artifact)
  const probs = calibrateRanking(ranking, artifact)
  const order = artifact.model_ids.map((_, i) => i).sort((i, j) => ranking[j] - ranking[i])
  tested++
  const at = order.indexOf(artifact.model_ids.indexOf(model))
  if (at === 0) top1++
  if (at >= 0 && at < 3) top3++
  if (at >= 0 && at < 5) top5++
  if (at !== 0) failures.push([model, artifact.model_ids[order[0]], at, probs ? probs[order[0]].toFixed(3) : null])
}
console.log(`tested=${tested} skipped=${skipped} top1=${top1} top3=${top3} top5=${top5}`)
console.log('top1 rate', (top1 / tested).toFixed(3))
console.log('misses:')
for (const f of failures.slice(0, 40)) console.log(' ', JSON.stringify(f))
