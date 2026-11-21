// 把 _research/data 里的 .zst 分片解成明文，供 verify.mjs / check-lib.mjs / ui-harness 复用。
// 用法：node decode.mjs                # 解压 data/ 下全部 .zst
//       node decode.mjs <in.zst> <out> # 解压单个
//
// 命名规则（与仓库里既有文件名一致）：
//   unified_reference.jsonl.<hash>.0.zst -> unified_reference.decoded
//   unified_bank.json.<hash>.0.zst       -> unified_bank.decoded
//   shared_detector.bin.<hash>.0.zst     -> shared_detector.bin
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(here, '..', 'data')

function targetOf(name) {
  const base = name.replace(/\.zst$/, '').replace(/\.[0-9a-f]{16}\.\d+$/, '')
  if (base.endsWith('.bin')) return base
  return `${base.replace(/\.(jsonl|json)$/, '')}.decoded`
}

function decode(input, output) {
  const raw = zstdDecompressSync(readFileSync(input))
  writeFileSync(output, raw)
  console.log(`${path.basename(input)} -> ${path.basename(output)} (${raw.length} bytes)`)
}

const [, , input, output] = process.argv
if (input) {
  decode(path.resolve(input), path.resolve(output || path.join(dataDir, targetOf(path.basename(input)))))
} else {
  for (const name of readdirSync(dataDir)) {
    if (!name.endsWith('.zst')) continue
    decode(path.join(dataDir, name), path.join(dataDir, targetOf(name)))
  }
}
