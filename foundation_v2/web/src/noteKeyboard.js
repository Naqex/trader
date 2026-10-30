import { createExtension } from '@blocknote/core'

// BlockNote 0.55 inserts a bare paragraph at a block-container boundary after
// drag. Use its block transaction API so the document and cursor stay valid.
export const noteNodeSelectionEnter = createExtension(({editor}) => ({
  key:'noteNodeSelectionEnter',
  runsBefore:['nodeSelectionKeyboard'],
  keyboardShortcuts:{Enter:({event})=>{
    const selection=editor.prosemirrorState.selection
    if (!('node' in selection) || event.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false
    let id=selection.node.attrs.id
    for(let depth=selection.$from.depth; !id && depth>0; depth--) id=selection.$from.node(depth).attrs.id
    if(!id || !editor.getBlock(id)) return false
    editor.transact(()=>{
      const [paragraph]=editor.insertBlocks([{type:'paragraph'}],id,'after')
      editor.setTextCursorPosition(paragraph,'start')
    })
    return true
  }},
}))
