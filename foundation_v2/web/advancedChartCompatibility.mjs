import { createHash } from 'node:crypto'

// v23 predates TradingView's iframe_loading_compatibility_mode. Adapt only its
// iframe transport; leave the authorized distribution and chart runtime intact.
const v23Sha256 = '7d817040632e32ef0f4000af8698051367cc5e7f0e29fa26bbc24f33b7eb36a9'
export function compatibleAdvancedCharts(source) {
  if (createHash('sha256').update(source).digest('hex') !== v23Sha256) {
    throw new Error('Advanced Charts compatibility adapter requires the verified v23.040 distribution')
  }
  return source
    .replace(',n=new Blob([e],{type:"text/html"}),i=URL.createObjectURL(n),o=new URL(i),s=', ',s=')
    .replace('return o.hash=s,`<iframe', 'return `<iframe')
    .replace('src="${o.href}"', 'srcdoc="${e.replace(/&/g,"&amp;").replace(/"/g,"&quot;")}"')
}
