import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { compatibleAdvancedCharts } from '../advancedChartCompatibility.mjs'

const source = await readFile(process.env.TW_V2_CHARTING_LIBRARY_DIR
  ? `${process.env.TW_V2_CHARTING_LIBRARY_DIR}/charting_library.standalone.js`
  : new URL('../../../static/charting_library/charting_library.standalone.js', import.meta.url), 'utf8')

test('unknown or changed vendor distribution is never rewritten', () => {
  assert.throws(() => compatibleAdvancedCharts(`${source}\n`), /verified v23/)
})

for (const locale of ['vi', 'en']) test(`${locale}: iframe preserves original HTML and options without allocating a blob`, () => {
  function render(bundle) {
    let html
    class TestURL extends URL {
      static createObjectURL(blob) { html = blob.parts.join(''); return 'blob:http://127.0.0.1/chart' }
    }
    const context = vm.createContext({ URL: TestURL, Blob: class { constructor(parts) { this.parts = parts } }, location: { href: 'http://127.0.0.1/' }, window: {}, console })
    vm.runInContext(bundle, context)
    const Widget = context.TradingView.widget
    Widget.prototype._create = function () { this.markup = this._render() }
    const datafeed = {}
    const widget = new Widget({ datafeed, symbol: 'EUR/USD', interval: '1', locale, library_path: '/charting_library/', custom_css_url: '/chart-legacy.css?a=1&b=2', disabled_features: ['14851'] })
    assert.equal(context.window[widget._id].datafeed, datafeed)
    const options = new URLSearchParams(widget.markup.match(/data-widget-options="([^"]*)"/)[1])
    assert.equal(options.get('symbol'), 'EUR/USD')
    assert.equal(options.get('uid'), widget._id)
    assert.equal(options.get('locale'), locale)
    assert.equal(options.get('customCSS'), '/chart-legacy.css?a=1&b=2')
    return { html, markup: widget.markup }
  }
  const original = render(source)
  const adapted = render(compatibleAdvancedCharts(source))
  assert.equal(adapted.html, undefined, 'no blob URL allocated')
  assert.equal(adapted.markup.replace(/srcdoc="[^"]*"/, '').includes(' src='), false)
  const restoredHtml = adapted.markup.match(/srcdoc="([^"]*)"/)[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&')
  assert.equal(restoredHtml, original.html, 'embedded vendor document is byte-for-byte unchanged')
})
