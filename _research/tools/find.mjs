// 在 app.asar 里按内容检索（只扫指定后缀 + 体积上限），用于定位宿主实现细节。
// 用法: node find.mjs "<needle>" [suffixFilter] [maxBytes]
import fs from 'node:fs'

const ASAR = 'C:\\Users\\superv\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar'
const needle = process.argv[2]
const suffix = process.argv[3] || '.js'
const maxBytes = Number(process.argv[4] || 4 * 1024 * 1024)

const fd = fs.openSync(ASAR, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const headerPickleSize = head.readUInt32LE(4)
const jsonLen = head.readUInt32LE(12)
const jsonBuf = Buffer.alloc(jsonLen)
fs.readSync(fd, jsonBuf, 0, jsonLen, 16)
const header = JSON.parse(jsonBuf.toString('utf8'))
const base = 8 + headerPickleSize

const entries = []
const walk = (node, prefix) => {
  for (const [name, value] of Object.entries(node.files || {})) {
    const full = prefix ? `${prefix}/${name}` : name
    if (value.files) walk(value, full)
    else entries.push({ path: full, offset: Number(value.offset), size: value.size })
  }
}
walk(header, '')

let scanned = 0
let hits = 0
for (const entry of entries) {
  if (!entry.path.endsWith(suffix)) continue
  if (entry.size > maxBytes) continue
  if (!Number.isFinite(entry.offset)) continue
  const buf = Buffer.alloc(entry.size)
  fs.readSync(fd, buf, 0, entry.size, base + entry.offset)
  scanned++
  const text = buf.toString('utf8')
  let index = text.indexOf(needle)
  if (index === -1) continue
  hits++
  const start = Math.max(0, index - 160)
  const end = Math.min(text.length, index + needle.length + 160)
  console.log(`\n=== ${entry.path} (${entry.size}B) ===`)
  console.log(text.slice(start, end).replace(/\s+/g, ' '))
  if (hits >= 12) break
}
console.log(`\nscanned=${scanned} hits=${hits}`)
fs.closeSync(fd)
