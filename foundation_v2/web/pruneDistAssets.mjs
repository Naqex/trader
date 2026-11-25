import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ASSET_REF_RE = /(?:(?:\.\.?\/|\/)?assets\/|\.\/)([A-Za-z0-9._-]+\.(?:js|mjs|css|svg|png|jpg|jpeg|webp|woff2?|ttf|json|map))/g

function collectReferencedAssets(distDir, assetsDir) {
  const referenced = new Set()
  const scanned = new Set()
  const queue = []

  const indexPath = path.join(distDir, 'index.html')
  if (fs.existsSync(indexPath)) {
    queue.push(indexPath)
  }

  while (queue.length) {
    const current = queue.pop()
    if (scanned.has(current)) continue
    scanned.add(current)
    let text
    try {
      text = fs.readFileSync(current, 'utf8')
    } catch {
      continue
    }
    ASSET_REF_RE.lastIndex = 0
    let match
    while ((match = ASSET_REF_RE.exec(text)) !== null) {
      const name = path.basename(match[1])
      if (!name || referenced.has(name)) continue
      const candidate = path.join(assetsDir, name)
      if (!fs.existsSync(candidate)) continue
      referenced.add(name)
      if (/\.(?:js|mjs|css)$/.test(name)) {
        queue.push(candidate)
      }
    }
  }
  return referenced
}

/**
 * Non-destructive asset pruner for Vite builds with `emptyOutDir: false`.
 * Preserves every asset transitively reachable from dist/index.html AND every
 * asset modified within `keepHours` so currently open browser tabs never hit
 * 404 chunk errors.
 */
export function pruneDistAssets({
  distDir = fileURLToPath(new URL('./dist', import.meta.url)),
  keepHours = 24,
  apply = false,
  nowMs = Date.now(),
} = {}) {
  const resolvedDist = path.resolve(distDir)
  const assetsDir = path.join(resolvedDist, 'assets')
  const result = {
    distDir: resolvedDist,
    apply: Boolean(apply),
    keepHours: Number(keepHours),
    total: 0,
    keptReferenced: 0,
    keptRecent: 0,
    skippedNonRegular: 0,
    staleCount: 0,
    removedCount: 0,
    reclaimedBytes: 0,
  }
  if (!fs.existsSync(assetsDir)) return result

  const referenced = collectReferencedAssets(resolvedDist, assetsDir)
  const cutoffMs = nowMs - Math.max(0, Number(keepHours) || 0) * 3600 * 1000
  const entries = fs.readdirSync(assetsDir, { withFileTypes: true })

  for (const entry of entries) {
    const filePath = path.join(assetsDir, entry.name)
    let stat
    try {
      stat = fs.lstatSync(filePath)
    } catch {
      continue
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      result.skippedNonRegular += 1
      continue
    }
    result.total += 1
    if (referenced.has(entry.name)) {
      result.keptReferenced += 1
      continue
    }
    if (stat.mtimeMs >= cutoffMs) {
      result.keptRecent += 1
      continue
    }
    result.staleCount += 1
    result.reclaimedBytes += stat.size
    if (apply) {
      fs.unlinkSync(filePath)
      result.removedCount += 1
    }
  }
  return result
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const keepArg = args.find(arg => arg.startsWith('--keep-hours='))
  const distArg = args.find(arg => arg.startsWith('--dist='))
  const keepHours = keepArg ? Number(keepArg.split('=')[1]) : 24
  const distDir = distArg ? distArg.slice('--dist='.length) : undefined
  const summary = pruneDistAssets({ distDir, keepHours, apply })
  console.log(JSON.stringify(summary, null, 2))
}
