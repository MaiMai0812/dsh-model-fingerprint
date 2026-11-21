// Dump the site bundle's mode/tab structure and the Chinese UI copy so the plugin can mirror it.
import fs from 'node:fs'
const s = fs.readFileSync('D:/IT/DSH工作区/DSH插件/dsh-model-fingerprint/_research/index.js', 'utf8')
const hits = new Map()
const re = /['"`]([^'"`\n]{2,80}[\u4e00-\u9fa5][^'"`\n]{0,120})['"`]/g
let m
while ((m = re.exec(s))) hits.set(m[1], (hits.get(m[1]) || 0) + 1)
console.log('chinese strings:', hits.size)
for (const [k] of hits) console.log(' -', k)
