// Check the downloaded zst chunk: compressed vs decompressed size/hash, and confirm the
// bundle.json `bytes`/`sha256` refer to the compressed part or the decoded payload.
import fs from 'node:fs'
import zlib from 'node:zlib'
import crypto from 'node:crypto'

const DATA = 'D:/IT/DSH工作区/DSH插件/dsh-model-fingerprint/_research/data'
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const bundle = JSON.parse(fs.readFileSync(`${DATA}/bundle.json`, 'utf8'))
const entry = bundle.files['shared_detector.bin']
const zst = fs.readFileSync(`${DATA}/${entry.parts[0]}`)
const plain = zlib.zstdDecompressSync(zst)
console.log('declared bytes', entry.bytes, 'sha', entry.sha256)
console.log('zst', zst.length, sha(zst))
console.log('plain', plain.length, sha(plain))
const bin = fs.readFileSync(`${DATA}/shared_detector.bin`)
console.log('bin', bin.length, sha(bin), 'equals plain:', sha(bin) === sha(plain))
