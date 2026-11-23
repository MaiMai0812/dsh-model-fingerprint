# dsh-model-fingerprint

[lm.ikale.io](https://lm.ikale.io/#/?mode=api) 模型指纹检测的 [DSH] 插件版：把原版网站搬进侧边栏，
取样改走 DSH 自己的 `llm` 服务 —— 直接用「设置 → 模型」里已经接好的模型，不用填 Base URL，也不用贴 API Key。

Plugin version of [lm.ikale.io](https://lm.ikale.io/#/?mode=api): the same fingerprint check, sampling through DSH's own `llm` service instead of a hand-filled endpoint and key.

## 原版网站

<https://lm.ikale.io/#/?mode=api>

让模型随手写下一串 1 到 355 的整数，把回复与内置的模型参考库比对，判断这条路由背后到底是哪家的模型，
并给出候选排名；样本足够时给出校准概率。

这个插件沿用同一套参考库与判分口径，计算全在本地。差别只有两处：取样对象是这台 DSH 已接入的模型；
结果按「供应商 / 模型」记在面板下方的总览里，下次打开还在。

## 使用方法

1. 侧边栏「自动化任务」下方点「模型指纹」打开面板。
2. 选服务商与模型（该模型声明了推理强度的话还能再选一档），点「开始检测」。
3. 1–2 条样本给出相对排名（`partial`，没有概率）；3 条样本给出校准概率（`scored`）。
4. 每张样本卡片可以单条重试，也可以同时重试多条；跑完的卡片上标着这条的输出速度（tok/s）。
5. 切走面板、关掉页面都不影响：作业跑在宿主进程里，回来会接回进度；离开期间已经跑完的话，
   回来直接复原上一次的结果，顶部提示「已恢复上一次的检测结果」。
6. 「总览」按服务商分组，每行是某个模型最近一次的检测结果；顶部搜索框按服务商或模型名过滤，
   右上角「清空记录」清掉本地历史。

样本数、并行发送、宽松模式（凑够目标数字就停）在「采样选项」里调，改动自动保存。
参考库可以点「刷新数据」从原版网站重新拉取，清单与检测器成对落盘，重启后不会被随包副本顶回旧版。

检测结果是库内统计排序，不是身份证明：模型不在参考库里时，它给出的是最接近的那个，而不是「未知」。

## 安装

```powershell
dsh plugin --profile web add github:MaiMai0812/dsh-model-fingerprint
```

装完重启 DSH（或对插件做一次 disable → enable），侧边栏「自动化任务」下方就会出现「模型指纹」。
