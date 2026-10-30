export const emptyNote = () => ({ text:'', document:null })

export function noteDocument(blocks) {
  return { format:'blocknote', version:1, blocks }
}

function inlineOK(content,depth=0) {
  return depth<=12 && (typeof content==='string' || Array.isArray(content) && content.every(item=>typeof item==='string' || item?.type==='text' && typeof item.text==='string' || item?.type==='link' && typeof item.href==='string' && inlineOK(item.content,depth+1)))
}

export function documentError(document) {
  if (document == null) return null
  if (document.format !== 'blocknote' || document.version !== 1 || !Array.isArray(document.blocks) || !document.blocks.length || document.blocks.length > 256)
    return 'Cấu trúc ghi chú không được hỗ trợ.'
  if (JSON.stringify(document).length > 200000) return 'Ghi chú có quá nhiều định dạng. Vui lòng rút gọn trước khi lưu.'
  let count = 0
  const types = new Set(['paragraph','heading','quote','toggleListItem','numberedListItem','bulletListItem','checkListItem','codeBlock','divider','table','image','video','audio','file'])
  const visit = (blocks, depth = 0) => depth <= 12 && blocks.every(block => {
    if (++count > 1000 || !block || !types.has(block.type)) return false
    if(block.content!==undefined && (block.type==='table'
      ? !block.content || block.content.type!=='tableContent' || !Array.isArray(block.content.rows) || !block.content.rows.every(row=>row && Array.isArray(row.cells) && row.cells.every(cell=>inlineOK(cell) || cell?.type==='tableCell' && inlineOK(cell.content)))
      : !inlineOK(block.content)))return false
    return !block.children || Array.isArray(block.children) && visit(block.children,depth+1)
  })
  return visit(document.blocks) ? null : 'Cấu trúc ghi chú không được hỗ trợ.'
}

function inlineText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(item=>typeof item === 'string' ? item : item?.text ?? inlineText(item?.content)).join('')
  if (content?.type === 'tableContent' && Array.isArray(content.rows)) return content.rows.map(row=>Array.isArray(row?.cells)?row.cells.map(cell=>inlineText(cell?.content ?? cell)).join('\t'):'').join('\n')
  return ''
}

export function documentText(blocks) {
  return blocks.map(block=>[inlineText(block.content) || block.props?.url || '', block.children?.length ? documentText(block.children) : ''].filter(Boolean).join('\n')).join('\n').trimEnd()
}

export function readNoteValue(payload) {
  const document = payload.note_document ?? null
  const error = documentError(document)
  if (error) throw new Error(error)
  if (document && documentText(document.blocks) !== payload.note) throw new Error('Nội dung chữ và định dạng ghi chú không khớp. Chưa thay đổi bản đã lưu.')
  return { text:payload.note, document }
}
