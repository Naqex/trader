import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { translateTesting } from '../src/testingTranslate.js'

const copySource = fs.readFileSync(new URL('../src/testing-copy.json', import.meta.url), 'utf8')
const copy = JSON.parse(copySource)
const enums = JSON.parse(fs.readFileSync(new URL('../src/testing-enums.json', import.meta.url)))
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()

test('one-entry-per-line catalog has no duplicate keys hidden by JSON.parse', () => {
  const keys = [...copySource.matchAll(/^ {2}("(?:[^"\\]|\\.)*")\s*:/gm)].map(match => JSON.parse(match[1]))
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index)
  assert.deepEqual(duplicates, [], 'Duplicate keys overwrite translations silently')
  assert.equal(keys.length, Object.keys(copy).length, 'Keep each catalog entry on its own line')
})

test('system copy provides both locales with matching interpolation contracts', () => {
  for (const [key, entry] of Object.entries(copy)) {
    assert.ok(entry.vi.trim(), `Missing VI: ${key}`)
    assert.ok(entry.en.trim(), `Missing EN: ${key}`)
    assert.ok(![entry.vi,entry.en].some(text => text.includes('P/L')), `Use PnL in displayed copy: ${key}`)
    assert.deepEqual(placeholders(entry.vi), placeholders(entry.en), `Mismatched placeholders: ${key}`)
    if (placeholders(key).length) assert.deepEqual(placeholders(entry.en), placeholders(key), `Key mismatch: ${key}`)
  }
})

test('status families have both locales and blocked execution has an explanation', () => {
  for (const statuses of Object.values(enums)) for (const [key, entry] of Object.entries(statuses)) {
    assert.ok(entry.vi.trim(), key)
    assert.ok(entry.en.trim(), key)
  }
  assert.match(copy.replay_execution_not_initialized.en, /not been initialized/)
  assert.match(copy['LIVE REPLAY CURSOR'].en, /CURRENT REPLAY CURSOR/)
})

test('translateTesting uses exact lookup and explicit placeholders without greedy wildcard mangling', () => {
  assert.equal(translateTesting('Tùy chỉnh', 'vi'), 'Tùy chỉnh')
  assert.equal(translateTesting('Tùy chỉnh', 'en'), 'Tùy chỉnh')
  assert.equal(translateTesting('TSLA', 'vi'), 'TSLA')
  assert.equal(translateTesting('TSLA', 'en'), 'TSLA')
  assert.equal(translateTesting('Hủy lệnh', 'vi'), 'Hủy lệnh')
  assert.equal(translateTesting('Hủy lệnh', 'en'), 'Hủy lệnh')
  assert.equal(translateTesting('T{number}', 'vi', { number: 3 }), 'T3')
  assert.equal(translateTesting('T{number}', 'en', { number: 3 }), 'W3')
  assert.equal(translateTesting('{count} lệnh', 'vi', { count: 1 }), '1 giao dịch')
  assert.equal(translateTesting('{count} lệnh', 'en', { count: 1 }), '1 trade')
  assert.equal(translateTesting('{count} lệnh', 'en', { count: 4 }), '4 trades')
})
