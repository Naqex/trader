import { scopedMutation } from './scopedMutation.js'

const path = '/api/v2/live/note-folders'
async function decode(response) {
  const data = await response.json()
  if (!response.ok) throw new Error(data.detail === 'note_folder_name_exists' ? 'Tên thư mục đã tồn tại.' : 'Không lưu được thư mục. Thử lại sau.')
  if (data.version !== 'live-note-folders-v1' || !Array.isArray(data.items) || data.items.some(item => !item || typeof item.id !== 'string' || typeof item.name !== 'string' || !Array.isArray(item.note_ids) || item.note_ids.some(id => typeof id !== 'string'))) throw new Error('Dữ liệu thư mục không hợp lệ.')
  return data
}
export async function fetchNoteFolders(workspace, signal) {
  const response = await fetch(path,{headers:{'X-Workspace-Id':workspace},signal})
  if (!response.ok) throw new Error('Không đọc được thư mục. Thử lại sau.')
  return (await decode(response)).items
}
export async function createNoteFolder(workspace, name, noteIds) {
  const response = await scopedMutation(path,workspace,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,note_ids:noteIds})})
  try { const data = await decode(response); if (!data.created_id || !data.items.some(item => item.id === data.created_id)) throw new Error('Dữ liệu thư mục không hợp lệ.'); return data } catch (error) { if (response.ok || response.status >= 500) error.outcomeKnown = false; throw error }
}
