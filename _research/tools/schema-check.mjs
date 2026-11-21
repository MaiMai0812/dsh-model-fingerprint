// 离线校验：把宿主里的 dsh-tools/json-schema.js 拉出来，用桩替换两个依赖，
// 然后对本插件 index.js 里声明的工具参数/值 schema 与真实返回值做一次校验。
// 目的：在安装前发现 JsonSchemaError 或 ToolOutputError。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const REF = path.join(import.meta.dirname, '..', 'ref', 'dsh-tools-json-schema.js')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-schema-'))
const src = fs.readFileSync(REF, 'utf8')
  .replace("import { HarnessError } from '@deepseek-ai/dsh-llm';", 'class HarnessError extends Error { constructor(message, code) { super(message); this.code = code; this.name = this.constructor.name; } }')
  .replace("import { assertNever, isJsonValue } from '@deepseek-ai/dsh-util-values';", `
function assertNever(value) { throw new Error('unexpected ' + String(value)); }
function isJsonValue(value, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry));
  if (typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
    return Object.values(value).every((entry) => isJsonValue(entry));
  }
  return false;
}
`)
const file = path.join(tmp, 'json-schema.mjs')
fs.writeFileSync(file, src, 'utf8')

const { pathToFileURL } = await import('node:url')
const { assertSupportedJsonSchema, validateJsonSchemaValue } = await import(pathToFileURL(file).href)

const detectionOutputSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    decision: { type: 'string' },
    used_outputs: { type: 'number' },
    results: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } },
  },
}

const parameters = {
  type: 'object',
  properties: {
    action: { type: 'string' },
    base_url: { type: 'string' },
    api_key: { type: 'string' },
    model: { type: 'string' },
    format: { type: 'string' },
    effort: { type: 'string' },
    parallel: { type: 'boolean' },
    relaxed: { type: 'boolean' },
    texts: { type: 'array', items: { type: 'string' } },
    expected_count: { type: 'integer' },
  },
  required: ['action'],
}

for (const [label, schema] of [['parameters', parameters], ['output', detectionOutputSchema]]) {
  assertSupportedJsonSchema(schema)
  console.log(`${label}: schema OK`)
}

const scoredValue = {
  decision: 'scored',
  used_outputs: 3,
  sequence: { autocorrelation: -0.4, small_step_share: 0.01, model_like: true },
  diagnostics: [{ challenge_id: 'probe-1', expected_count: 319, numbers: 319, minimum: 176, accepted: true }],
  probability_status: 'reference_calibrated',
  results: [
    { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', family_name: 'Claude', response_count: 36, score: 1.234, probability: 0.51 },
    { id: 'gpt-5', display_name: 'GPT-5', family_name: 'GPT', response_count: 36, score: 0.12, probability: null },
  ],
  top: { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', family_name: 'Claude', response_count: 36, score: 1.234, probability: 0.51 },
  model: 'm',
  base_url: 'https://x/v1',
  format: 'openai',
  sampled: 3,
  built_at: '2026-11-12T18:48:30.723628+00:00',
  source: 'package',
}
const violations = validateJsonSchemaValue(detectionOutputSchema, scoredValue, 'value')
console.log('scored value violations:', violations.length === 0 ? 'none' : violations)

const modelsValue = { count: 70, built_at: '2026-11-12T18:48:30.723628+00:00', models: [{ id: 'a', display_name: 'A', family: 'f', family_name: 'F', response_count: 36 }] }
console.log('models value violations:', validateJsonSchemaValue(detectionOutputSchema, modelsValue, 'value'))

const dataValue = { decision: 'data', schema: 'shared-detector-v2', built_at: 'x', models: 70, source: 'package', supported: true, bytes: 5090952 }
console.log('data value violations:', validateJsonSchemaValue(detectionOutputSchema, dataValue, 'value'))

fs.rmSync(tmp, { recursive: true, force: true })
