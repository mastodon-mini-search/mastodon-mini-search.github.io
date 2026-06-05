import { describe, it, expect } from 'vitest'
import stripHTML from './stripHTML'

describe('stripHTML', () => {
  it('keeps a separator between adjacent block elements', () => {
    // Regression: textContent alone would yield "foobar".
    expect(stripHTML('<p>foo</p><p>bar</p>')).toBe('foo bar')
  })

  it('treats <br> as a separator', () => {
    expect(stripHTML('hello<br>world')).toBe('hello world')
  })

  it('strips tags and collapses surrounding whitespace', () => {
    expect(stripHTML('<p>a   <strong>b</strong></p>')).toBe('a b')
  })

  it('keeps inline markup inside a word together', () => {
    expect(stripHTML('<p>foo<strong>bar</strong></p>')).toBe('foobar')
  })

  it('drops attribute values such as href', () => {
    expect(stripHTML('<p><a href="https://example.com/x">link</a></p>')).toBe('link')
  })

  it('returns an empty string for empty input', () => {
    expect(stripHTML('')).toBe('')
  })
})
