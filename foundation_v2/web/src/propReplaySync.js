import { scopedMutation } from './scopedMutation.js'
import { propPriceMarkEvents } from './propReplayModel.js'

export function hasPendingPropReplayEvents(replay, propState) {
  const ledger = replay?.payload?.execution?.ledger
  const afterSequence = Number(propState.resumeState?.replay_binding?.last_replay_event_sequence || 0)
  return propState.status === 'ready' && propState.attempt?.status === 'running'
    && Array.isArray(ledger) && Number.isSafeInteger(afterSequence) && afterSequence >= 0
    && propPriceMarkEvents(ledger.slice(afterSequence), afterSequence).length > 0
}

// Resume from the acknowledged event, never repeat the order that produced it.
export async function syncPropReplayEvents({ workspace, sessionId, propSessionId, propAttemptId, propState, events }) {
  let current = propState
  const afterSequence = Number(current.resumeState?.replay_binding?.last_replay_event_sequence || 0)
  try {
    if (!Array.isArray(events) || !Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new Error('Chưa đọc đủ lịch sử để đồng bộ thử thách.')
    for (const event of propPriceMarkEvents(events, afterSequence)) {
      if (current.attempt.status !== 'running') break
      const response = await scopedMutation(`/api/v2/replay/sessions/${encodeURIComponent(sessionId)}/prop/sessions/${encodeURIComponent(propSessionId)}/attempts/${encodeURIComponent(propAttemptId)}/feed`, workspace, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspace },
        body: JSON.stringify({ replay_event_sequence: Number(event.sequence), expected_prop_revision: current.attempt.revision, prop_event_sequence: Number(current.phase.last_event_sequence) + 1 }),
      })
      const fed = await response.json().catch(() => ({}))
      if (!response.ok) throw Object.assign(new Error(String(fed.detail || `HTTP ${response.status}`)), { status: response.status })
      if (!fed.attempt || !fed.phase || !fed.resume_state || Number(fed.resume_state.replay_binding?.last_replay_event_sequence) !== Number(event.sequence)) throw new Error('Phản hồi đồng bộ thử thách không khớp sự kiện.')
      current = { ...current, status: 'ready', attempt: fed.attempt, phase: fed.phase, resumeState: fed.resume_state, objectives: fed.objectives || fed.resume_state?.prop_lifecycle?.last_objectives || current.objectives, error: null }
    }
    return { ...current, status: 'ready', error: null }
  } catch (error) {
    error.propState = current
    throw error
  }
}
