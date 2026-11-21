// render.mjs — 用 jsdom + react-dom/client 真渲染 client.js 的设置页。
//
// 验证四件事：
// 1) 模块能被 __ModuleLoader__ 正确加载，apply() 注册到 settings.section；
// 2) 首屏（真实 /state、/catalog 请求）里的选择器、按钮、文案；
// 3) 切到英文后整页跟着换语言；
// 4) 结果视图在「有校准概率」和「只有相对分数」两种数据下都画得对。
//
// 用法：node render.mjs   （需要插件已在 DSH 里跑着，先 npm i；端口用 DSH_GUI_URL 或 DSH_WEB_URL 覆盖）

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
  /* node 已有只读 navigator */
}
globalThis.HTMLElement = window.HTMLElement
globalThis.Node = window.Node
globalThis.Event = window.Event
globalThis.MouseEvent = window.MouseEvent
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// jsdom 没有 IE 时代的 attachEvent：React 的 change 事件 polyfill 在 focusin 时会调用
// activeElement.attachEvent('onpropertychange', …)，缺了它会在派发输入时抛 TypeError。
// 补两个空实现即可；真正的值变化检测走 keydown/keyup 分支。
for (const name of ['attachEvent', 'detachEvent']) {
  if (typeof window.HTMLElement.prototype[name] !== 'function') {
    window.HTMLElement.prototype[name] = function () {}
  }
}

const realFetch = globalThis.fetch.bind(globalThis)
const calls = []
// 单条重试用：把 /retry 与 /job?id=retry-N 换成预置响应，避免真的去打模型。
// jobs 里每个 jobId 一份帧队列，用来验证「同时重试好几条」时各条互不干扰。
let retryStub = null // { frames: [running, done], seq: 0, created: [], jobs: {} }
const makeRetryStub = frames => ({ frames, seq: 0, created: [], jobs: {} })
// 后台作业接回用：把 /active 与 ?/job?id=attach-test 换成预置响应
let activeStub = null
// 总览用：挂载时把 /state 与 /history 里的历史换成这份预置数据
let stateStub = null
const jsonResponse = payload => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})
const proxyFetch = async (url, init) => {
  const target = String(url).startsWith('http') ? String(url) : `${ORIGIN}${url}`
  calls.push(`${(init && init.method) || 'GET'} ${target.replace(ORIGIN, '')}`)
  if (target.includes('/dsh-model-fingerprint/active')) {
    const jobs = activeStub && activeStub.jobs ? activeStub.jobs : (activeStub && activeStub.job ? [activeStub.job] : [])
    return jsonResponse({
      ok: true,
      job: activeStub ? activeStub.job : null,
      jobs,
      last: activeStub && activeStub.last ? activeStub.last : null,
    })
  }
  if (activeStub && activeStub.job && target.includes(`/job?id=${activeStub.job.id}`)) {
    const frames = activeStub.frames
    const next = frames.length > 1 ? frames.shift() : frames[0]
    return jsonResponse({ ok: true, job: next })
  }
  if (retryStub) {
    if (target.includes('/dsh-model-fingerprint/retry')) {
      const id = `retry-${(retryStub.seq += 1)}`
      retryStub.created.push(id)
      retryStub.jobs[id] = retryStub.frames.slice()
      return jsonResponse({ ok: true, jobId: id })
    }
    const match = target.match(/\/job\?id=(retry-\d+)/)
    if (match && retryStub.jobs[match[1]]) {
      const frames = retryStub.jobs[match[1]]
      const next = frames.length > 1 ? frames.shift() : frames[0]
      return jsonResponse({ ok: true, job: next })
    }
  }
  // 总览用：把挂载时拉到的历史换成预置的那份（模拟「历史还停在收尾之前」）
  if (stateStub) {
    if (target.includes('/dsh-model-fingerprint/history')) {
      return jsonResponse({ ok: true, history: stateStub })
    }
    if (target.includes('/dsh-model-fingerprint/state')) {
      const real = await realFetch(target, init)
      const body = await real.json()
      return jsonResponse({ ...body, history: stateStub })
    }
  }
  return realFetch(target, init)
}
globalThis.fetch = proxyFetch
window.fetch = proxyFetch

const source = readFileSync(clientFile, 'utf8')
const captured = []
const fakeWindow = { __ModuleLoader__: { load(def) { captured.push(def) } } }
const moduleObj = { exports: {} }

