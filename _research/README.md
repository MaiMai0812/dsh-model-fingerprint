# _research —— 插件是怎么被逆向出来并验证的

这个目录不参与插件运行，只是**证据与工具**，删掉不影响插件功能。所有路径都相对本目录。

## 目录

| 路径 | 内容 |
| --- | --- |
| `data/` | 从 `lm.ikale.io/data/` 抓下来的原始数据：`bundle.json`（70 个参考模型的清单）、`manifest.json`、`shared_detector.bin`（5,090,952 B，检测器权重），以及 `unified_reference.jsonl.*.zst` / `unified_bank.json.*.zst` 官方归档 |
| `src/` | 官方 SDK / 页面 bundle 里抽出的算法源码（`shared_fingerprint-core.js`、`shared_positional.ts`、`shared_shared-detector.ts`、`shared_detector-codec.ts`、`shared_completion.ts`、`shared_challenge-browser.js` 等） |
| `ref/` | 从 DSH 的 `app.asar` 里提取的宿主实现（`locale-client.js`、`cordis-plugin-loader.js`、`desktop-host-index.js`、skill 的 host-plugin/ui-plugin/practices/verification 文档，以及早期版本的 `dsh-tools-*.js`），用来对齐插件契约 |
| `tools/` | 复刻与验证脚本，见下 |
| `ui-harness/` | 用 jsdom + react-dom 真渲染 `client.js` 的测试台 |

明文数据（`*.decoded`）不入库，需要时解压：

```powershell
cd tools
node decode.mjs            # 解压 data/ 下全部 .zst
node decode.mjs <in.zst> <out>
```

## 验证脚本

在 `_research/tools/` 下运行，`node` 需要 ≥ 22（用到 `zlib.zstdDecompressSync`）。

| 脚本 | 作用 |
| --- | --- |
| `verify.mjs` | 纯 JS 复刻官方算法全链路，用 `unified_reference.decoded` 的 70 个模型各 3 条回答跑分，断言 top-1 = 70/70（需先 `node decode.mjs`） |
| `check-lib.mjs` | 同上，但直接用插件正式的 `lib/fingerprint.js` + `lib/detector.js`（验证移植没走样） |
| `check-engine.mjs` | 跑 `lib/engine.js`：challenge 生成、配置读写、`scoreTexts`、`startJob`、`cancelJob`、`clearHistory`（固定配置形状，见文件顶部） |
| `smoke-host.mjs` | 用桩 ctx 加载 `index.js`：桩一个假 `llm` 服务（2 个 provider，其中一个 `listModels` 抛错），跑完 13 条路由 —— `/state`、`/active`（闲置时 `job=null`；起作业后能取到、带 `mode`/`index`；取消后回到 `null`）、`/catalog`、`/model-info`、`/config`、`/challenges`、`/detect` → `/job` 到终态、`/retry` → `/job`（`mode=retry`，只多花 1 次模型调用、回来一起重算分，作业上带 `index`）、`/library`、`/refresh`、`/cancel`、跨站 403、GET 打 POST 路由 405，以及「只注入 webServer、不再注册任何工具」。DSH_HOME 指向 `os.tmpdir()/dsh-model-fingerprint-smoke`，不会动真状态文件 |
| `fixture` 类 | `asar.mjs`（列 asar 条目）、`extract.mjs`（从 asar 抽文件）、`find.mjs`（按内容搜 asar）、`decode.mjs`（解 zst）、`dump-copy.mjs`、`scan-slots.mjs`、`probe-zst.mjs`、`fetchtrace.mjs`（`node --import ./fetchtrace.mjs <脚本>` 打印失败请求的 URL 与 cause，排查 `fetch failed` 用） |

## UI 测试台

```powershell
cd ui-harness
npm i --legacy-peer-deps --registry=https://registry.npmmirror.com   # taobao 源解析 @csstools peer 依赖会死循环
npm run render      # 挂载侧边栏面板 → 读真实 /state 与 /catalog → 切英文 → 两种结果视图 → 后台作业接回
npm run i18n        # 对比 client.js 里 t('...') 用到的键与 DICT 实际拥有的键（不需要 npm i）
node click-start.mjs   # 真的点一次「开始检测」，会花一次模型调用（配置里 samples 决定条数）
```

