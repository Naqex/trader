import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
function luminance(hex) {
  const channels = hex.match(/\w\w/g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return channels.reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
}
function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + .05) / (dark + .05)
}

test('project palette keeps small replay text and action foregrounds readable in both themes', async () => {
  const css = await readFile(new URL('../public/project-palette.css', import.meta.url), 'utf8')
  const themes = css.split('}').slice(0, 2).map(block => Object.fromEntries(
    [...block.matchAll(/--project-([\w-]+):\s*#([\da-f]+)/gi)].map(match => [match[1], match[2]])))
  assert.equal(themes.length, 2)
  for (const palette of themes) {
    for (const foreground of ['text', 'muted', 'primary', 'highlight', 'positive', 'negative', 'warning']) {
      for (const background of ['canvas', 'surface', 'raised', 'control', ...(['text', 'muted'].includes(foreground) ? ['hover'] : [])]) {
        assert.ok(contrast(palette[foreground], palette[background]) >= 4.5,
          `${foreground} on ${background} in canvas #${palette.canvas}`)
      }
    }
    for (const background of ['primary', 'primary-hover', 'positive', 'negative']) {
      assert.ok(contrast(palette['on-primary'], palette[background]) >= 4.5,
        `action foreground on ${background} in canvas #${palette.canvas}`)
    }
  }
  // Semantic accents belong on content surfaces; selected/hovered controls use
  // neutral text because several pinned accent/hover pairs fall below 4.5:1.
  const chart = await readFile(new URL('../src/ChartWorkbench.css', import.meta.url), 'utf8')
  const selected = [...chart.matchAll(/[^{}]*button\[aria-pressed='true'\][^{}]*\{([^{}]*)\}/g)]
    .filter(match => /chart-(?:tool-rail|utility-rail|floating-toolbar)/.test(match[0]))
  assert.ok(selected.length >= 2)
  for (const rule of selected) assert.match(rule[1], /color:\s*var\(--chart-text\)/)
  assert.match(chart, /\.legacy-partial-total\.is-invalid:hover:not\(:disabled\)\s*\{\s*color:var\(--project-text\)/)
})