function loadModule(react) {
  const requireStub = id => {
    if (id === 'react') return react || React
    throw new Error(`unexpected require: ${id}`)
  }
  captured.length = 0
  moduleObj.exports = {}
  new Function('window', 'document', 'module', 'exports', 'require', source)(
    fakeWindow, window.document, moduleObj, moduleObj.exports, requireStub,
  )
  const def = captured[0]
  return { def, mod: def.factory(requireStub) }
}

// ---- locale 桩：复刻 locale-client.js:1711-1723 的语义（dict[key] 直接索引、回落 en）
const dictionaries = {}
let activeLocale = 'zh'
const locale = {
  register(ns, dict) {
    dictionaries[ns] = dict
    return () => { delete dictionaries[ns] }
  },
  bind(ns) {
    return (key, params) => {
      const pack = dictionaries[ns] || {}
      const table = pack[activeLocale] || {}
      const fallback = pack.en || {}
      const template = table[key] !== undefined ? table[key] : fallback[key] !== undefined ? fallback[key] : key
      if (!params) return template
      return String(template).replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole))
    }
  },
}

const cleanups = []
function makeCtx() {
  const box = { slots: {} }
  const ctx = {
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') cleanups.push(dispose); return () => {} },
    get(name) {
      if (name === 'locale') return locale
      if (name === 'slots') return ctx.slots
      return undefined
    },
    locale,
    slots: {
      inject(name, fn) { fn() },
      register(slotDef, component) { box.slots[slotDef.name] = { slotDef, component }; return () => { delete box.slots[slotDef.name] } },
    },
  }
  return { ctx, box }
}

const flush = async (rounds = 3) => {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)) })
  }
}
// 等某个条件成立（真实网络请求是异步的，固定轮数有时不够）
const waitFor = async (predicate, timeoutMs = 5000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true
    await flush(1)
  }
  return false
}
const squash = node => node.textContent.replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------- 1. 首屏

const first = loadModule()
console.log('module id:', first.def.id, '| exports:', Object.keys(first.mod).join(','))
console.log('inject decl:', JSON.stringify(first.mod.inject))

const primary = makeCtx()
first.mod.apply(primary.ctx)
console.log('registered slots:', Object.keys(primary.box.slots).join(','))
console.log('main slot:', JSON.stringify(primary.box.slots.main && primary.box.slots.main.slotDef))
console.log('sidebar row:', JSON.stringify(primary.box.slots['sidebar.panellist'] && primary.box.slots['sidebar.panellist'].slotDef))
console.log('style injected:', !!window.document.querySelector('style[data-plugin="dsh-model-fingerprint"]'))

const container = window.document.getElementById('root')
const root = createRoot(container)
await act(async () => { root.render(React.createElement(primary.box.slots.main.component, { ctx: primary.ctx })) })
await flush(2)
// 目录是否到了：数 .mf_group 会被「历史里才有的供应商」误导（首屏就有几个），
// 直接看服务商下拉有没有选项更可靠。
const catalogReady = await waitFor(() => {
  const pick = container.querySelector('select')
  return Boolean(pick && pick.options.length > 1)
})
console.log('catalog loaded in harness:', catalogReady,
  `| providers=${container.querySelectorAll('.mf_group').length}`)

console.log('\n=== 首屏（中文）===')
console.log('nav label:', primary.box.slots['sidebar.panellist'].slotDef.label())
console.log('text:', squash(container).slice(0, 460))
console.log('buttons:', [...container.querySelectorAll('button')].map(b => `${b.textContent.trim()}${b.disabled ? '(disabled)' : ''}`).join(' | '))
console.log('selects:', [...container.querySelectorAll('select')].map(s => `${s.value || '∅'}[${s.options.length}]`).join(' | '))
console.log('textareas:', container.querySelectorAll('textarea').length, '| checkboxes:', container.querySelectorAll('input[type="checkbox"]').length)
const chips = [...container.querySelectorAll('.mf_chip')].map(c => c.textContent.trim())
console.log('chips:', chips.join(' · '))
const errors = [...container.querySelectorAll('.mf_error')].map(e => e.textContent.trim())
console.log('errors:', errors.join(' || ') || '(none)')

