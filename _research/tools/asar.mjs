import fs from 'node:fs';
const asar = 'C:/Users/superv/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
const fd = fs.openSync(asar, 'r');
const head = Buffer.alloc(16); fs.readSync(fd, head, 0, 16, 0);
const jsonLen = head.readUInt32LE(12);
const buf = Buffer.alloc(jsonLen); fs.readSync(fd, buf, 0, jsonLen, 16);
const tree = JSON.parse(buf.toString('utf8'));
const base = head.readUInt32LE(4); // header pickle size
const dataOffset = 8 + base;
function walk(node, prefix, out) {
  for (const [name, val] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + '/' + name : name;
    if (val.files) walk(val, p, out); else out.push({ path: p, size: val.size, offset: val.offset });
  }
}
const out = []; walk(tree, '', out);
const q = process.argv[2] || '';
const limit = Number(process.argv[3] || 400);
const hits = out.filter(f => f.path.includes(q));
for (const h of hits.slice(0, limit)) console.log(h.path, h.size);
console.log('TOTAL', out.length, 'MATCH', hits.length, 'DATAOFFSET', dataOffset);
