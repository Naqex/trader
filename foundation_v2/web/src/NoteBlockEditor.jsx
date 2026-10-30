import { Component, useEffect, useMemo, useRef, useState } from 'react'
import same from 'fast-deep-equal'
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import { filterSuggestionItems, SideMenuExtension, SuggestionMenu } from '@blocknote/core/extensions'
import { en, vi } from '@blocknote/core/locales'
import { DragHandleButton, getDefaultReactSlashMenuItems, SideMenu, SideMenuController, SuggestionMenuController, useBlockNoteEditor, useComponentsContext, useCreateBlockNote, useDictionary, useExtensionState } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/ariakit'
import '@blocknote/ariakit/style.css'
import { useTestingLocale } from './testingLocale.jsx'
import { documentText, noteDocument } from './noteDocument.js'
import { NOTE_TEMPLATES } from './noteTemplates.js'
import NoteTemplatesDialog from './NoteTemplatesDialog.jsx'
import ChartIcon from './ChartIcon.jsx'
import './note-editor.css'

const schema = BlockNoteSchema.create({blockSpecs:defaultBlockSpecs})
const ORDER = ['heading','heading_2','heading_3','quote','toggle_list','numbered_list','bullet_list','check_list','paragraph','code_block','divider','table','image','video','audio','file']
const paragraphs = text => text.split('\n').map(content=>({type:'paragraph',content}))

const sideMenuOptions = {
  useTransitionStylesProps:{duration:0},
  useFloatingOptions:{
    // GenericPopover still auto-updates and hides clipped references. The default
    // SideMenu scroll hook dismisses even for a 1px scroll within the same block.
    whileElementsMounted:undefined,
    middleware:[{name:'noteFirstLine',fn:({x,y,elements,rects})=>{
      const reference=elements.reference.getBoundingClientRect()
      const line=elements.reference.contextElement?.querySelector('.bn-inline-content')
      if(line){
        const height=parseFloat(getComputedStyle(line).lineHeight)
        if(Number.isFinite(height))y=rects.reference.y+line.getBoundingClientRect().top-reference.top+(height-rects.floating.height)/2
      }
      const scale=window.devicePixelRatio || 1
      const left=reference.left+x-rects.reference.x,top=reference.top+y-rects.reference.y
      return {x:x+Math.round(left*scale)/scale-left,y:y+Math.round(top*scale)/scale-top}
    }}],
  },
}

function NoteSideMenu() {
  const editor=useBlockNoteEditor(),components=useComponentsContext(),dictionary=useDictionary()
  const block=useExtensionState(SideMenuExtension,{selector:state=>state?.block})
  const addBlock=()=>{
    if(!block)return
    const empty=Array.isArray(block.content) && block.content.length===0
    const target=empty?block:editor.insertBlocks([{type:'paragraph'}],block,'after')[0]
    editor.setTextCursorPosition(target)
    editor.getExtension(SuggestionMenu).openSuggestionMenu('/')
  }
  return <SideMenu><components.SideMenu.Button label={dictionary.side_menu.add_block_label} icon={<ChartIcon name="order"/>} onClick={addBlock}/><DragHandleButton/></SideMenu>
}

function RichEditor({ value, onChange, onBlur, disabled=false, label }) {
  const {t,language}=useTestingLocale(), [templates,setTemplates]=useState(false), host=useRef(null)
  const snapshot = useRef(value), applying=useRef(false)
  const editor=useCreateBlockNote({schema,initialContent:value.document?.blocks || paragraphs(value.text),dictionary:{...(language==='en'?en:vi),placeholders:{...(language==='en'?en:vi).placeholders,default:t("Nhập nội dung hoặc gõ '/' để chọn block")}},tabBehavior:'prefer-indent'},[language])
  const update = () => {
    if(applying.current)return
    const blocks=editor.document, next={text:documentText(blocks),document:noteDocument(blocks)}
    snapshot.current=next;onChange(next)
  }
  useEffect(()=>{
    // Server reload/conflict recovery may replace the value. A normal save receipt
    // must not reset the current selection, history or composition.
    if(same(snapshot.current,value))return
    applying.current=true
    try{editor.replaceBlocks(editor.document,value.document?.blocks || paragraphs(value.text));snapshot.current=value}
    finally{applying.current=false}
  },[editor,value])
  useEffect(()=>{
    const root=host.current?.querySelector('.bn-editor')
    if(root){root.setAttribute('aria-label',label);root.setAttribute('role','textbox');root.setAttribute('aria-multiline','true')}
  },[editor,label])
  const insertTemplate=(blocks,replace=false)=>{
    const empty=!documentText(editor.document).trim()
    if(replace||empty)editor.replaceBlocks(editor.document,blocks)
    else editor.insertBlocks(blocks,editor.document.at(-1),'after')
    editor.focus()
  }
  const items=useMemo(()=>[
    ...NOTE_TEMPLATES.map(template=>({title:template.name,subtext:t('Mẫu ghi chú'),group:t('Templates'),aliases:[template.name,'template','mẫu'],icon:<span>♧</span>,onItemClick:()=>{
      const block=editor.getTextCursorPosition().block
      if(documentText([block]).trim())editor.insertBlocks(structuredClone(template.blocks),block,'after')
      else editor.replaceBlocks([block],structuredClone(template.blocks))
      editor.focus()
    }})),
    ...getDefaultReactSlashMenuItems(editor).filter(item=>ORDER.includes(item.key)).sort((a,b)=>ORDER.indexOf(a.key)-ORDER.indexOf(b.key)),
  ],[editor,t])
  return <div ref={host} className="wm-note-block-editor" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))onBlur?.()}} onKeyDownCapture={event=>{
    // Ariakit retains hidden listboxes. Consume Escape only for the open menu,
    // before the editor closes it; hidden listboxes must not swallow later Escape.
    if(event.key==='Escape' && editor.getExtension(SuggestionMenu).shown()){event.stopPropagation();event.preventDefault();editor.getExtension(SuggestionMenu).closeMenu()}
  }} onKeyDown={event=>{
    // The editor owns Enter, list indentation and menu navigation; drawer-level
    // tab wrapping must not intercept its popovers or a nested template dialog.
    if(event.key==='Tab')event.stopPropagation()
  }}>
    <BlockNoteView editor={editor} editable={!disabled} slashMenu={false} sideMenu={false} theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} onChange={update}>
      <SideMenuController sideMenu={NoteSideMenu} floatingUIOptions={sideMenuOptions}/>
      <SuggestionMenuController triggerCharacter="/" getItems={async query=>filterSuggestionItems(items,query)}/>
    </BlockNoteView>
    <div className="wm-note-template-shortcut"><small>{t('Start with shortcuts')}</small><button type="button" className="fxa-button" disabled={disabled} onClick={()=>setTemplates(true)}>♧ /templates</button></div>
    {templates && <NoteTemplatesDialog onClose={()=>setTemplates(false)} onApply={insertTemplate}/>}
  </div>
}

class EditorBoundary extends Component {
  state={error:false}
  static getDerivedStateFromError(){return {error:true}}
  render(){
    if(!this.state.error)return this.props.children
    return <div className="wm-note-editor-error" role="alert"><p>{this.props.message}</p><textarea aria-label={this.props.label} readOnly value={this.props.value.text}/></div>
  }
}

export default function NoteBlockEditor(props) {
  const {t}=useTestingLocale()
  return <EditorBoundary value={props.value} label={props.label} message={t('Không mở được định dạng ghi chú. Nội dung gốc vẫn được giữ; vui lòng tải lại để thử lại.')}><RichEditor {...props}/></EditorBoundary>
}