// 粘贴评分栏已下线：页面里不该再有 textarea，也不该有「评分」按钮
const scoreBtn = [...container.querySelectorAll('button')].find(b => /^(评分|Score)$/.test(b.textContent.trim()))
console.log('paste section removed:', container.querySelectorAll('textarea').length === 0 && !scoreBtn,
  `| textareas=${container.querySelectorAll('textarea').length} | score button=${scoreBtn ? 'present' : 'absent'}`)
const groupEls = [...container.querySelectorAll('.mf_group')]
console.log('overview groups:', groupEls.length,
  '| rows visible while collapsed:', container.querySelectorAll('.mf_grow').length,
  '| title:', (container.querySelector('.mf_card h3') || {}).textContent)
console.log('group heads:', groupEls.slice(0, 5).map(g => g.querySelector('.mf_ghead').textContent.trim()).join(' ⏐ '))
if (groupEls[0]) {
  await act(async () => { groupEls[0].querySelector('.mf_ghead').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window })) })
  await flush(1)
  const firstGroup = container.querySelector('.mf_group')
  const rows = [...firstGroup.querySelectorAll('.mf_grow')].map(r => r.textContent.replace(/\s+/g, ' ').trim())
  console.log('expand first group -> rows:', rows.length, '|', rows.slice(0, 4).join(' ⏐ '))
  const testedRows = rows.filter(row => !/未测试|Not tested/.test(row)).length
  console.log('tested in group:', testedRows, '| untested in group:', rows.length - testedRows)
  await act(async () => { firstGroup.querySelector('.mf_ghead').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window })) })
  await flush(1)
  console.log('collapse group -> rows back to:', container.querySelectorAll('.mf_grow').length)
}

// 总览搜索框：按供应商名 / 供应商 id / 模型名 / 模型 id 做子串过滤，命中组自动展开
{
  const box = () => container.querySelector('.mf_ov input[type="search"]')
  const first = box()
  console.log('overview search box:', first
    ? `present (placeholder: ${first.getAttribute('placeholder')} | aria-label: ${first.getAttribute('aria-label')})`
    : 'MISSING')
  if (first) {
    const type = async value => {
      const input = box()
      if (!input) return false
      // jsdom 里 React 判定「原生 input 事件不支持」，走的是 change 事件 polyfill：
      // 只有在 focusin 之后、由 keydown/keyup/selectionchange 触发的值变化才会派发 onChange。
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      await act(async () => {
        input.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }))
        setter.call(input, value)
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Unidentified', bubbles: true }))
        input.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Unidentified', bubbles: true }))
      })
      await flush(2)
      return true
    }
    await type('kimi')
    const rowsOf = () => [...container.querySelectorAll('.mf_grow')].map(r => r.textContent.replace(/\s+/g, ' ').trim())
    console.log('search "kimi" -> groups:', container.querySelectorAll('.mf_group').length,
      '| rows:', rowsOf().join(' ⏐ ') || '(none)')
    await type('zzz-no-such-model')
    console.log('search miss -> groups:', container.querySelectorAll('.mf_group').length,
      '| note:', (container.querySelector('.mf_ov .mf_empty') || {}).textContent || '(none)')
    await type('')
    console.log('search cleared -> groups back to:', container.querySelectorAll('.mf_group').length,
      '| rows:', container.querySelectorAll('.mf_grow').length,
      '| input value:', JSON.stringify(box() ? box().value : null))
  }
}

// ---------------------------------------------------------------- 2. 英文

await act(async () => { activeLocale = 'en' })
await act(async () => { root.render(React.createElement(primary.box.slots.main.component, { ctx: primary.ctx })) })
await flush(2)
console.log('\n=== 英文 ===')
console.log('text:', squash(container).slice(0, 320))
console.log('nav label:', primary.box.slots['sidebar.panellist'].slotDef.label())
activeLocale = 'zh'
await act(async () => { root.unmount() })

// ---------------------------------------------------------------- 3. 结果视图（数据侧种子）

