import { describe, it, expect } from 'vitest'
import { instanceUrlOf } from '../../src/functions/oauth'

describe('instanceUrlOf', () => {
  it('pulls the instance out of a handle', () => {
    expect(instanceUrlOf('merely@fsk.im')).toBe('https://fsk.im')
  })

  it('tolerates a leading @ on the handle', () => {
    expect(instanceUrlOf('@merely@fsk.im')).toBe('https://fsk.im')
  })

  it('accepts a bare instance host', () => {
    expect(instanceUrlOf('fsk.im')).toBe('https://fsk.im')
  })

  it('accepts a full instance URL and drops the path', () => {
    expect(instanceUrlOf('https://fsk.im/')).toBe('https://fsk.im')
    expect(instanceUrlOf('http://fsk.im')).toBe('https://fsk.im')
  })

  it('reduces a pasted profile URL to its host (path stripped before @)', () => {
    expect(instanceUrlOf('https://fsk.im/@merely')).toBe('https://fsk.im')
  })

  it('trims surrounding whitespace', () => {
    expect(instanceUrlOf('  fsk.im  ')).toBe('https://fsk.im')
  })
})
