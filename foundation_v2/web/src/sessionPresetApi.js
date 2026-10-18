import { scopedRead } from './scopedRead.js'
import { scopedMutation } from './scopedMutation.js'
import { readJson, workspaceHeaders } from './researchDataApi.js'
import { readLegacySessionPresets, sessionPresetKey, validateSessionPreset } from './sessionPresets.js'

const route = '/api/v2/session-presets'
const details = {
  session_preset_name_exists:'Tên preset đã tồn tại.',
  session_preset_limit:'Lưu tối đa 50 preset cho mỗi loại phiên.',
  session_preset_revision_conflict:'Preset đã thay đổi. Tải lại trang trước khi sửa.',
  session_preset_not_found:'Preset đã thay đổi. Tải lại trang trước khi sửa.',
}
async function read(response) {
  try {return await readJson(response)}
  catch(error) {error.message=details[error.message] || 'Không lưu hoặc đọc được preset. Thử lại sau.';throw error}
}
function record(item,mode) {
  if(!item || typeof item.id !== 'string' || item.mode !== mode || !Number.isInteger(item.revision) || item.revision < 1) throw new Error('Không đọc được preset đã lưu.')
  validateSessionPreset(item)
  return item
}
async function list(workspace,mode,signal) {
  const payload=await read(await scopedRead(`${route}?mode=${mode}`,workspace,signal))
  if(payload.version !== 'session-presets-v1' || !Array.isArray(payload.items)) throw new Error('Không đọc được preset đã lưu.')
  return payload.items.map(item=>record(item,mode))
}
export async function saveSessionPreset(workspace,mode,preset,{idempotencyKey}={}) {
  const body={mode,...validateSessionPreset(preset)}
  if(preset.id) body.expected_revision=preset.revision
  const path=preset.id ? `${route}/${encodeURIComponent(preset.id)}/revisions` : route
  const headers=workspaceHeaders(workspace,{'Content-Type':'application/json',...(idempotencyKey ? {'Idempotency-Key':idempotencyKey} : {})})
  const saved=await read(await scopedMutation(path,workspace,{method:'POST',headers,body:JSON.stringify(body)}))
  try {
    record(saved,mode)
    if(saved.name!==body.name || !sameConfig(saved.config,body.config) || (preset.id && (saved.id!==preset.id || saved.revision<=preset.revision))) throw new Error('Không đọc được preset đã lưu.')
    return saved
  }
  catch(error) {error.outcomeKnown=false;throw error}
}
export async function deleteSessionPreset(workspace,mode,preset) {
  const saved=await read(await scopedMutation(`${route}/${encodeURIComponent(preset.id)}/delete`,workspace,{
    method:'POST',headers:workspaceHeaders(workspace,{'Content-Type':'application/json'}),body:JSON.stringify({mode,expected_revision:preset.revision}),
  }))
  if(saved.id!==preset.id || saved.mode!==mode || saved.deleted!==true || !Number.isInteger(saved.revision) || saved.revision<=preset.revision) throw Object.assign(new Error('Không đọc được preset đã lưu.'),{outcomeKnown:false})
  return saved
}

export async function fetchSessionPresets(workspace,mode,{storage,signal}={}) {
  let items=await list(workspace,mode,signal)
  let legacy,snapshot
  const key=sessionPresetKey(workspace,mode)
  try {snapshot=storage?.getItem(key);legacy=storage ? readLegacySessionPresets(storage,workspace,mode) : []}
  catch {return {items,warning:'Không đọc được preset cũ trên trình duyệt. Bản cũ được giữ nguyên.'}}
  if(!legacy.length) return {items,warning:''}
  try {
    for(const preset of legacy) {
      if(signal?.aborted) throw signal.reason
      const existing=items.find(item=>item.name.toLowerCase()===preset.name.toLowerCase())
      if(existing) {
        // Compare canonical data, not object key insertion order.
        if(!sameConfig(existing.config,preset.config)) throw new Error('legacy_name_conflict')
      } else {
        items.push(await saveSessionPreset(workspace,mode,{name:preset.name,config:preset.config},{idempotencyKey:`session-preset-import-v1:${mode}:${preset.id}`}))
      }
    }
    items=await list(workspace,mode,signal)
    if(legacy.some(preset=>!items.some(item=>item.name.toLowerCase()===preset.name.toLowerCase() && sameConfig(item.config,preset.config)))) throw new Error('legacy_import_unconfirmed')
    // An older open tab may still write local presets while requests are in
    // flight. Never remove data added after the snapshot we actually imported.
    if(storage.getItem(key)!==snapshot) throw new Error('legacy_changed_during_import')
    storage.removeItem(key)
    return {items,warning:''}
  } catch(error) {
    if(signal?.aborted) throw error
    return {items,warning:'Chưa chuyển hết preset cũ vào workspace. Bản trên trình duyệt được giữ nguyên.'}
  }
}
function sameConfig(left,right) {
  if(left===right) return true
  if(!left || !right || typeof left!=='object' || typeof right!=='object') return false
  const keys=Object.keys(left)
  return keys.length===Object.keys(right).length && keys.every(key=>Object.hasOwn(right,key) && sameConfig(left[key],right[key]))
}
