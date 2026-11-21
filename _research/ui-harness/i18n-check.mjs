// i18n-check.mjs — 对比 client.js 里 t('key') 用到的键与 DICT 实际拥有的键，
// 并检查 zh/en 两个语言的键集是否一致。
//
// 用法：node i18n-check.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// 只做键集比对、不渲染，所以不需要真的 React；这样 `node i18n-check.mjs`
// 在没装 node_modules 的干净副本里也能跑。
const React = {
  createElement: () => null,
  Fragment: Symbol('Fragment'),
  useState: value => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useMemo: factory => factory(),
  useCallback: fn => fn,
  useRef: value => ({ current: value }),
}

const here = path.dirname(fileURLToPath(import.meta.url))
const file = path.resolve(here, '..', '..', 'client.js')
const source = readFileSync(file, 'utf8')

const captured = []
const fakeWindow = { __ModuleLoader__: { load(def) { captured.push(def) } } }
const moduleObj = { exports: {} }
const requireStub = id => (id === 'react' ? React : (() => { throw new Error(`unexpected require: ${id}`) })())
const fakeDoc = {
  createElement: () => ({ setAttribute() {}, remove() {}, textContent: '' }),
  head: { appendChild() {} },
  querySelector: () => null,
}
new Function('window', 'document', 'module', 'exports', 'require', source)(
  fakeWindow, fakeDoc, moduleObj, moduleObj.exports, requireStub,
)

const dicts = {}
const ctx = {
  effect: fn => fn(),
  get: name => (name === 'locale' ? ctx.locale : name === 'slots' ? ctx.slots : undefined),
  locale: { register: (ns, dict) => { dicts[ns] = dict; return () => {} }, bind: () => key => key },
  slots: { inject() {}, register() { return () => {} } },
}
captured[0].factory(requireStub).apply(ctx)
const dict = dicts['settings.modelFingerprint']
if (!dict) throw new Error('词典没有注册到 settings.modelFingerprint')

const used = new Set()
for (const match of source.matchAll(/\bt\(\s*(['"])([^'"]+)\1\s*\)/g)) used.add(match[2])
for (const match of source.matchAll(/\bt\(\s*(['"])([^'"]+)\1\s*,/g)) used.add(match[2])

console.log('namespace:', Object.keys(dict).join(', '))
let failed = false
for (const lang of ['zh', 'en']) {
  const table = dict[lang] || {}
  const keys = new Set(Object.keys(table))
  const missing = [...used].filter(key => !keys.has(key))
  const unused = [...keys].filter(key => !used.has(key))
  console.log(`\n[${lang}] entries=${keys.size} used=${used.size} missing=${missing.length} unused=${unused.length}`)
  if (missing.length) console.log('  missing:', missing.join(', '))
  if (unused.length) console.log('  unused:', unused.join(', '))
  if (missing.length) failed = true
}

const zh = new Set(Object.keys(dict.zh || {}))
const en = new Set(Object.keys(dict.en || {}))
const onlyZh = [...zh].filter(key => !en.has(key))
const onlyEn = [...en].filter(key => !zh.has(key))
console.log('\nonly in zh:', onlyZh.join(', ') || '(none)')
console.log('only in en:', onlyEn.join(', ') || '(none)')
if (onlyZh.length || onlyEn.length) failed = true

const emptyValues = []
for (const lang of ['zh', 'en']) {
  for (const [key, value] of Object.entries(dict[lang] || {})) {
    if (typeof value !== 'string' || value.trim() === '') emptyValues.push(`${lang}:${key}`)
  }
}
console.log('empty values:', emptyValues.join(', ') || '(none)')
if (emptyValues.length) failed = true

console.log('\nverdict:', failed ? 'FAIL' : 'OK')
if (failed) process.exitCode = 1