// React 19 的受控 input 在假 DOM 里推不动 onChange，所以结果视图用「种子 hooks」
// 把载荷直接塞进 useState 的初值，只验证渲染本身。
function renderSeeded(payload, extra = {}) {
  let hookIndex = 0
  // hooks: 0 config, 1 detector, 2 catalog, 3 selection, 4 efforts, 5 history, 6 error,
  // 7 notice, 8 busy, 9 progress, 10 samples, 11 openSample, 12 retrying, 13 result,
  // 14 resultAt, 15 clearedAt, 16 openGroups, 17 Overview 内部的 query
  // （Page 里每加一个 useState，后面的下标就整体后移一格，改的时候一起改）
  const seeded = {
    17: '',
    ...extra,
    10: [
      { id: 's1', expected_count: 300, prompt: '写 300 个 1 到 355 的整数', text: '37 12 199 88 41 6 203 155 19 71', count: 10, state: 'done', status: '', error: null, output_tokens: 912, decode_ms: 21100, basis_ms: 21100, basis: 'decode', buffered: false, tps: 43.2 },
      { id: 's2', expected_count: 300, prompt: '写 300 个整数', text: '', count: 0, state: 'rejected', status: '上游超时', error: 'timeout after 250s', output_tokens: null, decode_ms: 0, tps: null },
      { id: 's3', expected_count: 300, prompt: '写 300 个整数', text: '7 44 190 3', count: 4, state: 'capped', status: '', error: null, output_tokens: 305, decode_ms: 9800, basis_ms: 41200, basis: 'total', buffered: true, tps: 7.4 },
    ],
    13: payload,
  }
  const seededReact = {
    ...React,
    useState(initial) {
      const index = hookIndex++
      return React.useState(index in seeded ? seeded[index] : initial)
    },
  }
  const { mod } = loadModule(seededReact)
  const box = { slots: {} }
  const ctx = {
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') cleanups.push(dispose); return () => {} },
    get(name) { return name === 'locale' ? locale : name === 'slots' ? ctx.slots : undefined },
    locale,
    slots: {
      inject(name, fn) { fn() },
      register(slotDef, component) { box.slots[slotDef.name] = { slotDef, component }; return () => {} },
    },
  }
  hookIndex = 0
  mod.apply(ctx)
  hookIndex = 0
  const node = window.document.createElement('div')
  window.document.body.appendChild(node)
  return { box, ctx, node }
}

const model = (id, display_name, family_name, score, probability) => ({
  id, display_name, family_name, response_count: 36, score, probability,
})

const calibrated = {
  decision: 'scored',
  used_outputs: 3,
  probability_status: 'reference_calibrated',
  provider: 'model-failover',
  model: 'default',
  sequence: { autocorrelation: -0.271, small_step_share: 0.041 },
  diagnostics: [],
  results: [
    model('claude-sonnet-5', 'claude-sonnet-5', 'Claude', 5.41, 0.412),
    model('claude-opus-4.6', 'claude-opus-4.6', 'Claude', 5.02, 0.221),
    model('gemini-3.6-pro', 'gemini-3.6-pro', 'Gemini', 4.88, 0.147),
    model('gpt-5.2', 'gpt-5.2', 'GPT', 4.61, 0.089),
  ],
  top: model('claude-sonnet-5', 'claude-sonnet-5', 'Claude', 5.41, 0.412),
}

const partial = {
  ...calibrated,
  decision: 'partial',
  used_outputs: 1,
  probability_status: 'unavailable',
  results: calibrated.results.map(row => ({ ...row, probability: null })),
  top: { ...calibrated.top, probability: null },
}

