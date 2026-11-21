// Offline engine test: challenge generation, paste scoring, job lifecycle, state file.
// No network: everything here runs against the bundled detector data.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = 'D:/IT/DSH工作区/DSH插件/dsh-model-fingerprint'
const engine = await import(pathToFileURL(path.join(root, 'lib/engine.js')).href)
const { parseNumbers } = await import(pathToFileURL(path.join(root, 'lib/fingerprint.js')).href)

// 1. challenges
const challenges = engine.generateChallenges(3)
console.log('challenges', challenges.length, challenges.map((c) => `${c.expected_count}:${c.prompt.length}`).join(' '))
console.log('unique ids', new Set(challenges.map((c) => c.id)).size)
console.log('lengths ok', challenges.every((c) => c.expected_count >= 292 && c.expected_count <= 332))
console.log('prompt sample', JSON.stringify(challenges[0].prompt.slice(0, 120)))

// 2. state round-trip
const saved = await engine.saveConfig({ provider: 'demo-provider', model: 'demo', effort: 'low', samples: 3 })
console.log('saved config', JSON.stringify(saved))
const state = engine.readState()
console.log('state config', JSON.stringify(state.config))
console.log('state file', path.join('$DSH_HOME/storages/dsh-model-fingerprint/state.json'))

// 3. paste scoring against a real reference reply (expect correct model at rank 1)
// unified_reference.decoded 是可再生产物，缺了就当场从 data/*.zst 解压。
const referenceFile = path.join(root, '_research/data/unified_reference.decoded')
if (!fs.existsSync(referenceFile)) {
  const zstd = await import('node:zlib')
  const archive = fs.readdirSync(path.join(root, '_research/data')).find((name) => name.startsWith('unified_reference.jsonl.') && name.endsWith('.zst'))
  if (!archive) throw new Error('缺少 unified_reference 的 .zst 归档，无法做参考库回归')
  fs.writeFileSync(referenceFile, zstd.zstdDecompressSync(fs.readFileSync(path.join(root, '_research/data', archive))))
  console.log('decoded reference from', archive)
}
const rows = fs.readFileSync(referenceFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
const target = rows.find((row) => row.model.id === 'claude-sonnet-5') || rows[0]
const sample = target.samples.find((s) => parseNumbers(s.text).length > 200)
console.log('scoring reply from', target.model.id, 'numbers', parseNumbers(sample.text).length)
const scored = await engine.scoreTexts(root, [{ text: sample.text, expectedCount: sample.expected_count }])
console.log('decision', scored.analysis.decision, 'top', scored.analysis.top?.display_name, scored.analysis.top?.probability, 'status', scored.analysis.probability_status)
console.log('expected', target.model.id, 'hit', scored.analysis.top?.id === target.model.id)

// 4. job lifecycle (paste mode)
const jobId = engine.startJob(root, { mode: 'paste', outputs: [{ text: sample.text, expectedCount: sample.expected_count }] })
let job = null
for (let i = 0; i < 60; i++) {
  job = engine.readJob(jobId)
  if (job && job.status !== 'running') break
  await new Promise((resolve) => setTimeout(resolve, 100))
}
console.log('job', job.status, job.result?.top?.display_name, job.error || '')
console.log('cancel unknown', engine.cancelJob('nope'))
const jobId2 = engine.startJob(root, { mode: 'paste', outputs: [{ text: '1 2 3', expectedCount: 300 }] })
await new Promise((resolve) => setTimeout(resolve, 300))
console.log('short text job', engine.readJob(jobId2).status, engine.readJob(jobId2).error, engine.readJob(jobId2).result?.decision)
console.log('history', engine.readState().history.length)

// 5. detector info
const info = await engine.detectorInfo(root)
console.log('detector', info.supported, info.models.length, info.source, info.builtAt)

await engine.clearHistory()
console.log('history cleared', engine.readState().history.length)
