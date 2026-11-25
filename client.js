window.__ModuleLoader__.load({
  id: 'dsh-model-fingerprint',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, Fragment, useState, useEffect, useMemo, useCallback, useRef } = React

    const NS = 'settings.modelFingerprint'
    const API = '/dsh-model-fingerprint'
    // 侧边栏那一行和主区面板靠同一个 key 对上：sidebar.panellist 的 id = main 的 key
    const PANEL_ID = 'model-fingerprint'
    const inject = ['slots', 'locale']

    // ------------------------------------------------------------ 词典

    const DICT = {
      zh: {
        nav: '模型指纹',
        title: '模型指纹检测',
        intro:
          '让一个模型凭第一反应写下约 300 个 1 到 355 的整数，把它写出来的数字和内置的参考库比对，就能看出背后是哪家的模型。模型从这台 DSH 已经接入的清单里选，不需要另外填地址和密钥。',
        'det.ready': '检测器就绪',
        'det.loading': '读取检测器…',
        'det.broken': '检测器不可用',
        'det.models': '参考库 {count} 个模型',
        'det.built': '构建于 {time}',
        'det.refresh': '刷新数据',
        'det.refreshing': '下载中…',
        'det.error': '读取检测器失败：{reason}',
        'pick.title': '选择模型',
        'pick.intro': '下面是这台 DSH 已经接好的服务商与模型，检测就走它们平时用的那条链路。',
        'pick.loading': '读取模型列表…',
        'pick.provider': '服务商',
        'pick.model': '模型',
        'pick.effort': '推理强度',
        'pick.effort.default': '默认',
        'pick.empty': '这台 DSH 还没有接入任何模型。',
        'pick.emptyProvider': '该服务商没有可选模型。',
        'pick.useDefault': '用当前对话的模型',
        'pick.current': '当前对话：{name}',
        'pick.error': '读取模型列表失败：{reason}',
        'scan.button': '重新扫描',
        'scan.running': '正在扫描…',
        'scan.done': '已扫描 {count} 个模型，时间 {at}。',
        'scan.error': '重新扫描失败：{reason}',
        'scan.hint': '问遍宿主里所有已接入的服务商，取回最新的模型列表。',
        'scan.at': '模型列表取自 {time}',
        'scan.cached': '这是上一次的扫描结果，点右上角「重新扫描」可更新。',
        'opt.title': '采样选项',
        'opt.samples': '样本数',
        'opt.samples.one': '1 条',
        'opt.samples.two': '2 条',
        'opt.samples.three': '3 条',
        'opt.samples.help': '1 到 2 条只能给出相对排名，3 条才有校准概率。',
        'opt.parallel': '并行发送',
        'opt.relaxed': '宽松模式（取够目标数字就停）',
        'run.title': '开始检测',
        'run.intro': '插件会随机抽几条提示词发给所选模型，再从回复里提取数字算分。单条约 10 到 60 秒。',
        'run.start': '开始检测',
        'run.running': '检测中…',
        'run.cancel': '停止',
        'run.stage.sampling': '正在取样',
        'run.stage.scoring': '正在算分',
        'run.stage.done': '完成',
        'run.sample': '样本 {index}',
        'run.sample.wait': '等待中',
        'run.sample.sending': '已发送',
        'run.sample.streaming': '接收中…',
        'run.sample.ok': '{count} 个数字',
        'run.sample.bad': '无效',
      'run.sample.expand': '点击展开模型输出',
      'run.sample.collapse': '点击收起',
      'run.sample.expected': '期望 {count} 个数字',
      'run.sample.got': '实际取到 {count} 个',
      'run.sample.empty': '这条没有拿到正文。',
      'run.sample.retry': '重试',
      'run.sample.retrying': '重试中',
      'run.sample.retryHint': '只重新跑这一条，其它样本保留',
      'run.sample.tps': '{value} tok/s',
      'run.sample.tpsFull': '输出速度 {value} tok/s',
      'run.sample.tpsHint': '输出词数 ÷ 生成秒数，不算首字之前的等待',
      'run.sample.tpsBasis': '{tokens} 个词 / {seconds} 秒',
      'run.sample.tpsBuffered': '上游一次性下发，按整段耗时算',
      'run.sample.tpsNone': '没有拿到用量数据，这一条无法计算速度。',
      'run.tpsAvg': '平均输出速度 {value} tok/s',
      'run.retryCount': '正在重试 {count} 条样本',
        'run.accepted': '已取到 {accepted} / {total} 条有效样本',
        'run.needModel': '先选一个要检测的模型。',
  'run.restored': '已恢复上一次的检测结果。',
        'res.title': '结果',
        'res.scored': '库内校准排名',
        'res.partial': '部分样本排名',
        'res.notModel': '不像语言模型的回答',
        'res.notModel.why':
          '这段回复里相邻数字的变化方式和参考库里的模型回答不一样，通常说明它不是模型随手写出来的，所以不给排名。',
        'res.unscorable': '样本不足，无法排名',
        'res.unscorable.why': '至少需要 3 条包含足够多整数的回复，才能给出排名。',
        'res.probability': '置信度 {value}',
        'res.probability.na': '置信度不可用',
        'res.noProb': '样本数不足，这里只有相对分数，没有校准概率；把样本数调到 3 条重跑可以得到概率。',
        'res.used': '使用 {count} 条有效样本',
        'res.route': '{provider} / {model}',
        'ov.title': '总览',
        'ov.count': '{tested}/{total} 已测',
        'ov.untested': '未测试',
        'ov.empty': '还没有可显示的模型。',
        'ov.clear': '清空记录',
        'ov.expand': '展开该供应商的模型',
        'ov.collapse': '收起该供应商的模型',
        'ov.search': '搜索供应商或模型',
        'ov.searchEmpty': '没有匹配的供应商或模型。',
        'common.error': '出错了：{reason}',
      },
      en: {
        nav: 'Model fingerprint',
        title: 'Model fingerprint detector',
        intro:
          'Ask a model to write roughly 300 numbers from 1 to 355 from the top of its head, then match that sequence against the built-in reference library. Models come from the list this DSH already has connected — no endpoint or API key needed.',
        'det.ready': 'Detector ready',
        'det.loading': 'Loading detector…',
        'det.broken': 'Detector unavailable',
        'det.models': '{count} reference models',
        'det.built': 'Built {time}',
        'det.refresh': 'Refresh data',
        'det.refreshing': 'Downloading…',
        'det.error': 'Could not load the detector: {reason}',
        'pick.title': 'Pick a model',
        'pick.intro': 'These are the providers and models already connected to this DSH. Sampling uses the same route they normally use.',
        'pick.loading': 'Loading models…',
        'pick.provider': 'Provider',
        'pick.model': 'Model',
        'pick.effort': 'Reasoning effort',
        'pick.effort.default': 'Default',
        'pick.empty': 'No models are connected to this DSH yet.',
        'pick.emptyProvider': 'This provider has no selectable models.',
        'pick.useDefault': 'Use this conversation’s model',
        'pick.current': 'This conversation: {name}',
        'pick.error': 'Could not load the model list: {reason}',
        'scan.button': 'Rescan',
        'scan.running': 'Scanning…',
        'scan.done': 'Scanned {count} models at {at}.',
        'scan.error': 'Rescan failed: {reason}',
        'scan.hint': 'Ask every connected provider on this host and refresh the model list.',
        'scan.at': 'Model list from {time}',
        'scan.cached': 'This is the last scan result; use “Rescan” at the top right to refresh it.',
        'opt.title': 'Sampling options',
        'opt.samples': 'Samples',
        'opt.samples.one': '1',
        'opt.samples.two': '2',
        'opt.samples.three': '3',
        'opt.samples.help': 'One or two samples only give a relative ranking; three samples unlock calibrated probabilities.',
        'opt.parallel': 'Send in parallel',
        'opt.relaxed': 'Relaxed (stop once enough numbers arrive)',
        'run.title': 'Run a detection',
        'run.intro': 'A few random prompts go to the selected model, then the numbers in the replies are scored. Expect 10–60 seconds per sample.',
        'run.start': 'Start detection',
        'run.running': 'Detecting…',
        'run.cancel': 'Stop',
        'run.stage.sampling': 'Sampling',
        'run.stage.scoring': 'Scoring',
        'run.stage.done': 'Done',
        'run.sample': 'Sample {index}',
        'run.sample.wait': 'Waiting',
        'run.sample.sending': 'Sent',
        'run.sample.streaming': 'Receiving…',
        'run.sample.ok': '{count} numbers',
        'run.sample.bad': 'Invalid',
      'run.sample.expand': 'Click to show the raw output',
      'run.sample.collapse': 'Click to collapse',
      'run.sample.expected': 'Asked for {count} numbers',
      'run.sample.got': 'got {count}',
      'run.sample.empty': 'No text came back for this sample.',
      'run.sample.retry': 'Retry',
      'run.sample.retrying': 'Retrying',
      'run.sample.retryHint': 'Re-run just this sample, keep the other ones',
      'run.sample.tps': '{value} tok/s',
      'run.sample.tpsFull': 'Output speed {value} tok/s',
      'run.sample.tpsHint': 'Output tokens ÷ generation seconds, excluding the wait before the first token',
      'run.sample.tpsBasis': '{tokens} tokens / {seconds} s',
      'run.sample.tpsBuffered': 'upstream sent it in one go, timed from the whole request',
      'run.sample.tpsNone': 'No usage data came back, so this sample has no speed.',
      'run.tpsAvg': 'Average output speed {value} tok/s',
      'run.retryCount': 'Retrying {count} sample(s)',
        'run.accepted': '{accepted} / {total} usable samples',
        'run.needModel': 'Pick a model to test first.',
  'run.restored': 'Restored the result of the previous run.',
        'res.title': 'Result',
        'res.scored': 'Calibrated ranking',
        'res.partial': 'Partial ranking',
        'res.notModel': 'Does not read like a model answer',
        'res.notModel.why':
          'Consecutive numbers here change in a way the reference answers never do, which usually means a model did not just write them, so no ranking is produced.',
        'res.unscorable': 'Not enough samples to rank',
        'res.unscorable.why': 'At least three replies with enough integers are needed for a ranking.',
        'res.probability': '{value} confidence',
        'res.probability.na': 'Confidence unavailable',
        'res.noProb': 'Too few samples, so these are relative scores without calibrated probabilities. Raise the sample count to 3 and run again.',
        'res.used': '{count} usable samples',
        'res.route': '{provider} / {model}',
        'ov.title': 'Overview',
        'ov.count': '{tested}/{total} tested',
        'ov.untested': 'Not tested',
        'ov.empty': 'No models to show yet.',
        'ov.clear': 'Clear records',
        'ov.expand': 'Expand this provider',
        'ov.collapse': 'Collapse this provider',
        'ov.search': 'Search providers or models',
        'ov.searchEmpty': 'No matching providers or models.',
        'common.error': 'Something went wrong: {reason}',
      },
    }

    function format(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
        values && values[key] !== undefined && values[key] !== null ? String(values[key]) : whole,
      )
    }

    // ------------------------------------------------------------ 样式

    const CSS = `
.mf_page{width:100%;min-width:0;height:100%;min-height:0;display:flex;overflow:hidden;
  color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:13px}
.mf_scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
.mf_root{max-width:1080px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
@media (width<=767px){.mf_root{padding-inline:20px}}
.mf_head{margin:0 0 16px;padding-top:28px}
[data-platform=darwin] .mf_head{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.mf_headrow{display:flex;gap:16px;align-items:flex-start}
.mf_headtext{flex:1;min-width:0}
.mf_headrow .mf_btn{flex:none;margin-left:auto;align-self:flex-start}
.mf_head h2{margin:0 0 6px;font-size:15px;font-weight:600}
.mf_head p{margin:0;max-width:76ch;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.7}
.mf_card{margin:0 0 14px;padding:16px 18px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.mf_card h3{margin:0 0 4px;font-size:13.5px;font-weight:600}
.mf_card .mf_sub{margin:0 0 12px;font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary)}
.mf_btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit;font-size:12.5px;transition:background .12s ease,border-color .12s ease}
.mf_btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-3)}
.mf_btn:disabled{opacity:.5;cursor:default}
.mf_btn.primary{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}
.mf_btn.ghost{border-color:transparent;background:none;color:var(--dsw-alias-label-secondary);padding:6px 8px}
.mf_btn.ghost:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3)}
.mf_row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mf_grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.mf_field{min-width:0}
.mf_field label{display:block;font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-bottom:5px}
.mf_field .mf_help{margin:5px 0 0;font-size:10.5px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}
.mf_input,.mf_select{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit;border-radius:8px;padding:7px 9px;font:inherit;font-size:12.5px}
.mf_input,.mf_select{font-variant-numeric:tabular-nums}
.mf_input:focus,.mf_select:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.mf_chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.mf_chip.on{color:var(--dsw-alias-state-success-primary,#2f9e44);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2f9e44) 34%,var(--dsw-alias-border-l2))}
.mf_chip.bad{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 34%,var(--dsw-alias-border-l2))}
.mf_check{display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.mf_check input{accent-color:var(--dsw-alias-state-business-primary)}
.mf_error{margin:10px 0 0;padding:10px 12px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.6}
.mf_ok{margin:10px 0 0;font-size:12px;color:var(--dsw-alias-state-success-primary,#2f9e44)}
.mf_hint{margin:10px 0 0;font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:1.6}
.mf_progress{margin:12px 0 0;height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}
.mf_progress i{display:block;height:100%;background:var(--dsw-alias-state-business-primary);transition:width .3s ease}
.mf_samples{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin:12px 0 0}
.mf_sample{padding:9px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2)}
.mf_sample{position:relative}
.mf_shead{padding-right:56px}
.mf_shead[role="button"]{cursor:pointer}
.mf_shead[role="button"]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;border-radius:5px}
.mf_mini{position:absolute;top:7px;right:8px;font:inherit;font-size:11px;line-height:1;padding:4px 8px;border-radius:6px;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);
  cursor:pointer;transition:background .12s ease,color .12s ease}
.mf_mini:hover:not(:disabled){background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.mf_mini:disabled{opacity:.5;cursor:default}
.mf_sample.retrying{border-color:var(--dsw-alias-state-business-primary)}
.mf_sample b{display:block;font-size:11.5px;font-weight:600;margin:0 0 4px;color:var(--dsw-alias-label-secondary)}
.mf_sample span{font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.mf_sample.pending b{color:var(--dsw-alias-label-tertiary)}
.mf_sample.clickable:hover{background:var(--dsw-alias-bg-layer-1)}
.mf_sample.open{grid-column:1/-1}
.mf_sample .mf_caret{float:right;font-style:normal;font-size:10px;color:var(--dsw-alias-label-tertiary);margin-left:6px}
.mf_detail{margin:8px 0 0;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px}
.mf_detail .mf_meta{font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;margin:0 0 6px}
.mf_out{margin:0;max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-all;
  font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11.5px;line-height:1.65;
  color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:7px;padding:8px 10px}
.mf_sample.ok{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2f9e44) 40%,var(--dsw-alias-border-l2))}
.mf_sample.bad{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,var(--dsw-alias-border-l2))}
.mf_hero{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap;margin:0 0 6px}
.mf_hero .mf_name{font-size:19px;font-weight:650;letter-spacing:-.01em}
.mf_hero .mf_prob{font-size:13px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.mf_bars{margin:12px 0 0;display:flex;flex-direction:column;gap:7px}
.mf_bar{display:grid;grid-template-columns:170px 1fr 62px;gap:10px;align-items:center;font-size:12px}
.mf_bar .mf_lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.mf_bar .mf_track{height:7px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}
.mf_bar .mf_fill{display:block;height:100%;background:var(--dsw-alias-state-business-primary);border-radius:999px}
.mf_bar .mf_val{text-align:right;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.mf_bar.top .mf_lbl{font-weight:600}
.mf_bar.top .mf_fill{background:var(--dsw-alias-state-success-primary,#2f9e44)}
.mf_diag{margin:12px 0 0;display:flex;flex-direction:column;gap:6px}
.mf_diagrow{display:flex;gap:10px;justify-content:space-between;font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.mf_diagrow b{font-weight:500;color:var(--dsw-alias-label-secondary)}
.mf_ov{margin:12px 0 0;display:flex;flex-direction:column;gap:6px}
/* 供应商卡片两列排：一行放两个，列宽各占一半；卡片各自按内容高度，短的那张不会被拉长 */
.mf_ovlist{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;align-items:start}
@media (width<=767px){.mf_ovlist{grid-template-columns:minmax(0,1fr)}}
.mf_group{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}
.mf_ghead{display:flex;gap:8px;align-items:baseline;width:100%;text-align:left;font:inherit;padding:8px 10px;
  background:transparent;border:0;color:var(--dsw-alias-label-primary);cursor:pointer}
.mf_ghead:hover{background:var(--dsw-alias-bg-layer-1)}
.mf_ghead:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.mf_ghead .mf_gname{font-size:12.5px;font-weight:600}
.mf_ghead .mf_gcount{font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.mf_ghead .mf_gcaret{margin-left:auto;font-style:normal;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.mf_grow{display:flex;flex-wrap:wrap;gap:2px 10px;align-items:baseline;padding:6px 10px 6px 20px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px}
.mf_grow .mf_mname{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:50%}
.mf_grow .mf_mres{margin-left:auto;color:var(--dsw-alias-label-secondary);text-align:right}
.mf_grow .mf_mres.tested{color:var(--dsw-alias-label-primary)}
.mf_grow .mf_mres .mf_prob{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.mf_grow .mf_none{color:var(--dsw-alias-label-tertiary)}
.mf_grow .mf_gtime{margin-left:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:11.5px}
.mf_empty{padding:10px 0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
`

    // ------------------------------------------------------------ 请求

    async function api(path, init) {
      const res = await fetch(`${API}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      })
      let body = null
      try {
        body = await res.json()
      } catch {
        /* 空响应 */
      }
      if (!res.ok || (body && body.ok === false)) {
        throw new Error((body && body.message) || `HTTP ${res.status}`)
      }
      return body || {}
    }

    function post(path, payload) {
      return api(path, { method: 'POST', body: JSON.stringify(payload ?? {}) })
    }

    function pct(value) {
      if (value === null || value === undefined || !Number.isFinite(value)) return '—'
      return `${(value * 100).toFixed(1)}%`
    }

    function clock(iso) {
      if (!iso) return ''
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return String(iso)
      const pad = n => String(n).padStart(2, '0')
      return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function bytesLabel(value) {
      if (!Number.isFinite(value) || value <= 0) return ''
      return value >= 1e6 ? `${(value / 1048576).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`
    }

    // 传输层的原文是英文的（`fetch failed`、`Failed to fetch`），直接摆给用户看不懂；
    // 换成一句中文，并把错误码留在后面便于排查。
    function describeFailure(err) {
      const message = String((err && err.message) || err || '')
      const code = (err && err.cause && err.cause.code) || ''
      if (!message) return ''
      if (/ENOTFOUND|EAI_AGAIN|DNS/i.test(message)) {
        return `域名解析不了${code ? `（${code}）` : ''}。`
      }
      if (/ECONNREFUSED/i.test(message) || /fetch failed|Failed to fetch|NetworkError/i.test(message)) {
        return `连不上对方${code ? `（${code}）` : ''}。`
      }
      return message
    }

    // ------------------------------------------------------------ 组件

    function Field({ label, help, children }) {
      return h('div', { className: 'mf_field' },
        h('label', null, label),
        children,
        help ? h('p', { className: 'mf_help' }, help) : null)
    }

    // 有校准概率时按概率画条；未校准时按相对分数（score / 最高分）画条，避免用名次伪造长度。
    function Bar({ item, top, maxScore }) {
      const hasProb = item.probability !== null && item.probability !== undefined
      const ratio = hasProb
        ? item.probability
        : (maxScore > 0 && Number.isFinite(item.score) ? Math.max(0.02, item.score / maxScore) : 0.02)
      return h('div', { className: `mf_bar${top ? ' top' : ''}` },
        h('span', { className: 'mf_lbl', title: item.display_name }, item.display_name),
        h('span', { className: 'mf_track' },
          h('i', { className: 'mf_fill', style: { width: `${Math.max(1, Math.min(100, ratio * 100)).toFixed(2)}%` } })),
        h('span', { className: 'mf_val' }, hasProb ? pct(item.probability) : '—'))
    }

    function decisionLabel(t, decision) {
      if (decision === 'scored') return t('res.scored')
      if (decision === 'partial') return t('res.partial')
      if (decision === 'not_model') return t('res.notModel')
      return t('res.unscorable')
    }

    function ResultView({ t, result }) {
      if (!result) return null
      const decision = result.decision
      const isRanked = decision === 'scored' || decision === 'partial'
      const head = h('div', { className: 'mf_card' },
        h('h3', null, t('res.title')),
        h('div', { className: 'mf_row', style: { marginBottom: '10px' } },
          h('span', { className: `mf_chip${isRanked ? ' on' : ''}` }, decisionLabel(t, decision)),
          result.used_outputs ? h('span', { className: 'mf_chip' }, format(t('res.used'), { count: result.used_outputs })) : null,
          result.provider || result.model
            ? h('span', { className: 'mf_chip' }, format(t('res.route'), {
                provider: result.provider || '—',
                model: result.model || '—',
              }))
            : null))

      if (!isRanked) {
        const why = decision === 'not_model' ? t('res.notModel.why') : t('res.unscorable.why')
        return h(Fragment, null,
          head,
          h('p', { className: 'mf_hint', style: { margin: 0 } }, why),
          result.sequence ? h('div', { className: 'mf_diag' },
            h('div', { className: 'mf_diagrow' },
              h('b', null, 'autocorrelation'), h('span', null, Number(result.sequence.autocorrelation).toFixed(3))),
            h('div', { className: 'mf_diagrow' },
              h('b', null, 'small step share'), h('span', null, Number(result.sequence.small_step_share).toFixed(3)))) : null)
      }

      const top = result.top
      const noProb = result.probability_status !== 'reference_calibrated'
      const rows = (result.results || []).slice(0, 8)
      const maxScore = rows.reduce((best, item) => (Number.isFinite(item.score) && item.score > best ? item.score : best), 0)
      return h(Fragment, null,
        head,
        noProb ? h('p', { className: 'mf_hint', style: { margin: '0 0 8px' } }, t('res.noProb')) : null,
        h('div', { className: 'mf_hero' },
          h('span', { className: 'mf_name' }, top ? top.display_name : '—'),
          h('span', { className: 'mf_prob' },
            top && top.probability !== null && top.probability !== undefined
              ? format(t('res.probability'), { value: pct(top.probability) })
              : t('res.probability.na'))),
        top && top.family_name ? h('div', { className: 'mf_hint', style: { marginTop: '2px' } }, top.family_name) : null,
        h('div', { className: 'mf_bars' },
          rows.map((item, index) => h(Bar, { key: item.id, item, top: index === 0, maxScore }))))
    }

    // 输出速度的显示口径跟官方界面一致：10 以上取整，10 以下留一位小数。
    function tpsNumber(value) {
      const tps = Number(value)
      if (!Number.isFinite(tps) || tps <= 0) return ''
      return String(tps >= 10 ? Math.round(tps) : Math.round(tps * 10) / 10)
    }

    function tpsText(t, value) {
      const shown = tpsNumber(value)
      return shown ? format(t('run.sample.tps'), { value: shown }) : ''
    }

    function averageTps(samples) {
      const list = (Array.isArray(samples) ? samples : [])
        .map(sample => Number(sample && sample.tps))
        .filter(tps => Number.isFinite(tps) && tps > 0)
      if (list.length === 0) return 0
      return list.reduce((sum, tps) => sum + tps, 0) / list.length
    }

    // 展开区里的速度一行：拿到 usage 就报速度，取到了数字却没拿到 usage 就说明原因。
    function speedDetail(t, sample) {
      if (!sample) return null
      const finished = sample.state === 'done' || sample.state === 'capped'
      if (!finished) return null
      const shown = tpsNumber(sample.tps)
      if (shown) {
        const tokens = Number(sample.output_tokens)
        const ms = Number(sample.basis_ms) > 0 ? Number(sample.basis_ms) : Number(sample.decode_ms)
        const parts = [format(t('run.sample.tpsFull'), { value: shown })]
        if (Number.isFinite(tokens) && tokens > 0 && Number.isFinite(ms) && ms > 0) {
          parts.push(format(t('run.sample.tpsBasis'), { tokens, seconds: (ms / 1000).toFixed(1) }))
        }
        if (sample.buffered) parts.push(t('run.sample.tpsBuffered'))
        return h('div', { className: 'mf_meta', title: t('run.sample.tpsHint') }, parts.join(' · '))
      }
      if ((sample.count || 0) > 0) return h('div', { className: 'mf_meta' }, t('run.sample.tpsNone'))
      return null
    }

    function sampleStatus(t, sample) {
      if (!sample) return t('run.sample.wait')
      switch (sample.state) {
        case 'done':
        case 'capped': {
          const numbers = format(t('run.sample.ok'), { count: sample.count || 0 })
          const speed = tpsText(t, sample.tps)
          return speed ? `${numbers} · ${speed}` : numbers
        }
        case 'rejected': return sample.status || t('run.sample.bad')
        case 'streaming': return sample.count ? format(t('run.sample.ok'), { count: sample.count }) : t('run.sample.streaming')
        case 'requesting': return t('run.sample.sending')
        default: return t('run.sample.wait')
      }
    }

    // 每条样本一张卡片：检测结束后仍然留着，点一下展开模型原始输出；右侧可单独重跑这一条。
    function SamplesView({ t, samples, open, onToggle, onRetry, retrying, locked }) {
      const list = Array.isArray(samples) ? samples : []
      if (list.length === 0) return null
      return h('div', { className: 'mf_samples' },
        list.map((sample, index) => {
          const ok = sample.state === 'done' || sample.state === 'capped' || sample.state === 'streaming'
          const bad = sample.state === 'rejected'
          const expanded = open === index
          const busyHere = Boolean(retrying && retrying[index])
          const text = typeof sample.text === 'string' ? sample.text : ''
          const toggle = () => onToggle(expanded ? null : index)
          return h('div', {
            key: sample.id || index,
            className: `mf_sample clickable${ok ? ' ok' : ''}${bad ? ' bad' : ''}${!ok && !bad ? ' pending' : ''}${expanded ? ' open' : ''}${busyHere ? ' retrying' : ''}`,
          },
            h('div', {
              className: 'mf_shead',
              role: 'button',
              tabIndex: 0,
              title: expanded ? t('run.sample.collapse') : t('run.sample.expand'),
              onClick: toggle,
              onKeyDown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  toggle()
                }
              },
            },
              h('b', null,
                format(t('run.sample'), { index: index + 1 }),
                h('i', { className: 'mf_caret' }, expanded ? '▾' : '▸')),
              h('span', null, sampleStatus(t, sample))),
            h('button', {
              className: 'mf_mini',
              disabled: locked || busyHere,
              onClick: (event) => { event.stopPropagation(); onRetry(index) },
              title: t('run.sample.retryHint'),
            }, busyHere ? t('run.sample.retrying') : t('run.sample.retry')),
            expanded
              ? h('div', { className: 'mf_detail' },
                  h('div', { className: 'mf_meta' },
                    format(t('run.sample.expected'), { count: sample.expected_count || 0 }),
                    ' · ',
                    format(t('run.sample.got'), { count: sample.count || 0 })),
                  speedDetail(t, sample),
                  sample.error ? h('div', { className: 'mf_error' }, sample.error) : null,
                  text.trim()
                    ? h('pre', { className: 'mf_out' }, text)
                    : h('div', { className: 'mf_hint' }, t('run.sample.empty')))
              : null)
        }))
    }

    function notices(notice, error) {
      const out = []
      if (error) out.push(h('div', { className: 'mf_error', key: 'err' }, error))
      if (notice) out.push(h('p', { className: 'mf_ok', key: 'ok' }, notice))
      return out.length > 0 ? h(Fragment, null, out) : null
    }

    // 总览：按供应商分组，每个模型显示最近一次测试结果，没测过的写「未测试」。
    // 顶部搜索框按「供应商名 / 供应商 id / 模型名 / 模型 id」做不区分大小写的子串匹配，
    // 命中时自动展开该组，清空后回到手动折叠状态。
    function Overview({ t, groups, open, onToggle }) {
      const [query, setQuery] = useState('')
      const all = Array.isArray(groups) ? groups : []
      if (all.length === 0) return h('div', { className: 'mf_empty' }, t('ov.empty'))

      const needle = query.trim().toLowerCase()
      const searching = needle.length > 0
      const hit = (...fields) => fields.some(field => typeof field === 'string' && field.toLowerCase().includes(needle))
      const shown = !searching
        ? all
        : all
            .map(group => {
              const groupHit = hit(group.name, group.id)
              const models = groupHit ? group.models : group.models.filter(model => hit(model.name, model.id))
              return { group, models, groupHit }
            })
            .filter(item => item.models.length > 0)
            .map(item => ({ ...item.group, models: item.models }))

      const search = h('input', {
        className: 'mf_input',
        type: 'search',
        value: query,
        placeholder: t('ov.search'),
        'aria-label': t('ov.search'),
        style: { marginTop: '10px' },
        onChange: e => setQuery(e.target.value),
      })

      if (searching && shown.length === 0) {
        return h('div', { className: 'mf_ov' }, search, h('div', { className: 'mf_empty' }, t('ov.searchEmpty')))
      }

      return h('div', { className: 'mf_ov' },
        search,
        h('div', { className: 'mf_ovlist' }, shown.map(group => {
          // 搜索时默认展开命中组，但仍允许手动收起（只有明确收起过才保持收起）
          const expanded = searching ? open[group.id] !== false : Boolean(open[group.id])
          const tested = group.models.filter(model => model.row).length
          return h('div', { className: 'mf_group', key: group.id },
            h('button', {
              type: 'button',
              className: 'mf_ghead',
              title: expanded ? t('ov.collapse') : t('ov.expand'),
              onClick: () => onToggle(group.id, !expanded),
            },
              h('span', { className: 'mf_gname' }, group.name),
              h('span', { className: 'mf_gcount' },
                format(t('ov.count'), { tested, total: group.models.length })),
              h('i', { className: 'mf_gcaret' }, expanded ? '▾' : '▸')),
            expanded
              ? h('div', null, group.models.map(model => h('div', { className: 'mf_grow', key: model.id },
                  h('span', { className: 'mf_mname', title: model.id }, model.name),
                  model.row
                    ? h('span', { className: 'mf_mres tested' },
                        decisionLabel(t, model.row.decision),
                        model.row.top ? ` · ${model.row.top.display_name}` : '',
                        model.row.top && model.row.top.probability !== null && model.row.top.probability !== undefined
                          ? h('span', { className: 'mf_prob' }, ` ${pct(model.row.top.probability)}`)
                          : null,
                        h('span', { className: 'mf_gtime' }, clock(model.row.at)))
                    : h('span', { className: 'mf_mres mf_none' }, t('ov.untested')))))
              : null)
        })))
    }

    function Page({ ctx, t: bound }) {
      const locale = (ctx && ((ctx.get && ctx.get('locale')) || ctx.locale)) || null
      const t = bound || (locale && typeof locale.bind === 'function' ? locale.bind(NS) : key => key)

      const [config, setConfig] = useState(null)
      const [detector, setDetector] = useState(null)
      const [catalog, setCatalog] = useState(null)
      const [selection, setSelection] = useState(null)
      const [efforts, setEfforts] = useState([])
      const [history, setHistory] = useState([])
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState('')
      const [progress, setProgress] = useState(null)
      const [samples, setSamples] = useState([])
      const [openSample, setOpenSample] = useState(null)
      const [retrying, setRetrying] = useState({})
      const [result, setResult] = useState(null)
      // 这份结果是哪一刻出炉的：总览里的行要有个时间，又不能凭空造时间戳
      const [resultAt, setResultAt] = useState('')
      // 上一次点「清空记录」的时刻：清空之前算出来的结果不该在总览里再冒出来
      const [clearedAt, setClearedAt] = useState(0)
      const [openGroups, setOpenGroups] = useState({})
      // 目录是上一次扫到的，不是实时的：记一下扫的时间，面板上说清楚这是缓存
      const [scannedAt, setScannedAt] = useState('')
      const timer = useRef(null)
      const jobRef = useRef(null)
      // 允许同时重试多条：jobId → 卡片下标，一条重试一个定时器
      const retryJobs = useRef(new Map())
      const retryTimers = useRef(new Map())
      const attached = useRef(false)
      const saveTimer = useRef(null)
      const skipSave = useRef(true)

      const stopPolling = useCallback(() => {
        if (timer.current) {
          clearTimeout(timer.current)
          timer.current = null
        }
      }, [])

      // 某一条重试结束：清定时器、从表里划掉，全都没了才把 busy 放开
      const finishRetry = useCallback(jobId => {
        const pending = retryTimers.current.get(jobId)
        if (pending) clearTimeout(pending)
        retryTimers.current.delete(jobId)
        const index = retryJobs.current.get(jobId)
        retryJobs.current.delete(jobId)
        const gone = index === undefined ? null : index
        if (gone !== null) {
          setRetrying(prev => {
            const next = { ...(prev || {}) }
            delete next[gone]
            return next
          })
        }
        if (retryJobs.current.size === 0) setBusy('')
      }, [])

      const clearRetries = useCallback(() => {
        for (const pending of retryTimers.current.values()) clearTimeout(pending)
        retryTimers.current.clear()
        retryJobs.current.clear()
        setRetrying({})
      }, [])

      useEffect(() => () => {
        stopPolling()
        for (const pending of retryTimers.current.values()) clearTimeout(pending)
        retryTimers.current.clear()
        retryJobs.current.clear()
        if (saveTimer.current) clearTimeout(saveTimer.current)
      }, [stopPolling])

      const loadState = useCallback(async () => {
        try {
          const body = await api('/state', { method: 'GET' })
          setDetector(body.detector || null)
          setHistory(Array.isArray(body.history) ? body.history : [])
          setSelection(body.selection || null)
          setConfig(prev => prev || body.config || {})
        } catch (err) {
          setError(format(t('common.error'), { reason: err.message }))
        }
      }, [])

      // 只刷新历史，不动配置与选择：重跑结束时用它把总览里那一行换成最新结果
      const refreshHistory = useCallback(async () => {
        try {
          const body = await post('/history', {})
          if (Array.isArray(body.history)) setHistory(body.history)
        } catch {
          /* 拉不到就保持现有列表，不影响其它显示 */
        }
      }, [])

      // 打开面板时用：只拿上一次扫到的那份目录，不去问宿主，几百毫秒的等待能省掉。
      // 一份缓存都没有（首次打开、或缓存被清掉）时才先扫一遍，否则选择区没得选。
      const loadCatalog = useCallback(async () => {
        try {
          const body = await api('/catalog', { method: 'GET' })
          const providers = Array.isArray(body.providers) ? body.providers : []
          // 还从没扫过：把 catalog 留在 null，直接去扫，免得选择区先闪一下「没有模型」
          if (providers.length === 0 && !body.scanned_at) {
            return rescanCatalog()
          }
          setCatalog(providers)
          setScannedAt(body.scanned_at || '')
          // 宿主在给目录的同时把「已经删掉的模型」的旧记录清掉了，这里跟着换一份，
          // 免得总览还留着那些行
          if (Array.isArray(body.history)) setHistory(body.history)
          setSelection(body.default || null)
          setConfig(prev => {
            const current = prev || {}
            const fallbackProvider = body.default && body.default.provider
              ? body.default.provider
              : (providers.find(entry => entry.models.length > 0) || providers[0] || {}).id || ''
            const provider = providers.some(entry => entry.id === current.provider) ? current.provider : fallbackProvider
            const pool = (providers.find(entry => entry.id === provider) || {}).models || []
            const model = pool.some(entry => entry.id === current.model)
              ? current.model
              : (body.default && body.default.provider === provider && body.default.model) || (pool[0] || {}).id || ''
            const effort = typeof current.effort === 'string' ? current.effort : ''
            return { ...current, provider, model, effort }
          })
        } catch (err) {
          setError(format(t('pick.error'), { reason: describeFailure(err) }))
        }
      }, [])

      // 用户点了右上角「重新扫描」：真的把宿主里所有 provider 问一遍
      const rescanCatalog = useCallback(async () => {
        try {
          setBusy('rescan')
          const body = await post('/catalog', {})
          const providers = Array.isArray(body.providers) ? body.providers : []
          setCatalog(providers)
          setScannedAt(body.scanned_at || '')
          if (Array.isArray(body.history)) setHistory(body.history)
          setSelection(body.default || null)
          setConfig(prev => {
            const current = prev || {}
            const fallbackProvider = body.default && body.default.provider
              ? body.default.provider
              : (providers.find(entry => entry.models.length > 0) || providers[0] || {}).id || ''
            const provider = providers.some(entry => entry.id === current.provider) ? current.provider : fallbackProvider
            const pool = (providers.find(entry => entry.id === provider) || {}).models || []
            const model = pool.some(entry => entry.id === current.model)
              ? current.model
              : (body.default && body.default.provider === provider && body.default.model) || (pool[0] || {}).id || ''
            const effort = typeof current.effort === 'string' ? current.effort : ''
            return { ...current, provider, model, effort }
          })
          const count = providers.reduce((total, entry) => total + (entry.models || []).length, 0)
          setNotice(format(t('scan.done'), { count: count, at: clock(new Date(body.scanned_at)) }))
        } catch (err) {
          setError(format(t('scan.error'), { reason: describeFailure(err) }))
        } finally {
          setBusy('')
        }
      }, [])

      useEffect(() => {
        loadState()
        loadCatalog()
      }, [loadState, loadCatalog])

      const cfg = config || {}
      const providers = catalog || []
      const providerEntry = providers.find(entry => entry.id === cfg.provider) || null
      const models = providerEntry ? providerEntry.models : []

      // 这次检测的结果本身也当成一条「最新记录」。中途离开再回来时，/state 里的历史
      // 可能还是收尾之前那一刻的（那一条是部分样本、没有概率），而结果区已经算出了
      // 校准概率；按「只要有一个百分比，就填进总览」的规则，用它压过历史里那一条，
      // 历史里压根还没有这一行时也补上。点过「清空记录」之后，清空之前算出来的结果
      // 不再往总览里塞，直到下一次结果出炉。
      const liveRow = useMemo(() => {
        if (!result || !result.provider || !result.model || !result.top) return ''
        const probability = typeof result.top.probability === 'number' && Number.isFinite(result.top.probability)
          ? result.top.probability
          : null
        if (probability === null) return ''
        const stamp = resultAt ? Date.parse(resultAt) : 0
        if (clearedAt && !(stamp > clearedAt)) return ''
        return {
          id: 'live',
          at: resultAt || '',
          provider: result.provider,
          model: result.model,
          decision: result.decision,
          used_outputs: result.used_outputs,
          top: { id: result.top.id, display_name: result.top.display_name, probability },
        }
      }, [result, resultAt, clearedAt])

      // 历史里每个 provider/model 只留最新一条（history 本身就是新的在前）
      const latestByKey = useMemo(() => {
        const map = new Map()
        for (const row of history) {
          if (!row || !row.model) continue
          const key = `${row.provider}\u0000${row.model}`
          if (!map.has(key)) map.set(key, row)
        }
        if (liveRow) {
          const key = `${liveRow.provider}\u0000${liveRow.model}`
          map.set(key, liveRow)
        }
        return map
      }, [history, liveRow])

      // 总览分组：只铺当前目录里的供应商 × 模型。某个模型从这台 DSH 里删掉之后，
      // 它连同上一次的结果一起消失——宿主已经把那条历史清了（见 /catalog 的 pruneHistory），
      // 这里也不再为「历史里有、目录里没有」的行另起一组。
      const groups = useMemo(() => {
        const list = []
        for (const provider of providers) {
          const models = ((provider && provider.models) || []).map(model => ({
            id: model.id,
            name: model.name || model.name === '' ? model.name : model.id,
            row: latestByKey.get(`${provider.id}\u0000${model.id}`) || null,
          }))
          if (models.length > 0) {
            list.push({ id: provider.id, name: provider.name || provider.id, models })
          }
        }
        return list
      }, [providers, latestByKey])

      // 模型换了就问一下它支持哪些推理强度
      useEffect(() => {
        let alive = true
        if (!cfg.provider || !cfg.model) {
          setEfforts([])
          return () => { alive = false }
        }
        const query = `?provider=${encodeURIComponent(cfg.provider)}&model=${encodeURIComponent(cfg.model)}`
        api(`/model-info${query}`, { method: 'GET' })
          .then(body => {
            if (!alive) return
            setEfforts(Array.isArray(body.efforts) ? body.efforts : [])
          })
          .catch(() => {
            if (alive) setEfforts([])
          })
        return () => { alive = false }
      }, [cfg.provider, cfg.model])

      // 选项改动后静默落盘（任务运行时不动配置）
      useEffect(() => {
        if (!config || skipSave.current) return
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
          post('/config', { config }).catch(() => {})
        }, 700)
        return () => {
          if (saveTimer.current) clearTimeout(saveTimer.current)
        }
      }, [config])

      const patch = (key, value) => setConfig(prev => ({ ...(prev || {}), [key]: value }))

      const pickProvider = id => {
        const entry = providers.find(item => item.id === id) || null
        const nextModel = entry && entry.models[0] ? entry.models[0].id : ''
        setConfig(prev => ({ ...(prev || {}), provider: id, model: nextModel, effort: '' }))
      }

      const useDefaultSelection = () => {
        if (!selection) return
        setConfig(prev => ({
          ...(prev || {}),
          provider: selection.provider,
          model: selection.model,
          effort: selection.effort || '',
        }))
      }

      const poll = useCallback(async jobId => {
        try {
          const body = await api(`/job?id=${encodeURIComponent(jobId)}`, { method: 'GET' })
          const job = body.job
          if (!job) throw new Error('job not found')
          setProgress(job.progress || null)
          if (Array.isArray(job.progress?.challenges) && job.progress.challenges.length > 0) {
            setSamples(job.progress.challenges)
          }
          if (job.status === 'done') {
            stopPolling()
            jobRef.current = null
            setBusy('')
            setResult(job.result || null)
            setResultAt(new Date().toISOString())
            // 作业收尾时 progress 只剩一句「检测完成」，样本详情挂在 result 里，
            // 用它把卡片刷成最终态（带完整正文），而不是把卡片藏起来。
            if (Array.isArray(job.result?.challenges) && job.result.challenges.length > 0) {
              setSamples(job.result.challenges)
            }
            setProgress(null)
            loadState()
            return
          }
          if (job.status === 'error' || job.status === 'cancelled') {
            stopPolling()
            jobRef.current = null
            setBusy('')
            setProgress(null)
            if (job.error) setError(format(t('common.error'), { reason: job.error }))
            return
          }
          timer.current = setTimeout(() => poll(jobId), 700)
        } catch (err) {
          stopPolling()
          setBusy('')
          setProgress(null)
          setError(format(t('common.error'), { reason: err.message }))
        }
      }, [stopPolling, loadState])

      const start = async () => {
        if (!cfg.provider || !cfg.model) {
          setError(t('run.needModel'))
          return
        }
        setBusy('detect')
        setError('')
        setNotice('')
        setResult(null)
        setSamples([])
        setOpenSample(null)
        setProgress({ stage: 'starting', message: '' })
        try {
          const saved = await post('/config', { config: cfg })
          if (saved.config) setConfig(saved.config)
          const body = await post('/detect', { config: cfg })
          if (!body.jobId) throw new Error('no job id')
          jobRef.current = body.jobId
          timer.current = setTimeout(() => poll(body.jobId), 400)
        } catch (err) {
          setBusy('')
          setProgress(null)
          setError(format(t('common.error'), { reason: err.message }))
        }
      }

      // 单独重跑一条样本：只发这一条提示词，回来后再拿其余有效样本一起重新排名。
      // 多条可以同时跑，所以这里按 jobId 找自己那张卡片的下标，不再用「当前那一条」。
      const pollRetry = useCallback(async jobId => {
        const index = retryJobs.current.has(jobId) ? retryJobs.current.get(jobId) : null
        try {
          const body = await api(`/job?id=${encodeURIComponent(jobId)}`, { method: 'GET' })
          const job = body.job
          if (!job) throw new Error('job not found')
          const slot = Array.isArray(job.progress?.challenges) ? job.progress.challenges[0] : null
          if (slot && index !== null) {
            setSamples(prev => prev.map((item, at) => (at === index ? { ...item, ...slot } : item)))
          }
          if (job.status === 'done') {
            finishRetry(jobId)
            if (job.result?.slot && index !== null) {
              const finalSlot = job.result.slot
              setSamples(prev => prev.map((item, at) => (at === index ? { ...finalSlot } : item)))
            }
            // merged 是宿主把这次重跑并回快照之后重算的排名（并发重试时以它为准）；
            // 重跑失败时后端只回一张卡片（result 为空），这时保留界面上原来的排名
            const merged = job.result?.merged
            if (merged) setResult(merged)
            else if (job.result?.result) setResult(job.result.result)
            else if (job.result?.decision) setResult(job.result)
            setResultAt(new Date().toISOString())
            // 重跑可能把「部分样本」补成带概率的校准排名，历史里那一行要跟着变
            refreshHistory()
            return
          }
          if (job.status === 'error' || job.status === 'cancelled') {
            finishRetry(jobId)
            if (job.error) setError(format(t('common.error'), { reason: job.error }))
            return
          }
          retryTimers.current.set(jobId, setTimeout(() => pollRetry(jobId), 700))
        } catch (err) {
          finishRetry(jobId)
          if (retryJobs.current.size === 0) setProgress(null)
          setError(format(t('common.error'), { reason: err.message }))
        }
      }, [finishRetry, refreshHistory])

      const retrySample = async index => {
        const sample = samples[index]
        if (!sample || !sample.prompt) return
        // 整轮检测在跑的时候样本正在被替换，不让重试；条与条之间互不影响
        if (busy === 'detect') return
        if (retrying && retrying[index]) return
        setError('')
        setNotice('')
        setBusy('retry')
        setRetrying(prev => ({ ...(prev || {}), [index]: true }))
        const others = samples
          .map((item, at) => (at === index ? null : item))
          .filter(item => item && (item.state === 'done' || item.state === 'capped') && typeof item.text === 'string' && item.text.trim())
          .map(item => ({ text: item.text, expectedCount: item.expected_count }))
        try {
          const body = await post('/retry', {
            config: cfg,
            // 宿主靠这个把重跑结果并回快照里的同一张卡片（并发重试时尤其重要：
            // 每条作业得知道自己对应哪一条样本，否则合并只能按顺序瞎猜）
            index,
            challenge: {
              id: sample.id,
              expected_count: sample.expected_count,
              prompt: sample.prompt,
            },
            outputs: others,
          })
          if (!body.jobId) throw new Error('no job id')
          retryJobs.current.set(body.jobId, index)
          retryTimers.current.set(body.jobId, setTimeout(() => pollRetry(body.jobId), 400))
        } catch (err) {
          setRetrying(prev => {
            const next = { ...(prev || {}) }
            delete next[index]
            return next
          })
          if (retryJobs.current.size === 0) setBusy('')
          setError(format(t('common.error'), { reason: err.message }))
        }
      }

      // 作业跑在 Host 进程里，关掉页面不会停；面板重新打开时把它接回来。
      // 作业已经跑完的（切去别的页面时结束的）也要把结果摆回来，否则切一次就什么都没有。
      // 可能同时有好几条重试在跑，所以按 /active 的 jobs 逐个接回。
      useEffect(() => {
        if (attached.current) return
        attached.current = true
        api('/active', { method: 'GET' })
          .then(body => {
            const list = Array.isArray(body?.jobs) ? body.jobs : (body?.job ? [body.job] : [])
            const running = list.filter(job => job && job.id && job.status === 'running')
            if (running.length > 0) {
              setError('')
              setNotice('')
              let detect = null
              for (const job of running) {
                if (job.mode === 'retry') {
                  const index = Number.isInteger(job.index) ? job.index : 0
                  retryJobs.current.set(job.id, index)
                  setRetrying(prev => ({ ...(prev || {}), [index]: true }))
                  setSamples(prev => (prev.length === 0 ? (Array.isArray(job.progress?.challenges) ? job.progress.challenges.slice(0, 1) : prev) : prev))
                  retryTimers.current.set(job.id, setTimeout(() => pollRetry(job.id), 400))
                } else {
                  detect = job
                }
              }
              setBusy(detect ? 'detect' : 'retry')
              if (detect) {
                jobRef.current = detect.id
                setProgress(detect.progress || null)
                const slots = Array.isArray(detect.progress?.challenges) ? detect.progress.challenges : []
                if (slots.length > 0) setSamples(slots)
                poll(detect.id)
              }
              return
            }
            const last = body && body.last
            if (!last || !last.result) return
            setError('')
            setResult(last.result)
            setResultAt(last.finished_at ? new Date(last.finished_at).toISOString() : (last.created_at ? new Date(last.created_at).toISOString() : ''))
            if (Array.isArray(last.result.challenges) && last.result.challenges.length > 0) {
              setSamples(last.result.challenges)
            }
            setProgress(null)
            setBusy('')
            setNotice(t('run.restored'))
            // 挂载时 /state 可能比作业收尾早一步，历史里还缺这一次的结果，补拉一次
            refreshHistory()
          })
          .catch(() => {})
      }, [poll, pollRetry, refreshHistory])

      const cancel = async () => {
        const ids = new Set()
        if (jobRef.current) ids.add(jobRef.current)
        for (const id of retryJobs.current.keys()) ids.add(id)
        jobRef.current = null
        stopPolling()
        clearRetries()
        setBusy('')
        setProgress(null)
        for (const id of ids) {
          try {
            await post('/cancel', { id })
          } catch {
            /* 作业可能已结束 */
          }
        }
      }

      const refresh = async () => {
        setBusy('refresh')
        setError('')
        setNotice('')
        try {
          const body = await post('/refresh', {})
          setDetector(body.detector || null)
          setNotice(t('det.refresh'))
        } catch (err) {
          setError(format(t('common.error'), { reason: err.message }))
        } finally {
          setBusy('')
        }
      }

      const clearHistory = async () => {
        try {
          await post('/history', { action: 'clear' })
          setHistory([])
          setClearedAt(Date.now())
        } catch (err) {
          setError(format(t('common.error'), { reason: describeFailure(err) }))
        }
      }

      const running = busy === 'detect'
      // 同时在跑的重试条数：每条卡片各管各的，不互相锁按钮
      const retryCount = Object.keys(retrying || {}).length
      const accepted = progress && progress.accepted ? progress.accepted : 0
      const total = progress && progress.total ? progress.total : Number(cfg.samples) || 3
      const ratio = progress && progress.stage === 'scoring' ? 0.92 : Math.min(0.9, accepted / Math.max(1, total))

      // 首次选模型时把「用户手动改过配置」的闸门打开
      useEffect(() => {
        if (config && skipSave.current) {
          const id = setTimeout(() => { skipSave.current = false }, 0)
          return () => clearTimeout(id)
        }
        return undefined
      }, [config])

      return h('div', { className: 'mf_page' },
        h('div', { className: 'mf_scroll' },
          h('div', { className: 'mf_root' },
        h('div', { className: 'mf_head' },
          h('div', { className: 'mf_headrow' },
            h('div', { className: 'mf_headtext' },
              h('h2', null, t('title')),
              h('p', null, t('intro'))),
            h('button', {
              className: 'mf_btn ghost',
              disabled: busy === 'rescan',
              title: t('scan.hint'),
              onClick: rescanCatalog,
            }, busy === 'rescan' ? t('scan.running') : t('scan.button')))),

        h('div', { className: 'mf_card' },
          h('div', { className: 'mf_row' },
            detector === null
              ? h('span', { className: 'mf_chip' }, t('det.loading'))
              : detector.ready
                ? h('span', { className: 'mf_chip on' }, t('det.ready'))
                : h('span', { className: 'mf_chip bad' }, t('det.broken')),
            detector && detector.models ? h('span', { className: 'mf_chip' }, format(t('det.models'), { count: detector.models })) : null,
            detector && detector.built_at ? h('span', { className: 'mf_chip' }, format(t('det.built'), { time: clock(detector.built_at) })) : null,
            detector && detector.bytes ? h('span', { className: 'mf_chip' }, bytesLabel(detector.bytes)) : null,
            h('button', {
              className: 'mf_btn ghost',
              style: { marginLeft: 'auto' },
              disabled: busy === 'refresh',
              onClick: refresh,
            }, busy === 'refresh' ? t('det.refreshing') : t('det.refresh'))),
          detector && detector.error ? h('p', { className: 'mf_error' }, format(t('det.error'), { reason: detector.error })) : null),

        h('div', { className: 'mf_card' },
          h('h3', null, t('pick.title')),
          h('p', { className: 'mf_sub' }, catalog === null ? t('pick.loading') : t('pick.intro')),
          catalog !== null && scannedAt
            ? h('p', { className: 'mf_help', style: { margin: '-6px 0 10px' } },
                format(t('scan.at'), { time: clock(scannedAt) }),
                ' · ',
                t('scan.cached'))
            : null,
          catalog !== null && providers.length === 0
            ? h('div', { className: 'mf_empty' }, t('pick.empty'))
            : h('div', { className: 'mf_grid' },
                h(Field, { label: t('pick.provider') },
                  h('select', {
                    className: 'mf_select',
                    value: cfg.provider || '',
                    onChange: e => pickProvider(e.target.value),
                  },
                    providers.map(entry => h('option', { key: entry.id, value: entry.id }, entry.name)))),
                h(Field, { label: t('pick.model') },
                  h('select', {
                    className: 'mf_select',
                    value: cfg.model || '',
                    onChange: e => patch('model', e.target.value),
                  },
                    models.length === 0
                      ? h('option', { value: '' }, t('pick.emptyProvider'))
                      : models.map(entry => h('option', { key: entry.id, value: entry.id }, entry.name)))),
                efforts.length > 0
                  ? h(Field, { label: t('pick.effort') },
                      h('select', {
                        className: 'mf_select',
                        value: cfg.effort || '',
                        onChange: e => patch('effort', e.target.value),
                      },
                        h('option', { value: '' }, t('pick.effort.default')),
                        efforts.map(effort => h('option', { key: effort.id, value: effort.id }, effort.name || effort.id))))
                  : null),
          providerEntry && providerEntry.error
            ? h('p', { className: 'mf_hint' }, providerEntry.error)
            : null,
          selection
            ? h('div', { className: 'mf_row', style: { marginTop: '10px' } },
                h('span', { className: 'mf_hint', style: { margin: 0 } },
                  format(t('pick.current'), { name: `${selection.provider} / ${selection.model}` })),
                h('button', { className: 'mf_btn ghost', onClick: useDefaultSelection }, t('pick.useDefault')))
            : null),

        h('div', { className: 'mf_card' },
          h('h3', null, t('opt.title')),
          h('div', { className: 'mf_grid' },
            h(Field, { label: t('opt.samples'), help: t('opt.samples.help') },
              h('select', {
                className: 'mf_select',
                value: String(cfg.samples || 3),
                onChange: e => patch('samples', Number(e.target.value) || 3),
              },
                h('option', { value: '1' }, t('opt.samples.one')),
                h('option', { value: '2' }, t('opt.samples.two')),
                h('option', { value: '3' }, t('opt.samples.three'))))),
          h('div', { className: 'mf_row', style: { marginTop: '12px' } },
            h('label', { className: 'mf_check' },
              h('input', {
                type: 'checkbox',
                checked: cfg.parallel !== false,
                onChange: e => patch('parallel', e.target.checked),
              }),
              t('opt.parallel')),
            h('label', { className: 'mf_check' },
              h('input', {
                type: 'checkbox',
                checked: cfg.relaxed !== false,
                onChange: e => patch('relaxed', e.target.checked),
              }),
              t('opt.relaxed')))),

        notices(notice, error),

        h('div', { className: 'mf_card' },
          h('h3', null, t('run.title')),
          h('p', { className: 'mf_sub' }, t('run.intro')),
          h('div', { className: 'mf_row' },
            h('button', { className: 'mf_btn primary', disabled: running || retryCount > 0, onClick: start },
              running ? t('run.running') : t('run.start')),
            running || retryCount > 0 ? h('button', { className: 'mf_btn', onClick: cancel }, t('run.cancel')) : null,
            progress && progress.stage
              ? h('span', { className: 'mf_chip' },
                  progress.stage === 'sampling' ? t('run.stage.sampling')
                    : progress.stage === 'scoring' ? t('run.stage.scoring')
                      : t('run.stage.done'))
              : null,
            progress && progress.total
              ? h('span', { className: 'mf_chip' }, format(t('run.accepted'), { accepted: progress.accepted || 0, total: progress.total }))
              : null,
            retryCount > 0
              ? h('span', { className: 'mf_chip' }, format(t('run.retryCount'), { count: retryCount }))
              : null,
            !running && retryCount === 0 && averageTps(samples) > 0
              ? h('span', { className: 'mf_chip', title: t('run.sample.tpsHint') },
                  format(t('run.tpsAvg'), { value: tpsNumber(averageTps(samples)) }))
              : null),
          running ? h('div', { className: 'mf_progress' }, h('i', { style: { width: `${Math.round(ratio * 100)}%` } })) : null,
          h(SamplesView, {
            t,
            samples,
            open: openSample,
            onToggle: setOpenSample,
            onRetry: retrySample,
            retrying,
            // 整轮检测在跑的时候才锁重试按钮；并发重试的几条各自解锁
            locked: running,
          })),

        result ? h(ResultView, { t, result }) : null,

        h('div', { className: 'mf_card' },
          h('div', { className: 'mf_row' },
            h('h3', null, t('ov.title')),
            history.length > 0
              ? h('button', { className: 'mf_btn ghost', style: { marginLeft: 'auto' }, onClick: clearHistory }, t('ov.clear'))
              : null),
          h(Overview, {
            t,
            groups,
            open: openGroups,
            onToggle: (id, next) => setOpenGroups(prev => {
              const map = prev || {}
              return { ...map, [id]: typeof next === 'boolean' ? next : !map[id] }
            }),
          }))
          ))
      )
    }

    // ------------------------------------------------------------ 注册

    // 侧边栏那一行只拿到 size，这里自绘一枚指纹图标（同心弧 + 两道下颌线）
    function PanelIcon({ size }) {
      const px = typeof size === 'number' && size > 0 ? size : 20
      return h('svg', {
        width: px,
        height: px,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      },
        h('path', { d: 'M4.2 12a7.8 7.8 0 0 1 15.6 0' }),
        h('path', { d: 'M7.2 12a4.8 4.8 0 0 1 9.6 0' }),
        h('path', { d: 'M10.2 12a1.8 1.8 0 0 1 3.6 0' }),
        h('path', { d: 'M12 12v5.7' }),
        h('path', { d: 'M8.6 12.5c0 2.3.4 3.7 1.4 5.1' }),
        h('path', { d: 'M15.4 12.5c0 2.3-.4 3.7-1.4 5.1' }))
    }

    function apply(ctx) {
      const locale = (ctx.get && ctx.get('locale')) || ctx.locale
      const slots = (ctx.get && ctx.get('slots')) || ctx.slots
      if (!locale || typeof locale.register !== 'function' || typeof locale.bind !== 'function') return
      const t = locale.bind(NS)
      ctx.effect(() => locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'model-fingerprint: dictionaries')

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-model-fingerprint')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'model-fingerprint: styles')

      if (!slots || typeof slots.inject !== 'function') return

      // 主区面板：占 root-scoped `main` 的 keyed slot，key 与侧边栏的 id 同名
      slots.inject('main', () => slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ t }),
      }, props => h(Page, { ...props, ctx, t })))

      // 侧边栏入口：排在「自动化任务」(order 10) 下面
      slots.inject('sidebar.panellist', () => slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 20,
        locale: NS,
        label: () => t('nav'),
      }, props => h(PanelIcon, { size: props && props.size })))
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = 'dsh-model-fingerprint'
    return module.exports
  },
})
