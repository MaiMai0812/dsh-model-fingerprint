// Scan installed plugins' client bundles for slot registrations and settings-page patterns.
import fs from 'node:fs'
import path from 'node:path'

const root = 'C:/Users/superv/.dsh/profiles/desktop/node_modules'
const names = new Map()
function walk(dir, depth = 0) {
  if (depth > 4) return
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) { walk(full, depth + 1); continue }
    if (!e.name.endsWith('.js')) continue
    let text = ''
    try { text = fs.readFileSync(full, 'utf8') } catch { continue }
    for (const m of text.matchAll(/register\(\s*\{\s*name:\s*['"`]([^'"`]+)['"`]/g)) {
      const key = m[1]
      if (!names.has(key)) names.set(key, new Set())
      names.get(key).add(path.relative(root, full))
    }
  }
}
walk(root)
for (const [name, files] of [...names].sort()) console.log(name, '<-', [...files].join(', '))
