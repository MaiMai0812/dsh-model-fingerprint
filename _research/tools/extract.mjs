import fs from 'node:fs';
const asar = 'C:/Users/superv/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
const fd = fs.openSync(asar, 'r');
const head = Buffer.alloc(16); fs.readSync(fd, head, 0, 16, 0);
const jsonLen = head.readUInt32LE(12);
const buf = Buffer.alloc(jsonLen); fs.readSync(fd, buf, 0, jsonLen, 16);
const tree = JSON.parse(buf.toString('utf8'));
const dataOffset = 8 + head.readUInt32LE(4);
function walk(node, prefix, out) {
  for (const [name, val] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + '/' + name : name;
    if (val.files) walk(val, p, out); else out.push({ path: p, size: val.size, offset: val.offset });
  }
}
const out = []; walk(tree, '', out);
const map = new Map(out.map(f => [f.path, f]));
const [,, target, dest] = process.argv;
const f = map.get(target);
if (!f) { console.error('missing', target); process.exit(1); }
const chunk = Buffer.alloc(f.size);
fs.readSync(fd, chunk, 0, f.size, dataOffset + Number(f.offset));
fs.writeFileSync(dest, chunk);
console.log('wrote', dest, f.size);
