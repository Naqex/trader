import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildLocaleDictionary, translateWithDictionary } from '../src/testingCopySplit.js'
import { pruneDistAssets } from '../pruneDistAssets.mjs'

const copy = JSON.parse(fs.readFileSync(new URL('../src/testing-copy.json', import.meta.url), 'utf8'))

test('buildLocaleDictionary preserves exact VI/EN catalog lookups while shrinking per-locale payload', () => {
  const viDict = buildLocaleDictionary(copy, 'vi')
  const enDict = buildLocaleDictionary(copy, 'en')
  const rawBytes = Buffer.byteLength(JSON.stringify(copy))
  assert.ok(Buffer.byteLength(JSON.stringify(viDict)) < rawBytes, 'VI chunk must be smaller than combined bilingual catalog')
  assert.ok(Buffer.byteLength(JSON.stringify(enDict)) < rawBytes, 'EN chunk must be smaller than combined bilingual catalog')

  // Direct and reverse lookups match canonical testing-copy.json entries
  assert.equal(translateWithDictionary(viDict, 'Welcome to Testing', 'vi'), copy['Welcome to Testing'].vi.trim())
  assert.equal(translateWithDictionary(enDict, 'Chưa có phiên', 'en'), copy['Chưa có phiên'].en.trim())
  assert.equal(translateWithDictionary(viDict, 'Chưa có phiên', 'vi'), 'Chưa có phiên')
  assert.equal(translateWithDictionary(enDict, 'Không tải được {resource}.', 'en', { resource: translateWithDictionary(enDict, 'bảng giao dịch', 'en') }), 'Could not load the trades table.')
  assert.equal(translateWithDictionary(enDict, 'Đang cập nhật {resource}…', 'en', { resource: translateWithDictionary(enDict, 'kết quả phiên', 'en') }), 'Updating session results…')
  // Singular English adjustment and no greedy wildcard corruption
  assert.equal(translateWithDictionary(enDict, '{count} lệnh', 'en', { count: 1 }), '1 trade')
  assert.equal(translateWithDictionary(enDict, '{count} lệnh', 'en', { count: 3 }), '3 trades')
  assert.equal(translateWithDictionary(enDict, 'TSLA', 'en'), 'TSLA')
  assert.equal(translateWithDictionary(enDict, 'Tùy chỉnh', 'en'), 'Tùy chỉnh')
})

test('TestingResourceNotice translates resource label and templates via useTestingLocale', () => {
  const source = fs.readFileSync(new URL('../src/TestingPageState.jsx', import.meta.url), 'utf8')
  const start = source.indexOf('export function TestingResourceNotice')
  const end = source.indexOf('export function TestingResourceStatus', start)
  assert.ok(start >= 0 && end > start)
  const block = source.slice(start, end)
  assert.match(block, /useTestingLocale\(\)/)
  assert.match(block, /t\(resource\)/)
  assert.match(block, /t\('Không tải được \{resource\}\.',\s*\{\s*resource:\s*label\s*\}\)/)
  assert.doesNotMatch(block, /`Không tải được \$\{resource\}\.`/)
})

test('pruneDistAssets keeps transitively referenced and recent assets while removing stale unreferenced files', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'naqex-prune-dist-'))
  try {
    const assetsDir = path.join(tempRoot, 'assets')
    fs.mkdirSync(assetsDir, { recursive: true })
    fs.writeFileSync(
      path.join(tempRoot, 'index.html'),
      '<!doctype html><script type="module" src="/assets/index-active.js"></script><link rel="stylesheet" href="/assets/index-active.css">',
    )
    fs.writeFileSync(path.join(assetsDir, 'index-active.js'), 'import("./lazy-locale.js"); import("./nested-chunk.js");')
    fs.writeFileSync(path.join(assetsDir, 'index-active.css'), 'body{color:#fff}')
    fs.writeFileSync(path.join(assetsDir, 'lazy-locale.js'), 'export default {}')
    fs.writeFileSync(path.join(assetsDir, 'nested-chunk.js'), 'export const x = 1')
    fs.writeFileSync(path.join(assetsDir, 'recent-tab-chunk.js'), 'export const keep = true')
    fs.writeFileSync(path.join(assetsDir, 'stale-old-chunk.js'), 'export const drop = true')

    const nowMs = Date.UTC(2026, 10, 25, 12, 0, 0)
    const oldTime = new Date(nowMs - 72 * 3600 * 1000)
    const recentTime = new Date(nowMs - 2 * 3600 * 1000)
    for (const file of ['index-active.js', 'index-active.css', 'lazy-locale.js', 'nested-chunk.js', 'stale-old-chunk.js']) {
      fs.utimesSync(path.join(assetsDir, file), oldTime, oldTime)
    }
    fs.utimesSync(path.join(assetsDir, 'recent-tab-chunk.js'), recentTime, recentTime)

    const dry = pruneDistAssets({ distDir: tempRoot, keepHours: 24, apply: false, nowMs })
    assert.equal(dry.total, 6)
    assert.equal(dry.keptReferenced, 4)
    assert.equal(dry.keptRecent, 1)
    assert.equal(dry.staleCount, 1)
    assert.equal(dry.removedCount, 0)
    assert.equal(fs.existsSync(path.join(assetsDir, 'stale-old-chunk.js')), true)

    const applied = pruneDistAssets({ distDir: tempRoot, keepHours: 24, apply: true, nowMs })
    assert.equal(applied.removedCount, 1)
    assert.equal(fs.existsSync(path.join(assetsDir, 'stale-old-chunk.js')), false)
    assert.equal(fs.existsSync(path.join(assetsDir, 'lazy-locale.js')), true)
    assert.equal(fs.existsSync(path.join(assetsDir, 'recent-tab-chunk.js')), true)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