`i18n-check.mjs` 不渲染、只做键集比对，自带一份 React 桩，所以清掉 `node_modules` 之后照样能跑；
`render.mjs` / `click-start.mjs` 需要真的 `react` / `react-dom` / `jsdom`。

收尾前记得把 `ui-harness/node_modules` 与 `package-lock.json` 删掉（约 31 MB，不属于交付物），
下次要看效果再 `npm i` 一次。

`render.mjs` / `click-start.mjs` 会把相对 URL 的 `fetch` 代理到 `$env:DSH_GUI_URL`（默认 `http://127.0.0.1:61530`），所以**需要 DSH 正在运行且插件已安装**；GUI 端口变了就设这个环境变量（本机现在用的是 `http://127.0.0.1:61380`）。

在 jsdom 里「往输入框里打字」要绕两个坑（`render.mjs` 已封成 `type()` 辅助函数）：

1. React 判定原生 `input` 事件不可用（`document.createElement('div').oninput` 为 `undefined`），
   走的是 **change 事件 polyfill**：只有 `selectionchange` / `keyup` / `keydown` 才会去比对
   `_valueTracker`，而且必须先有 `focusin` 让它记住 `activeElement`。所以「改值」必须写成
   **`focusin` → 原型 setter 改值 → `keydown` + `keyup`** 三步，光派发 `input` 事件没用
   （`_valueTracker.getValue()` 一直是旧值）。
2. `focusin` 分支会调用 `activeElement.attachEvent('onpropertychange', …)` 这个 IE 时代的 API，
   jsdom 没有它，会抛 `TypeError: activeElement$1.attachEvent is not a function`（收尾时还会
   `detachEvent` 再抛一次）。给 `window.HTMLElement.prototype` 补两个空实现即可，不影响
   `keydown`/`keyup` 那条真正生效的路径。

除了真打字，`render.mjs` 还有几条不依赖输入的旁路：

1. 用「种子 hooks」把载荷塞进 `useState` 初值（`samples` 索引 10、`openSample` 11、
   `retrying` 12、`result` 13、`openGroups` 14、`Overview` 内部搜索词 15），分别验证
   「有校准概率（`scored`）」和「只有相对分数（`partial`）」两种结果视图、卡片展开 / 收起，
   以及总览搜索在 `kimi` / `deepseek` / `flash` / `model-failover` / 无命中五种输入下的分组与行数；
2. 单条重试用预置响应（`retryStub`：`/retry` 直接回 `jobId=retry-test`，`/job` 第一次回
   running、第二次回 done）跑通「点重试 → 轮询 → 原地替换那张卡 → 排名刷新」，不花模型调用；
3. 断言粘贴评分栏已经下线：页面里没有 `textarea`、也没有「评分」按钮；
4. 侧边栏注册核对：`ctx.slots` 桩现在把每次 `register(slotDef, component)` 记进 `box.slots[name]`，
   脚本会打印 `registered slots: main,sidebar.panellist`、`main slot: {name:"main",key:"model-fingerprint"…}`、
   `sidebar row: {name:"sidebar.panellist",id:"model-fingerprint",order:20…}` —— 这一行 `order: 20`
   必须大于 `dsh-client-ui-schedule` 的 `10`，否则会跑到「自动化任务」上面去；
5. 后台作业接回：用 `activeStub` 拦住 `/active`（回一个 `status:'running'` 的作业）与
   `/job?id=…`（按帧依次回 running → done），断言面板挂载后自动进入「检测中…」、卡片按
   `progress.challenges` 复原、作业到终态后结果出现、停止按钮消失。`mode=retry` 的作业还要
   按 `job.index` 指到对应那张卡片上；
6. 输出速度：种子里给样本塞 `output_tokens` / `decode_ms` / `basis_ms` / `buffered` / `tps`，
   断言卡片标题出现 `· 43 tok/s`、运行区多出「平均输出速度」的 chip、展开区出现
   `输出速度 43 tok/s · 912 个词 / 21.1 秒`。第三张卡专门设成 `buffered:true`（上游一次性
   下发），展开后应多一句「上游一次性下发，按整段耗时算」。

`click-start.mjs` 不依赖打字，直接点「开始检测」，真实跑一次作业。

历史不再单独成块，已经并进「总览」：每个模型行右边就是它最近一次的结果（决策 · 最像的模型 ·
置信度 · 时间）。`render.mjs` 用真实 `/state` 的历史核对这一点——搜 `flash` 时能看到
`DeepSeek-V4.1-Flash库内校准排名 · deepseek-v4.1-flash-1017 61.8%11-17 20:24` 这样带结果的行，
没测过的模型则打印 `未测试`。

