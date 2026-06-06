import { describe, it, expect } from 'vitest'
import relativeTime from '../../src/functions/relativeTime'

// A fixed reference point so the relative phrases are deterministic.
const now = new Date('2026-06-06T12:00:00Z')

describe('relativeTime', () => {
  it('shows 剛剛 for anything under a minute', () => {
    expect(relativeTime('2026-06-06T11:59:30Z', now)).toBe('剛剛')
  })

  it('reports minutes and hours for recent toots', () => {
    expect(relativeTime('2026-06-06T11:55:00Z', now)).toBe('5 分鐘前')
    expect(relativeTime('2026-06-06T09:00:00Z', now)).toBe('3 小時前')
  })

  it('uses natural day words 昨天/前天 and "N 天前" beyond that', () => {
    expect(relativeTime('2026-06-05T12:00:00Z', now)).toBe('昨天')
    expect(relativeTime('2026-06-04T12:00:00Z', now)).toBe('前天')
    expect(relativeTime('2026-06-03T12:00:00Z', now)).toBe('3 天前')
  })

  it('falls back to an absolute date past a week, same year without the year', () => {
    expect(relativeTime('2026-05-01T12:00:00Z', now)).toContain('5')
    expect(relativeTime('2026-05-01T12:00:00Z', now)).not.toContain('2026')
  })

  it('includes the year for dates in a different year', () => {
    expect(relativeTime('2024-01-15T12:00:00Z', now)).toContain('2024')
  })

  it('returns an empty string for an unparseable timestamp', () => {
    expect(relativeTime('not-a-date', now)).toBe('')
  })
})
