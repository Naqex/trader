export function chatHistory(messages) {
  const history = []
  for (const { role, content, status } of messages) {
    if (!content?.trim() || ['running', 'queued', 'cancelling'].includes(status)) continue
    const last = history.at(-1)
    if (last?.role === role) last.content += `\n\n${content}`
    else history.push({ role, content })
  }
  return history
}

export function finishReply(messages, run) {
  const result = messages.map(item => item.role === 'user' && (item.id === run.id || item.status === 'running') ? { ...item, status: run.status } : item)
  const previous = result.at(-1)
  if (previous?.role === 'assistant' && previous.id === run.id) return result
  const content = run.text || ''
  if (!content && !['completed', 'cancelled'].includes(run.status)) return result
  const reply = { role: 'assistant', id: run.id, content, status: run.status, selection: run.selection, phase: run.phase }
  if (run.continuation_of && previous?.role === 'assistant' && previous.id === run.continuation_of) {
    result[result.length - 1] = { ...reply, content: previous.content + content }
  } else result.push(reply)
  return result
}

export function prependHistory(older, newer) {
  const previous = older.at(-1), next = newer[0]
  if (previous?.role === 'assistant' && next?.role === 'assistant' && next.continuation_of === previous.id) {
    return [...older.slice(0, -1), { ...next, content: previous.content + next.content, continuation_of: previous.continuation_of }, ...newer.slice(1)]
  }
  return [...older, ...newer]
}
