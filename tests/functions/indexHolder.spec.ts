import { describe, it, expect } from 'vitest'
import { IndexHolder } from '../../src/functions/indexHolder'
import { INDEX_VERSION } from '../../src/functions/createIndex'
import type { IndexDoc } from '../../src/functions/createIndex'

// The holder works on already-stripped docs (the worker has no DOM), so tests
// hand it plain { uri, content } rather than HTML.
const docs: IndexDoc[] = [
  { uri: 'a', content: '我的電腦壞了' },
  { uri: 'b', content: 'foo bar' },
]

const ids = (holder: IndexHolder, q: string) => holder.search(q).map(r => String(r.id)).sort()

describe('IndexHolder', () => {
  it('build keeps a searchable index and returns a versioned cache blob', () => {
    const holder = new IndexHolder()
    const persisted = holder.build(docs)

    expect(persisted.version).toBe(INDEX_VERSION)
    expect(persisted.documentCount).toBe(2)
    expect(ids(holder, '电脑')).toEqual(['a']) // traditional/simplified equivalence
    expect(ids(holder, 'foo')).toEqual(['b'])
  })

  it('restore round-trips: a restored holder searches identically to the built one', () => {
    const built = new IndexHolder()
    const persisted = built.build(docs)

    const restored = new IndexHolder()
    expect(restored.restore(persisted)).toBe(true)
    expect(ids(restored, '电脑')).toEqual(['a'])
    expect(ids(restored, 'foo')).toEqual(['b'])
  })

  it('restore reports false on a corrupt bundle and stays empty instead of throwing', () => {
    const built = new IndexHolder()
    // A truncated buffer (a partial IndexedDB write): the postings are gone but
    // the offsets still claim them, so the consistency check rejects it.
    const corrupt = { ...built.build(docs), postingDocs: new ArrayBuffer(0) }

    const holder = new IndexHolder()
    expect(holder.restore(corrupt)).toBe(false)
    expect(holder.search('foo')).toEqual([])
  })

  it('restore rejects a bundle whose declared count disagrees with its buffers', () => {
    // The blob passes the cheap version+count gate (cacheMatches compares this
    // documentCount to the store), but its doc table holds a different number —
    // a corrupt / skewed write that must not be served as a valid index.
    const built = new IndexHolder()
    const lying = { ...built.build(docs), documentCount: 5 } // buffers hold 2

    const holder = new IndexHolder()
    expect(holder.restore(lying)).toBe(false)
    expect(holder.search('foo')).toEqual([])
  })

  it('grow adds only the docs not already held and re-caches the larger index', () => {
    const holder = new IndexHolder()
    holder.build([docs[0]]) // just 'a'
    const persisted = holder.grow(docs) // 'a' already present, only 'b' added

    expect(persisted.documentCount).toBe(2)
    expect(ids(holder, '电脑')).toEqual(['a'])
    expect(ids(holder, 'foo')).toEqual(['b'])
  })

  it('grow builds from scratch when there is no index yet', () => {
    const holder = new IndexHolder()
    holder.grow(docs)
    expect(ids(holder, 'foo')).toEqual(['b'])
  })

  it('search yields nothing before an index exists, and clear drops it back to empty', () => {
    const holder = new IndexHolder()
    expect(holder.search('foo')).toEqual([])

    holder.build(docs)
    expect(ids(holder, 'foo')).toEqual(['b'])

    holder.clear()
    expect(holder.search('foo')).toEqual([])
  })
})
