import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const testsDir = dirname(fileURLToPath(import.meta.url))
const sourceDir = resolve(testsDir, '..', 'src')

test('replay speed controls expose localized accessible names', async () => {
  const source = await readFile(resolve(sourceDir, 'ReplayWorkspace.jsx'), 'utf8')

  assert.match(
    source,
    /<FxSelect label=\{t\("Tốc độ replay"\)\} value=\{speed\}/,
    'the fallback chart speed selector must retain its accessible label',
  )
  const native = await readFile(resolve(sourceDir, 'LegacyReplayToolbar.jsx'), 'utf8')
  assert.match(native, /type="range"[^>]*aria-label=\{t\('Điều chỉnh tốc độ replay'\)\}/)
})