## 关键结论（备查）

- 算法端口与官方 artifact 完全一致：`unified_reference` 上 top-1 命中 70/70。
- 特征维度 `355 + 74 + 102 + 220 = 751`，位置块第 4 段实际是 220 维。
- 官方数据只依赖 `bundle.json` + `shared_detector.bin`；`unified_bank` / `unified_reference` 只是验证用。
- 决策语义：1–2 条有效样本 → `partial`（无概率）；3 条 → `scored` + `reference_calibrated`；
  形状判定不过 → `not_model`；有效样本为 0 → `unscorable`。
- DSH 宿主 `locale.register` 是**扁平取值**（`dict[key]`，不拆点），词典键必须写成 `'res.noProb'`
  这种完整键；同一 ns 同一 locale 重复注册会抛错，所以注册要包在 `ctx.effect` 里。
- 链接安装（`link:`）的插件不能裸 `import '@deepseek-ai/*'`——模块解析沿盘符向上走，到不了 profile 的
  `node_modules`。取样改走 `ctx.get('llm')` 服务（`listProviders` / `listModels` /
  `resolveModelInfo` / `stream`），插件因此不需要任何凭据。
- `llm.stream` 的 chunk 里只有 `{type:'text-delta'}` 带正文；`{type:'finish',reason:{kind}}` 的
  `kind` 为 `error` / `aborted` 时才需要读 `reason.failure`。`stream` 只能派发一次。
- 真实链路实测（2026-11-17）：`deepseek-account / deepseek-flash` 单条样本 → `partial`，
  top-1 `deepseek-v4.1-flash-1017`；三条样本 → `scored`，概率 98.88%，家族 DeepSeek。
- 侧边栏面板的挂法（照抄 `@deepseek-ai/dsh-client-ui-schedule`）：往 root-scoped
  `sidebar.panellist` 注册一行（`id` + `order` + locale-aware `label` + 只吃 `{size}` 的图标组件），
  再用**同一个 id** 往 root-scoped `main` 注册页面本体（`key` = 那个 id）；
  `settings.section` 的注册已经撤掉。`layout` 会先查 `main` 注册表，缺 key 抛错并保持当前面板，
  `conversation` 是保留 key。图标自己画 SVG（6 条 path 的指纹弧线），
  这样 `dsh.client.inject` 不必再加 `@deepseek-ai/dsh-client-ui-primitives`。
- 作业一直跑在宿主进程里（`lib/engine.js` 的 `jobs` Map）：关页面不影响执行，
  重开页面靠 `GET /active` 接回——它挑 `status==='running'` 且 `createdAt` 最新的那个，
  返回 `{id,mode,index,status,created_at,progress,result,error,elapsed_ms}`。
  进程重启会丢掉内存作业，历史仍然在 `state.json` 里。
- 输出速度：`usage` chunk 在 `finish` 之前单独发一次，`outputTokens` 只有读它才拿得到
  （`text-delta` 只有正文）。分母按官方口径是「首个正文 token → 流结束」。
  但有些上游是一次性下发的——实测 `deepseek-account/deepseek-flash` 首字等了 20 秒、
  正文 2 秒到齐，按解码窗口算会得到 2000+ tok/s 的假速度。判据：`decodeMs < totalMs * 0.5`
  就改用整段请求时长，`slot.buffered=true` 让界面注明。修好之后同一路由实测 215 tok/s。
- `render.mjs` 的退出码：脚本末尾没有 `process.exit`，Node 会等事件循环清空；
  `--experimental` 之外没有额外坑。之前看到的 `exit code: 1` 是 PowerShell 把
  `node` 写到 stderr 的内容当成 `NativeCommandError`（`node render.mjs 2>&1 | ...` 时），
  真实退出码是 0——用 `$LASTEXITCODE` 或 `> $null 2>&1` 复核即可。
- 官方数据的分片是**按压缩后字节切流**的（`unified_detector.bin.0.zst` 恰好 4194304 字节），
  必须先 `Buffer.concat` 全部分片再整体解压；逐片解压会报 `unexpected end of file`
  （`lib/detector.js` 的 `fetchPart` 已按这个修，并保留逐片回退）。
