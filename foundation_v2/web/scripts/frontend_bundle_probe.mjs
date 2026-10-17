import { build } from 'vite'
import { gzipSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Build in memory so profiling never replaces the running developer's dist.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.resolve(process.argv[2] || path.join(root, '../evidence/rust-native-20261017/frontend/bundle.json'))
const result = await build({ root, configFile: path.join(root, 'vite.config.js'), logLevel: 'error', build: { write: false } })
const chunks = result.output.filter(item => item.type === 'chunk')
const byFile = new Map(chunks.map(chunk => [chunk.fileName, chunk]))
function closure(file, seen = new Set()) {
  if (seen.has(file) || !byFile.has(file)) return seen
  seen.add(file)
  for (const dependency of byFile.get(file).imports) closure(dependency, seen)
  return seen
}
const report = {
  scope: 'Vite production build; uncompressed and independent gzip chunk sizes, not network or latency measurements',
  runtime: { node: process.version },
  chunks: chunks.map(chunk => ({
    file: chunk.fileName, entry: chunk.isEntry, bytes: Buffer.byteLength(chunk.code), gzipBytes: gzipSync(chunk.code).length,
    imports: chunk.imports, dynamicImports: chunk.dynamicImports,
    modules: Object.keys(chunk.modules).map(file => path.relative(root, file).replaceAll('\\', '/')),
  })),
  routes: Object.fromEntries(['DashboardSessions', 'SessionPicker', 'SessionReports', 'AnalyticsWorkspace', 'ReplayWorkspace', 'DataDeskWorkspace'].map(name => {
    const chunk = chunks.find(item => Object.keys(item.modules).some(file => file.endsWith(`/src/${name}.jsx`)))
    const files = [...closure(chunk.fileName)]
    return [name, { files, bytes: files.reduce((sum, file) => sum + Buffer.byteLength(byFile.get(file).code), 0), gzipBytes: files.reduce((sum, file) => sum + gzipSync(byFile.get(file).code).length, 0) }]
  })),
}
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ output, routes: report.routes }))