for (const [label, payload] of [['校准（scored）', calibrated], ['未校准（partial）', partial]]) {
  const seeded = renderSeeded(payload)
  const seededRoot = createRoot(seeded.node)
  await act(async () => { seededRoot.render(React.createElement(seeded.box.slots.main.component, { ctx: seeded.ctx })) })
  await flush(2)
  const text = squash(seeded.node)
  const start = text.indexOf('结果')
  console.log(`\n=== 结果视图：${label} ===`)
  console.log('text:', start >= 0 ? text.slice(start, start + 300) : '(未找到结果区块)')
  console.log('hero:', (seeded.node.querySelector('.mf_name') || {}).textContent,
    '| prob:', (seeded.node.querySelector('.mf_prob') || {}).textContent)
  console.log('bars:', seeded.node.querySelectorAll('.mf_bar').length,
    '| top bar:', !!seeded.node.querySelector('.mf_bar.top'),
    '| values:', [...seeded.node.querySelectorAll('.mf_val')].map(v => v.textContent).join(' '))
  console.log('widths:', [...seeded.node.querySelectorAll('.mf_fill')].map(f => (f.getAttribute('style') || '').replace(/[^0-9.%]/g, '')).join(' '))
  console.log('hint:', ([...seeded.node.querySelectorAll('.mf_hint')].map(h => h.textContent.trim())[0]) || '(none)')
  console.log('sample cards:', seeded.node.querySelectorAll('.mf_sample').length,
    '| states:', [...seeded.node.querySelectorAll('.mf_sample')].map(s => s.className.replace('mf_sample', '').trim() || '(plain)').join(' / '))
  console.log('sample status:', [...seeded.node.querySelectorAll('.mf_sample .mf_shead span')].map(s => s.textContent.trim()).join(' | '))
  console.log('speed chip:', ([...seeded.node.querySelectorAll('.mf_chip')].map(c => c.textContent.trim()).filter(t => t.includes('tok/s'))[0]) || '(none)')
  const firstCard = seeded.node.querySelector('.mf_sample .mf_shead')
  if (firstCard) {
    await act(async () => { firstCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window })) })
    await flush(1)
    const openCards = () => [...seeded.node.querySelectorAll('.mf_sample')].filter(c => c.classList.contains('open'))
    const opened = openCards()[0]
    console.log('expand click ->', opened ? 'OPEN' : 'not opened',
      '| detail:', (seeded.node.querySelector('.mf_detail .mf_meta') || {}).textContent || '(none)',
      '| speed:', ([...seeded.node.querySelectorAll('.mf_detail .mf_meta')].map(n => n.textContent.trim()).filter(t => t.includes('tok/s'))[0]) || '(none)',
      '| out:', ((seeded.node.querySelector('.mf_out') || {}).textContent || '').slice(0, 60) || '(empty)')
    await act(async () => { opened && opened.querySelector('.mf_shead').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window })) })
    await flush(1)
    console.log('collapse click ->', openCards().length ? 'still open' : 'closed')
    // 第三张卡是「上游一次性下发」的样本：速度要按整段耗时算，并额外说明一句。
    const thirdHead = [...seeded.node.querySelectorAll('.mf_sample .mf_shead')][2]
    if (thirdHead) {
      await act(async () => { thirdHead.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window })) })
      await flush(1)
      const metas = [...seeded.node.querySelectorAll('.mf_detail .mf_meta')].map(n => n.textContent.trim())
      console.log('buffered sample speed:', metas.filter(t => t.includes('tok/s'))[0] || '(none)')
    }
  }
  await act(async () => { seededRoot.unmount() })
}

// ---------------------------------------------------------------- 4. 总览搜索（种子 hooks）

// jsdom 里 React 19 受控 input 的 onChange 推不动（value tracker 认为值没变），
// 所以过滤逻辑改用种子 hooks 把 Overview 内部的 query 初值塞进去验证。
const searchCases = [
  ['kimi', '按供应商名过滤'],
  ['deepseek', '按供应商名过滤（多组）'],
  ['flash', '按模型名过滤'],
  ['model-failover', '按供应商 id 过滤'],
  ['zzz-no-such-model', '无命中'],
]
for (const [query, why] of searchCases) {
  const probe = renderSeeded(calibrated, { 17: query })
  const probeRoot = createRoot(probe.node)
  await act(async () => { probeRoot.render(React.createElement(probe.box.slots.main.component, { ctx: probe.ctx })) })
  await flush(2)
  const heads = [...probe.node.querySelectorAll('.mf_group .mf_ghead')].map(g => g.textContent.trim())
  const rows = [...probe.node.querySelectorAll('.mf_grow')].map(r => r.textContent.replace(/\s+/g, ' ').trim())
  const emptyNote = (probe.node.querySelector('.mf_ov .mf_empty') || {}).textContent
  console.log(`seeded query "${query}" (${why}) -> groups: ${heads.length} | heads: ${heads.join(' ⏐ ') || '(none)'}`
    + ` | rows: ${rows.length}${rows.length ? ` → ${rows.slice(0, 3).join(' ⏐ ')}` : ''}`
    + ` | empty note: ${emptyNote || '(none)'}`)
  await act(async () => { probeRoot.unmount() })
}

// ---------------------------------------------------------------- 4b. 总览使用最新概率

