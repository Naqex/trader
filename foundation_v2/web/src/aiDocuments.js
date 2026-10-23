export const maxDocumentBytes = 10 * 1024 * 1024
export async function uploadDocument(workspace, file, signal) {
  if (!/\.(txt|md)$/i.test(file.name) || !file.size) throw new Error('invalid_ai_document')
  if (file.size > maxDocumentBytes) throw new Error('ai_document_too_large')
  const response = await fetch(`/api/v2/ai/assistant/documents?${new URLSearchParams({ name: file.name })}`, {
    method: 'POST', headers: { 'X-Workspace-Id': workspace, 'Content-Type': 'text/plain; charset=utf-8' }, body: file, signal,
  })
  const value = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(value.detail || 'invalid_ai_document')
  return value
}
export const documentSize = bytes => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`
