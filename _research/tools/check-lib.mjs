// Parity check: the plugin's lib/ modules must reproduce the verified port's numbers.
// Scores the same reference replies as verify.mjs and prints top1/top3/top5.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = 'D:/IT/DSH工作区/DSH插件/dsh-model-fingerprint'
const DATA = path.join(root, '_research', 'data')
const { loadDetector, supportsSharedDetector, modelDirectory } = await import(pathToFileURL(path.join(root, 'lib/detector.js')).href)
const { analyzeOutputs, parseNumbers, minimumNumbers } = await import(pathToFileURL(path.join(root, 'lib/fingerprint.js')).href)

const { artifact, bundle, source } = await loadDetector(root)
console.log('source', source, 'schema', artifact.schema, 'models', artifact.model_ids.length)
console.log('supports', supportsSharedDetector(bundle, artifact))

const rows = fs
  .readFileSync(path.join(DATA, 'unified_reference.decoded'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))

const byModel = new Map()
for (const row of rows) {
  if (!byModel.has(row.model.id)) byModel.set(row.model.id, [])
  for (const sample of row.samples) byModel.get(row.model.id).push(sample)
}

let tested = 0
let top1 = 0
let top3 = 0
let top5 = 0
let skipped = 0
const misses = []
for (const [model, samples] of byModel) {
  const usable = samples
    .map((s) => ({ text: s.text || '', expectedCount: s.expected_count || 0 }))
    .filter((s) => parseNumbers(s.text).length >= minimumNumbers(s.expectedCount))
  if (usable.length < 3) {
    skipped++
    continue
  }
  const analysis = analyzeOutputs(usable.slice(0, 3), artifact)
  if (analysis.decision !== 'scored') {
    misses.push([model, analysis.decision])
    continue
  }
  tested++
  const at = analysis.results.findIndex((r) => r.id === model)
  if (at === 0) top1++
  if (at >= 0 && at < 3) top3++
  if (at >= 0 && at < 5) top5++
  if (at !== 0) misses.push([model, analysis.results[0].id, at, analysis.results[0].probability])
}
console.log(`tested=${tested} skipped=${skipped} top1=${top1} top3=${top3} top5=${top5}`)
console.log('top1 rate', (top1 / tested).toFixed(3))
for (const miss of misses.slice(0, 20)) console.log(' miss', JSON.stringify(miss))
console.log('directory sample', JSON.stringify(modelDirectory(bundle, artifact).slice(0, 3)))
