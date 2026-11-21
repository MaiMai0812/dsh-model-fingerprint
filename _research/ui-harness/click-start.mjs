// click-start.mjs — 真跑一次「点开始检测」的完整链路。
//
// 挂载设置页 → 等 /catalog 回填选择器 → 点「开始检测」→ 轮询 DOM 直到出现结果或错误。
// 这会真的调用一次宿主已接入的模型（配置里 samples=1，所以只发一条提示词），
// 用来验证「UI 按钮 → /config → /detect → /job 轮询 → ResultView」整条链路。
//
// 用法：node click-start.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { JSDOM } from 'jsdom'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientFile = path.resolve(here, '..', '..', 'client.js')
const ORIGIN = process.env.DSH_GUI_URL || process.env.DSH_WEB_URL || 'http://127.0.0.1:61530'

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: `${ORIGIN}/`,
  pretendToBeVisual: true,
})
const { window } = dom
globalThis.window = window
globalThis.document = window.document
try {
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
} catch {
  /* 已有只读 navigator */
}
globalThis.HTMLElement = window.HTMLElement
globalThis.Node = window.Node
globalThis.Event = window.Event
globalThis.MouseEvent = window.MouseEvent
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const realFetch = globalThis.fetch.bind(globalThis)
const calls = []
const proxyFetch = async (url, init) => {
  const target = String(url).startsWith('http') ? String(url) : `${ORIGIN}${url}`
  calls.push(`${(init && init.method) || 'GET'} ${target.replace(ORIGIN, '')}`)
  return realFetch(target, init)
}
globalThis.fetch = proxyFetch
window.fetch = proxyFetch

const source = readFileSync(clientFile, 'utf8')
const captured = []
const fakeWindow = { __ModuleLoader__: { load(def) { captured.push(def) } } }
const moduleObj = { exports: {} }
const requireStub = id => (id === 'react' ? React : (() => { throw new Error(`unexpected require: ${id}`) })())
new Function('window', 'document', 'module', 'exports', 'require', source)(
  fakeWindow, window.document, moduleObj, moduleObj.exports, requireStub,
)
const mod = captured[0].factory(requireStub)

const dictionaries = {}
const locale = {
  register(ns, dict) { dictionaries[ns] = dict; return () => {} },
  bind(ns) {
    return (key, params) => {
      const pack = dictionaries[ns] || {}
      const template = (pack.zh || {})[key] !== undefined ? pack.zh[key] : key
      if (!params) return template
      return String(template).replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole))
    }
  },
}

let registered = null
const ctx = {
  effect(fn) { fn(); return () => {} },
  get: name => (name === 'locale' ? locale : name === 'slots' ? ctx.slots : undefined),
  locale,
  slots: {
    inject(name, fn) { fn() },
    register(slotDef, component) { registered = { slotDef, component }; return () => {} },
  },
}
mod.apply(ctx)

const container = window.document.getElementById('root')
const root = createRoot(container)
const flush = async (rounds = 1) => {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)) })
  }
}
const squash = () => container.textContent.replace(/\s+/g, ' ').trim()

await act(async () => { root.render(React.createElement(registered.component, { ctx })) })
for (let i = 0; i < 40; i += 1) {
  await flush(1)
  const provider = container.querySelector('select')
  if (provider && provider.options.length > 1) break
}
console.log('selects:', [...container.querySelectorAll('select')].map(s => `${s.value}[${s.options.length}]`).join(' | '))

const startBtn = [...container.querySelectorAll('button')].find(b => /^开始检测$/.test(b.textContent.trim()))
if (!startBtn) throw new Error('找不到「开始检测」按钮')
console.log('clicking:', startBtn.textContent.trim())
await act(async () => { startBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window })) })

let lastText = ''
for (let i = 0; i < 1800; i += 1) {
  await flush(1)
  const text = squash()
  if (text !== lastText && i % 20 === 0) {
    const chip = [...container.querySelectorAll('.mf_chip')].map(c => c.textContent.trim()).join(' · ')
    console.log(`t=${(i + 1) * 0.1}s`, text.slice(text.indexOf('开始检测'), text.indexOf('开始检测') + 120))
    lastText = text
  }
  if (container.querySelector('.mf_bar') || container.querySelector('.mf_error')) break
  if (/结果|不像语言模型|样本不足/.test(text) && !/检测中/.test(text)) break
}

console.log('\n=== 最终页面 ===')
const final = squash()
console.log('errors:', [...container.querySelectorAll('.mf_error')].map(e => e.textContent.trim()).join(' || ') || '(none)')
const heroIndex = final.indexOf('结果')
console.log('result block:', heroIndex >= 0 ? final.slice(heroIndex, heroIndex + 420) : '(没有结果区块)')
console.log('bars:', container.querySelectorAll('.mf_bar').length,
  '| values:', [...container.querySelectorAll('.mf_val')].map(v => v.textContent).join(' '))
console.log('hero:', (container.querySelector('.mf_name') || {}).textContent,
  '| prob:', (container.querySelector('.mf_prob') || {}).textContent)

// 检测结束后样本卡片应当仍在，并且点得开
const cards = [...container.querySelectorAll('.mf_sample')]
console.log('sample cards after done:', cards.length,
  '| statuses:', cards.map(c => (c.querySelector('span') || {}).textContent).join(' / '))
const openable = container.querySelector('.mf_sample.clickable')
if (openable) {
  await act(async () => { openable.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window })) })
  await flush(1)
  console.log('expand after done ->', container.querySelector('.mf_sample.open') ? 'OPEN' : 'not opened',
    '| meta:', (container.querySelector('.mf_detail .mf_meta') || {}).textContent || '(none)',
    '| out chars:', ((container.querySelector('.mf_out') || {}).textContent || '').length)
}
console.log('\nfetch 调用:', calls.length)
console.log(calls.slice(0, 24).join('\n'))
await act(async () => { root.unmount() })


