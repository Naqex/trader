import assert from 'node:assert/strict'

export async function installBrowserAnnotationFixture(context) {
  await context.addInitScript(()=>{
    window.__annotationActive=false
    document.oai={annotation:{isActive:()=>window.__annotationActive}}
  })
}

export async function checkBrowserChartAnnotations(page) {
  const host=page.locator('.advanced-chart-host'),frame=host.locator('iframe')
  const toggle=active=>page.evaluate(active=>{
    window.__annotationActive=active
    document.dispatchEvent(new CustomEvent('oaiannotationmodechange',{detail:{active}}))
  },active)
  const pointer=()=>frame.evaluate(node=>getComputedStyle(node).pointerEvents)
  assert.equal(await pointer(),'auto')
  await toggle(true)
  assert.equal(await pointer(),'none')
  assert.ok(await host.getAttribute('oai-annotatable'))
  assert.equal(await host.evaluate(node=>{
    const box=node.getBoundingClientRect(),target=node.ownerDocument.elementFromPoint(box.x+box.width/2,box.y+box.height/2)
    return target===node
  }),true,'Annotation hit test reaches the top-document chart host')
  await page.keyboard.down('Space');assert.equal(await pointer(),'auto')
  // Focus can enter the chart during Space passthrough; release must be seen in its document too.
  await frame.evaluate(node=>{
    const input=node.contentDocument.createElement('input');input.dataset.annotationFixture='';node.contentDocument.body.append(input);input.focus()
  })
  await page.keyboard.up('Space');assert.equal(await pointer(),'none')
  await page.keyboard.down('Space');assert.equal(await pointer(),'none','Typing in an input cannot switch to chart passthrough')
  await page.keyboard.up('Space')
  await frame.evaluate(node=>node.contentDocument.querySelector('[data-annotation-fixture]').remove())
  await toggle(false);assert.equal(await pointer(),'auto')
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('oaiannotationmodechange',{detail:{active:true}})))
  assert.equal(await pointer(),'auto','Only confirmed browser state can disable native interactions')
}