// 用户场景：中途离开页面，回来时结果是带概率的校准排名，但 /state 里的历史
// 还停在收尾之前（部分样本、没有概率）。总览那一行必须跟着结果变成百分比。
const partialHistoryRow = {
  id: 'h-old',
  at: '2026-11-20T09:00:00.000Z',
  provider: 'deepseek-account',
  model: 'deepseek-v4.1-flash-1017',
  decision: 'partial',
  used_outputs: 1,
  top: { id: 'deepseek-v4.1-flash-1017', display_name: 'DeepSeek-V4.1-Flash', probability: null },
}
// 结果区复原来的是同一条路由，只是带上了校准概率
const scoredRestore = {
  ...calibrated,
  provider: 'deepseek-account',
  model: 'deepseek-v4.1-flash-1017',
  decision: 'scored',
  top: { id: 'claude-sonnet-5', display_name: 'claude-sonnet-5', probability: 0.412 },
}
const overviewCase = (payload, history = [partialHistoryRow], extra = {}) => {
  stateStub = history
  const seeded = renderSeeded(payload, { 14: '2026-11-20T09:00:00.000Z', 16: { 'deepseek-account': true }, ...extra })
  const overviewRoot = createRoot(seeded.node)
  return { seeded, overviewRoot }
}
const overviewCases = [
  ['结果带概率', scoredRestore, undefined, {}],
  ['结果没有概率', partial, undefined, {}],
  // 历史里压根还没有这一行（挂载时 /state 早了一步）：也要把百分比补进总览
  ['历史里没有这一行', scoredRestore, [], {}],
  // 点过「清空记录」之后，清空之前算出来的结果不该再冒出来
  ['清空记录之后', scoredRestore, [], { 15: Date.now() }],
]
for (const [label, payload, history, extra] of overviewCases) {
  const { seeded, overviewRoot } = overviewCase(payload, history, extra)
  await act(async () => { overviewRoot.render(React.createElement(seeded.box.slots.main.component, { ctx: seeded.ctx })) })
  await flush(3)
  const rows = [...seeded.node.querySelectorAll('.mf_group .mf_grow')]
  const row = rows.find(item => (item.querySelector('.mf_mname') || {}).getAttribute('title') === partialHistoryRow.model)
  const text = row ? row.textContent.replace(/\s+/g, ' ').trim() : '(missing)'
  console.log(`overview after restore (${label}): ${text}`,
    '| has pct:', /%/.test(text), '| row:', Boolean(row))
  await act(async () => { overviewRoot.unmount() })
  stateStub = null
}

// ---------------------------------------------------------------- 5. 单条重试

const retrySlot = {
  id: 's2',
  expected_count: 300,
  prompt: '写 300 个整数',
  text: '251 88 34 199 7 320 143 62 278 91',
  count: 300,
  state: 'capped',
  status: '',
  error: null,
}
const retryRunning = {
  id: 'retry-test',
  mode: 'retry',
  status: 'running',
  progress: {
    stage: 'sampling',
    message: '取样中',
    completed: 0,
    total: 1,
    accepted: 0,
    challenges: [{ ...retrySlot, text: '251 88 34', count: 3, state: 'streaming' }],
  },
  result: null,
  error: null,
}
const retryDone = {
  id: 'retry-test',
  mode: 'retry',
  status: 'done',
  progress: { stage: 'done', message: '检测完成' },
  result: { ...calibrated, decision: 'scored', used_outputs: 2, slot: retrySlot },
  error: null,
}

console.log('\n=== 单条重试 ===')
retryStub = makeRetryStub([retryRunning, retryDone])
const retrySeeded = renderSeeded(calibrated)
const retryRoot = createRoot(retrySeeded.node)
await act(async () => { retryRoot.render(React.createElement(retrySeeded.box.slots.main.component, { ctx: retrySeeded.ctx })) })
await flush(2)
const miniButtons = [...retrySeeded.node.querySelectorAll('.mf_mini')]
console.log('retry buttons:', miniButtons.length, '| labels:', miniButtons.map(b => b.textContent.trim()).join(' | '))
const targetCard = retrySeeded.node.querySelectorAll('.mf_sample')[1]
console.log('target card before:', squash(targetCard))
const btn = targetCard.querySelector('.mf_mini')
await act(async () => { btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window })) })
await flush(1)
console.log('after click:', squash(retrySeeded.node.querySelectorAll('.mf_sample')[1]),
  '| retry POST:', calls.some(c => c.startsWith('POST /dsh-model-fingerprint/retry')))
