export const runPending = value => ['queued', 'running', 'cancelling'].includes(value?.status)

// Fetch keeps workspace auth headers available; native EventSource cannot send them.
export async function readRunEvents(response, onRun, signal) {
  if (!response.ok || !response.body) throw new Error('ai_stream_unavailable')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, '\n')
      if (buffer.length > 600000) throw new Error('ai_stream_too_large')
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2)
        const lines = frame.split('\n')
        const type = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (type === 'resync') throw new Error('ai_stream_unavailable')
        if (type === 'run' && data && onRun(JSON.parse(data)) === false) return
      }
      if (signal?.aborted || done) return
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
