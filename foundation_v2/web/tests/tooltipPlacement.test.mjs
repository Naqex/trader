import test from 'node:test'
import assert from 'node:assert/strict'
import { tooltipPlacement } from '../src/tooltipPlacement.js'

const anchor = (left, top) => ({ left, top, right:left+20, bottom:top+20, width:20, height:20 })
test('tooltips use all four sides without covering the trigger or leaving the viewport', () => {
  for (const [a,p,v,side] of [
    [anchor(190,260),{width:180,height:100},{width:400,height:400},'top'],
    [anchor(190,0),{width:180,height:100},{width:400,height:400},'bottom'],
    [anchor(0,140),{width:180,height:240},{width:400,height:300},'right'],
    [anchor(380,140),{width:180,height:240},{width:400,height:300},'left'],
  ]) {
    const result=tooltipPlacement(a,p,v)
    assert.equal(result.side,side)
    assert.ok(result.left>=8&&result.top>=8)
    assert.ok(result.left+result.maxWidth<=v.width-8&&result.top+result.maxHeight<=v.height-8)
    assert.ok(result.left+result.maxWidth<=a.left-8||result.left>=a.right+8||result.top+result.maxHeight<=a.top-8||result.top>=a.bottom+8)
  }
})
test('very long tooltips bound their reading area and keep the arrow clear of rounded corners', () => {
  const result=tooltipPlacement(anchor(150,5),{width:280,height:900},{width:320,height:400},{maxWidth:280})
  assert.equal(result.side,'bottom')
  assert.equal(result.maxHeight,359)
  assert.ok(result.arrowX>=16&&result.arrowX<=result.maxWidth-16)
  assert.equal(result.left,20)
})