const retried = await waitFor(() => /300 个数字/.test(squash(retrySeeded.node.querySelectorAll('.mf_sample')[1] || window.document.createElement('div'))), 4000)
const afterCard = retrySeeded.node.querySelectorAll('.mf_sample')[1]
console.log('card after retry:', retried ? 'UPDATED' : 'unchanged', '|', afterCard && squash(afterCard))
console.log('other cards kept:', retrySeeded.node.querySelectorAll('.mf_sample').length,
  '| expanded stays closed:', ![...retrySeeded.node.querySelectorAll('.mf_sample')].some(c => c.classList.contains('open')))
await act(async () => { const c = retrySeeded.node.querySelectorAll('.mf_sample')[1]; c.querySelector('.mf_shead').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window })) })
await flush(1)
console.log('expand retried card ->', (retrySeeded.node.querySelector('.mf_detail .mf_meta') || {}).textContent || '(none)',
  '| out chars:', ((retrySeeded.node.querySelector('.mf_out') || {}).textContent || '').length)
console.log('hero after retry:', (retrySeeded.node.querySelector('.mf_name') || {}).textContent,
  '| prob:', (retrySeeded.node.querySelector('.mf_prob') || {}).textContent)
await act(async () => { retryRoot.unmount() })
retryStub = makeRetryStub([retryRunning, retryDone])

// ---------------------------------------------------------------- 5b. 同时重试两条

console.log('\n=== 同时重试两条 ===')
const multiSeeded = renderSeeded(calibrated)
const multiRoot = createRoot(multiSeeded.node)
await act(async () => { multiRoot.render(React.createElement(multiSeeded.box.slots.main.component, { ctx: multiSeeded.ctx })) })
await flush(2)
const multiButtons = () => [...multiSeeded.node.querySelectorAll('.mf_mini')]
const label = button => `${button.textContent.trim()}${button.disabled ? '(disabled)' : ''}`
console.log('buttons before:', multiButtons().map(label).join(' | '))
const retryPostsBefore = calls.filter(c => c.startsWith('POST /dsh-model-fingerprint/retry')).length
const [firstBtn, secondBtn, thirdBtn] = multiButtons()
// 两条几乎同时点：一条在跑的时候另一条也允许点，其余卡片不受影响
await act(async () => {
  firstBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  secondBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
})
await flush(2)
console.log('buttons while two run:', multiButtons().map(label).join(' | '))
console.log('third card still clickable:', !thirdBtn.disabled)
console.log('retrying chip:', ([...multiSeeded.node.querySelectorAll('.mf_chip')]
  .map(node => node.textContent.trim())
  .filter(text => /重试/.test(text))[0]) || '(none)')
console.log('retry POSTs:', calls.filter(c => c.startsWith('POST /dsh-model-fingerprint/retry')).length - retryPostsBefore)
const bothBack = await waitFor(() => {
  const cards = [...multiSeeded.node.querySelectorAll('.mf_sample .mf_shead span')].map(node => node.textContent.trim())
  return cards.length > 1 && /300 个数字/.test(cards[0] || '') && /300 个数字/.test(cards[1] || '')
}, 6000)
console.log('both cards updated:', bothBack,
  '|', [...multiSeeded.node.querySelectorAll('.mf_sample .mf_shead span')].map(node => node.textContent.trim()).join(' | '))
console.log('buttons after both:', multiButtons().map(label).join(' | '))
console.log('retrying chip cleared:', ![...multiSeeded.node.querySelectorAll('.mf_chip')].some(node => /正在重试/.test(node.textContent)))
await act(async () => { multiRoot.unmount() })
retryStub = null

// ---------------------------------------------------------------- 6. 后台作业接回

const attachSlotA = { id: 'a1', expected_count: 300, prompt: '写 300 个整数', text: '12 88 3', count: 3, state: 'done', status: '', error: null }
const attachSlotB = { id: 'a2', expected_count: 300, prompt: '写 300 个整数', text: '', count: 0, state: 'pending', status: '', error: null }
const attachRunning = {
  id: 'attach-test',
  mode: 'detect',
  index: null,
  status: 'running',
  progress: {
    stage: 'sampling',
    message: '取样中',
    completed: 1,
    total: 2,
    accepted: 1,
    challenges: [attachSlotA, attachSlotB],
  },
  result: null,
  error: null,
}
const attachDone = {
  id: 'attach-test',
  mode: 'detect',
  index: null,
  status: 'done',
  progress: { stage: 'done', message: '检测完成' },
  result: { ...calibrated, used_outputs: 2 },
  error: null,
}

