import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createPlaybookDraft, fetchPlaybooks, fetchPlaybookRevisions, diffPayloads, forkPlaybook, freezePlaybook, manualStrategyForm, manualStrategyPayload, resolvePlaybookSelection, revisePlaybook } from '../src/playbookApi.js'

const source = fs.readFileSync(new URL('../src/PlaybookWorkspace.jsx', import.meta.url), 'utf8')
const record = { record_id: 'book/a', revision: 7, payload: { name: 'Breakout', status: 'draft', execution_capability: 'manual-only', rules: { entry: { operator: 'close-above', period: 20 }, manual_notes: { entry: 'Chờ đóng nến', custom: 'keep' } }, strategy_spec: null, parent_playbook_id: 'origin', parent_revision: 2 } }

test('manual edits preserve executable rules, lineage, unknown notes and capability', () => {
  const before = structuredClone(record)
  const form = manualStrategyForm(record)
  const payload = manualStrategyPayload(record, { ...form, name: '  Breakout v2  ', entry: '  Đợi retest  ', risk: '0.5%' })
  assert.equal(payload.name, 'Breakout v2')
  assert.equal(payload.rules.manual_notes.entry, 'Đợi retest')
  assert.equal(payload.rules.manual_notes.risk, '0.5%')
  assert.equal(payload.rules.manual_notes.custom, 'keep')
  assert.deepEqual(payload.rules.entry, before.payload.rules.entry)
  assert.equal(payload.parent_playbook_id, 'origin')
  assert.equal(payload.parent_revision, 2)
  assert.equal(payload.execution_capability, 'manual-only')
  assert.deepEqual(record, before)
})

test('new manual strategy creates a draft without claiming execution support', () => {
  const payload = manualStrategyPayload(null, { name: '  London breakout  ', entry: 'Close outside range' })
  assert.equal(payload.status, 'draft')
  assert.equal(payload.execution_capability, 'manual-only')
  assert.equal(payload.rules.manual_notes.entry, 'Close outside range')
  assert.throws(() => manualStrategyPayload(null, { name: ' ' }), /Tên chiến lược/)
  assert.throws(() => manualStrategyPayload(null, { name: 'x'.repeat(161) }), /160/)
  assert.throws(() => manualStrategyPayload(null, { name: 'Valid', risk: 'x'.repeat(4001) }), /4.000/)
})

test('human notes cannot promote needs-definition strategy or replace its spec', () => {
  const input = { ...record, payload: { ...record.payload, execution_capability: 'needs-definition', strategy_spec: { definition_mode: 'manual', evidence_refs: [] } } }
  const payload = manualStrategyPayload(input, { name: 'Name', risk: '1%' })
  assert.equal(payload.execution_capability, 'needs-definition')
  assert.deepEqual(payload.strategy_spec, input.payload.strategy_spec)
})

test('strategy commands carry workspace and expected immutable revision', async () => {
  const original = globalThis.fetch, calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options, body: JSON.parse(options.body) }); return Response.json(record) }
  try {
    await revisePlaybook('test-workspace', record, record.payload)
    await freezePlaybook('test-workspace', record)
    await forkPlaybook('test-workspace', record, 'Fork')
    await createPlaybookDraft('test-workspace', 'New', { execution_capability: 'manual-only', rules: { manual_notes: { risk: '0.5%' } }, status: 'frozen' })
    assert.deepEqual(calls.map(item => item.url), ['/api/v2/playbooks/book%2Fa/revisions', '/api/v2/playbooks/book%2Fa/freeze', '/api/v2/playbooks/book%2Fa/fork', '/api/v2/playbooks'])
    for (const call of calls) { assert.equal(call.options.headers['X-Workspace-Id'], 'test-workspace'); assert.equal(call.options.method, 'POST'); assert.ok(call.options.headers['Idempotency-Key']) }
    assert.deepEqual(calls.slice(0, 3).map(item => item.body.expected_revision), [7, 7, 7])
    assert.deepEqual(calls[0].body.payload, record.payload)
    assert.equal(calls[3].body.status, 'draft')
    assert.equal(calls[3].body.rules.manual_notes.risk, '0.5%')
  } finally { globalThis.fetch = original }
})

test('linked strategy resolves exact older revision and never silently selects latest', async () => {
  const original = globalThis.fetch, calls = []
  globalThis.fetch = async (url, options) => { calls.push([url, options]); return Response.json({ items: [{ revision: 2, payload: { name: 'Original rules', rules: { risk: '1%' } }, created_at_utc: '2026-01-01T00:00:00Z' }] }) }
  try {
    assert.equal(await resolvePlaybookSelection('tenant', [record], record.record_id, 7), record)
    assert.equal(calls.length, 0)
    const exact = await resolvePlaybookSelection('tenant', [record], record.record_id, '2')
    assert.equal(exact.record_id, record.record_id)
    assert.equal(exact.revision, 2)
    assert.equal(exact.payload.name, 'Original rules')
    assert.equal(calls[0][0], '/api/v2/playbooks/book%2Fa/revisions')
    assert.equal(calls[0][1].headers['X-Workspace-Id'], 'tenant')
    await assert.rejects(resolvePlaybookSelection('tenant', [record], record.record_id, 3), /Không tìm thấy phiên bản/)
    await assert.rejects(resolvePlaybookSelection('tenant', [], record.record_id, 7), /không còn khả dụng/)
    await assert.rejects(resolvePlaybookSelection('tenant', [record], record.record_id, 'NaN'), /không hợp lệ/)
    assert.equal(await resolvePlaybookSelection('tenant', [], '', ''), null)
  } finally { globalThis.fetch = original }
})

test('version differences preserve zero, absent and nested values deterministically', () => {
  assert.deepEqual(diffPayloads({ b: 1, a: 0 }, { a: 0, b: 1 }), [])
  const diff = diffPayloads({ risk: 0, rules: { entry: 'old' } }, { rules: { entry: 'new' }, empty: null })
  assert.deepEqual(diff.map(item => item.path), ['empty', 'risk', 'rules.entry'])
  assert.equal(diff[1].left, 0)
  assert.equal(diff[1].rightDisplay, '—')
})

test('strategy surface reuses shared modal/select and fences stale reads without broker execution', () => {
  assert.match(source, /LegacyModal/)
  assert.match(source, /FxSelect/)
  assert.match(source, /MAX_GET_RETRIES\s*=\s*3/)
  assert.match(source, /requestSeq !== catalogRequestSeq\.current/)
  assert.match(source, /requestSeq !== historyRequestSeq\.current/)
  assert.match(source, /key=\{workspace\}/)
  assert.doesNotMatch(source, /OrderSend|submitLive|localStorage|\/execution/)
})


test('malformed successful catalog/history reads are errors rather than empty strategies',async()=>{
  const original=globalThis.fetch
  try {
    globalThis.fetch=async()=>Response.json({unexpected:[]})
    await assert.rejects(fetchPlaybooks('tenant'),/không hợp lệ/)
    await assert.rejects(fetchPlaybookRevisions('tenant','record'),/không hợp lệ/)
  } finally {globalThis.fetch=original}
})
