// The browser picks regions in the top document; native chart events stay inside its iframe.
export function bindBrowserChartAnnotations(host) {
  const doc=host.ownerDocument, annotation=doc.oai?.annotation
  if(typeof annotation?.isActive!=='function')return ()=>{}
  const frameDoc=host.querySelector('iframe')?.contentDocument
  const docs=[...new Set([doc,frameDoc].filter(Boolean))]
  let space=false
  const sync=()=>{
    const active=annotation.isActive()===true
    if(!active)space=false
    host.toggleAttribute('data-browser-annotating',active&&!space)
  }
  const key=event=>{
    if(event.code!=='Space'||event.type==='keydown'&&event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return
    space=event.type==='keydown';sync()
  }
  const blur=()=>{if(!doc.hasFocus()){space=false;sync()}}
  doc.addEventListener('oaiannotationmodechange',sync)
  docs.forEach(item=>{
    item.addEventListener('keydown',key,true)
    item.addEventListener('keyup',key,true)
    item.defaultView?.addEventListener('blur',blur)
  })
  sync()
  return ()=>{
    doc.removeEventListener('oaiannotationmodechange',sync)
    docs.forEach(item=>{
      item.removeEventListener('keydown',key,true)
      item.removeEventListener('keyup',key,true)
      item.defaultView?.removeEventListener('blur',blur)
    })
    host.removeAttribute('data-browser-annotating')
  }
}