console.log('\n=== 后台作业接回（重开面板）===')
activeStub = { job: attachRunning, frames: [attachRunning, attachDone] }
const attachCtx = makeCtx()
const attachMod = loadModule()
attachMod.mod.apply(attachCtx.ctx)
const attachNode = window.document.createElement('div')
window.document.body.appendChild(attachNode)
const attachRoot = createRoot(attachNode)
await act(async () => { attachRoot.render(React.createElement(attachCtx.box.slots.main.component, { ctx: attachCtx.ctx })) })
await flush(2)
console.log('/active consulted:', calls.some(c => c.includes('/dsh-model-fingerprint/active')))
console.log('busy button:', [...attachNode.querySelectorAll('button')].map(b => `${b.textContent.trim()}${b.disabled ? '(disabled)' : ''}`).join(' | '))
const attachChips = [...attachNode.querySelectorAll('.mf_chip')].map(c => c.textContent.trim())
console.log('progress chips:', attachChips.filter(t => /样本|取样|评分|完成/.test(t)).join(' · ') || '(none)')
console.log('sample cards after attach:', attachNode.querySelectorAll('.mf_sample').length,
  '| states:', [...attachNode.querySelectorAll('.mf_sample')].map(c => c.className.replace('mf_sample', '').trim() || 'plain').join(','))
const attachHero = await waitFor(() => Boolean(attachNode.querySelector('.mf_name')), 5000)
console.log('job finished after attach:', attachHero,
  '| hero:', (attachNode.querySelector('.mf_name') || {}).textContent,
  '| stop button gone:', ![...attachNode.querySelectorAll('button')].some(b => /停止/.test(b.textContent)))
await act(async () => { attachRoot.unmount() })

// ---------------------------------------------------------------- 6b. 切走再切回（作业已经跑完）

console.log('\n=== 切走再切回：作业在后台跑完，回来要看到上次结果 ===')
// 面板切到别的页面时组件被卸载、轮询也停了；作业在 Host 里跑完后，
// 回来时 /active 的 job 是 null，只剩 last —— 界面必须靠 last 复原。
const restoredLast = {
  id: 'last-test',
  mode: 'detect',
  index: null,
  status: 'done',
  created_at: Date.now() - 60_000,
  finished_at: Date.now() - 5_000,
  progress: { stage: 'done', message: '检测完成' },
  result: {
    ...calibrated,
    challenges: [attachSlotA, attachSlotB],
  },
  error: null,
}
activeStub = { job: null, last: restoredLast, frames: [] }
const restoreCtx = makeCtx()
const restoreMod = loadModule()
restoreMod.mod.apply(restoreCtx.ctx)
const restoreNode = window.document.createElement('div')
window.document.body.appendChild(restoreNode)
const restoreRoot = createRoot(restoreNode)
await act(async () => { restoreRoot.render(React.createElement(restoreCtx.box.slots.main.component, { ctx: restoreCtx.ctx })) })
await flush(3)
console.log('sample cards restored:', restoreNode.querySelectorAll('.mf_sample').length,
  '| states:', [...restoreNode.querySelectorAll('.mf_sample')].map(c => c.className.replace('mf_sample', '').trim() || 'plain').join(','))
console.log('ranking restored:', Boolean(restoreNode.querySelector('.mf_name')),
  '| hero:', (restoreNode.querySelector('.mf_name') || {}).textContent)
console.log('notice:', (restoreNode.querySelector('.mf_ok') || {}).textContent || '(none)')
console.log('start button usable:', [...restoreNode.querySelectorAll('button')].some(b => /开始检测|Start detection/.test(b.textContent) && !b.disabled))
await act(async () => { restoreRoot.unmount() })
activeStub = null

// ---------------------------------------------------------------- 7. 清理

for (const dispose of cleanups) dispose()
console.log('\nstyle after cleanup:', !!window.document.querySelector('style[data-plugin="dsh-model-fingerprint"]'))
console.log('\n=== fetch 调用 ===')
console.log(calls.join('\n'))




