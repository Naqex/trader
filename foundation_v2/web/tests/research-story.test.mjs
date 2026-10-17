import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = path.join(here, '..', 'src', 'ResearchWorkspace.jsx')
const stylePath = path.join(here, '..', 'src', 'research-story.css')

test('research story keeps the evidence-first flow and truthful safety boundary', async () => {
  const source = await readFile(sourcePath, 'utf8')
  const flow = ['Context', 'Quality gate', 'Run', 'Checkpoint', 'Result']
  let previous = -1
  for (const label of flow) {
    const index = source.indexOf(`label: '${label}'`)
    assert.ok(index > previous, `${label} must follow the previous research step`)
    previous = index
  }
  assert.match(source, /Broker locked · không gửi lệnh/)
  assert.match(source, /Không mở holdout, không kết nối broker/)
  assert.match(source, /Không hiển thị placeholder metrics/)
  assert.match(source, /data-testid="research-quality-takeaway"/)
  assert.match(source, /data-testid="research-next-actions"/)
  assert.match(source, /getResearchCheckpoint\(workspace, jobId, retrySignal\)/)
  assert.match(source, /cancelResearchJob\(workspace, jobState\.job\.job_id\)/)
  assert.match(source, /fallbackKind=\{job\?\.dataset_id \? 'job' : requestedDataset \? 'query' : 'none'\}/)
  assert.match(source, /Dataset chưa được xác nhận trong catalog/)
  assert.match(source, /research-terminal-result/)
  assert.match(source, /Không dựng kết quả thay thế/)
  assert.match(source, /const contextReady = Boolean\(selected \|\| job\?\.dataset_id\)/)
  assert.match(source, /data-flow-state=\{isTerminal \? 'terminal' : state \|\| 'pending'\}/)
  assert.match(source, /aria-current=\{step\.id === current \? 'step' : undefined\}/)
  assert.doesNotMatch(source, /selected \|\| Boolean\(contextDatasetId\)/)
  assert.doesNotMatch(source, /catalog\.datasets\[0\] \|\| null/)
})

test('research story styles provide stable geometry and responsive states', async () => {
  const css = await readFile(stylePath, 'utf8')
  assert.match(css, /\.rs-stepper\s*\{[^}]*grid-template-columns: repeat\(5/)
  assert.match(css, /\.rs-layout\s*\{[^}]*grid-template-columns: minmax\(0, 1\.25fr\)/)
  assert.match(css, /@media \(max-width: 1080px\)/)
  assert.match(css, /@media \(max-width: 520px\)/)
  assert.match(css, /prefers-reduced-motion: reduce/)
})

test('reopened research quality uses persisted job provenance without borrowing current catalog claims', async () => {
  const server = await createServer({ root: path.join(here, '..'), server: { middlewareMode: true }, appType: 'custom' })
  try {
    const { QualityTakeaway } = await server.ssrLoadModule('/src/ResearchWorkspace.jsx')
    const render = props => renderToStaticMarkup(React.createElement(QualityTakeaway, props))
    const currentCatalog = { dataset_id: 'mutable-catalog', artifact_sha256: 'current-sha', quality_status: 'verified', holdout_access: true, instrument_spec: {} }
    const job = { dataset_id: 'pinned-dataset', status: 'completed', result: { dataset_sha256: 'pinned-sha' } }
    const completed = render({ dataset: currentCatalog, job })
    assert.match(completed, /Chất lượng dữ liệu đã khóa theo run/)
    assert.match(completed, /pinned-dataset/)
    assert.match(completed, /pinned-sha/)
    assert.match(completed, /Chưa có quality snapshot/)
    assert.match(completed, /Không thể suy ra chất lượng hoặc quyền holdout/)
    assert.doesNotMatch(completed, /Chưa có dataset để ra quyết định|Chưa chọn dataset|mutable-catalog|current-sha|Dataset đủ điều kiện|Không có cảnh báo/)

    const queued = render({ job: { dataset_id: 'queued-dataset', status: 'queued' } })
    assert.match(queued, /Theo dõi trạng thái và checkpoint/)
    assert.match(queued, /Job chưa cung cấp hash dữ liệu/)
    assert.doesNotMatch(queued, /Chưa chọn dataset|Đọc result provenance/)

    const snapshot = render({ dataset: currentCatalog, job: { ...job, protocol: { dataset: { dataset_id: 'pinned-dataset', artifact_sha256: 'protocol-sha', quality: { status: 'unverified' }, holdout_policy: { mode: 'locked' } } } } })
    assert.match(snapshot, /snapshot lưu trong research job/)
    assert.match(snapshot, /protocol-sha/)
    assert.match(snapshot, /Dataset chưa được xác minh cho production/)
    assert.match(snapshot, /Holdout đang bị khóa/)
    assert.doesNotMatch(snapshot, /current-sha|Chưa có quality snapshot/)

    assert.match(render({}), /Chưa có dataset để ra quyết định/)
  } finally { await server.close() }
})
