import { describe, it, expect } from 'vitest'
import highlight from './highlight'

describe('highlight', () => {
  it('highlights a CJK bigram match', () => {
    expect(highlight('<p>我的电脑</p>', ['电脑', '电', '脑'])).toBe('<p>我的<mark>电脑</mark></p>')
  })

  it('highlights traditional text from simplified match terms (繁简对齐)', () => {
    // Display is traditional 電腦; matched terms are simplified (index space).
    expect(highlight('<p>我的電腦</p>', ['电脑', '电', '脑'])).toBe('<p>我的<mark>電腦</mark></p>')
  })

  it('highlights a latin term case-insensitively', () => {
    expect(highlight('<p>I love Coding</p>', ['coding'])).toBe('<p>I love <mark>Coding</mark></p>')
  })

  it('highlights only the latin run inside mixed CJK/latin text', () => {
    expect(highlight('<p>我用iPhone</p>', ['iphone'])).toBe('<p>我用<mark>iPhone</mark></p>')
  })

  it('highlights the matched document term from a fuzzy query', () => {
    // MiniSearch returns the expanded document term (e.g. "running" for a fuzzy
    // "runing" query), so the actual word in the post gets highlighted.
    expect(highlight('<p>running quickly</p>', ['running'])).toBe('<p><mark>running</mark> quickly</p>')
  })

  it('highlights full-width digits from a half-width term', () => {
    expect(highlight('<p>２０２４</p>', ['2024'])).toBe('<p><mark>２０２４</mark></p>')
  })

  it('never touches tags or attributes', () => {
    // "coding" appears in href but must not be highlighted there.
    const html = '<p><a href="https://x.com/coding">link</a></p>'
    expect(highlight(html, ['coding'])).toBe(html)
  })

  it('returns the input unchanged when there are no terms', () => {
    expect(highlight('<p>hello</p>', [])).toBe('<p>hello</p>')
  })

  it('does not highlight non-matching content', () => {
    expect(highlight('<p>世界</p>', ['电脑'])).toBe('<p>世界</p>')
  })
})
