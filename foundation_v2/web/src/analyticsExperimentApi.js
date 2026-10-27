import { readJson } from './researchDataApi.js'

export async function readAnalyticsExperiment({ workspace, sessionId, filters, config, signal, expected }) {
  const params = new URLSearchParams(filters)
  for (const [key, value] of Object.entries(config)) params.set(key, value)
  const payload = await fetch(`/api/v2/replay/sessions/${encodeURIComponent(sessionId)}/analytics/experiments?${params}`, {
    headers: { 'X-Workspace-Id': workspace }, signal,
  }).then(readJson)
  if (payload.schema_version !== 'replay-analytics-experiments-v1' || payload.read_only !== true || !Array.isArray(payload.rows)) throw new Error('experiment_read_model_invalid')
  if (Object.entries(config).some(([key, value]) => Number(payload.config?.[key]) !== Number(value))) throw new Error('Cấu hình mô phỏng chưa khớp yêu cầu.')
  if (expected && ['session_id', 'dataset_id', 'dataset_sha256', 'revision', 'cursor_index', 'execution_event_sequence'].some(key => payload.provenance?.[key] !== expected[key])) throw new Error('Đường giá chưa khớp revision/cutoff của báo cáo.')
  return payload
}
