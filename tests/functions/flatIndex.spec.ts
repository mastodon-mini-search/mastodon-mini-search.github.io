import { describe, it, expect } from 'vitest'
import { FlatIndexBuilder, FlatIndexView, loadFlatIndex } from '../../src/functions/flatIndex'
import { boundedEditDistance } from '../../src/functions/searchFlat'
import type { IndexDoc } from '../../src/functions/createIndex'

const docs: IndexDoc[] = [
  { uri: 'a', content: '我的電腦壞了' },
  { uri: 'b', content: 'foo bar baz' },
  { uri: 'c', content: '深度學習 machine learning' },
]

const ids = (rs: { id: string | number }[]) => rs.map(r => String(r.id)).sort()

describe('boundedEditDistance', () => {
  it('returns the exact distance when within the bound', () => {
    expect(boundedEditDistance('cat', 'cat', 1)).toBe(0)
    expect(boundedEditDistance('cat', 'cot', 1)).toBe(1)   // substitution
    expect(boundedEditDistance('cat', 'cats', 1)).toBe(1)  // insertion
    expect(boundedEditDistance('cats', 'cat', 1)).toBe(1)  // deletion
    expect(boundedEditDistance('kitten', 'sitting', 3)).toBe(3)
  })

  it('returns -1 when the distance exceeds the bound', () => {
    expect(boundedEditDistance('cat', 'dog', 1)).toBe(-1)
    expect(boundedEditDistance('cat', 'kitten', 2)).toBe(-1)
    // A length gap alone already exceeds the bound — early out.
    expect(boundedEditDistance('a', 'abcd', 2)).toBe(-1)
  })
})

describe('FlatIndexView round-trip', () => {
  it('serializes and restores to an identical searchable index', () => {
    const builder = new FlatIndexBuilder()
    for (const doc of docs) {
      builder.add(doc)
    }
    const view = loadFlatIndex(builder.serialize())

    expect(view).toBeInstanceOf(FlatIndexView)
    expect(view.documentCount).toBe(3)
    expect(ids(view.search('电脑'))).toEqual(['a'])     // trad/simp via the restored view
    expect(ids(view.search('foo'))).toEqual(['b'])
    expect(ids(view.search('learning'))).toEqual(['c'])
  })

  it('rejects an inconsistent bundle so the caller can rebuild', () => {
    const builder = new FlatIndexBuilder()
    builder.add(docs[0])
    const good = builder.serialize()

    // Drop the postings while the offsets still reference them.
    expect(() => loadFlatIndex({ ...good, postingDocs: new ArrayBuffer(0) })).toThrow()
    // A field-length array that no longer matches the document count.
    expect(() => loadFlatIndex({ ...good, fieldLengths: new ArrayBuffer(0) })).toThrow()
  })

  it('rejects a posting that points at a non-existent document', () => {
    const builder = new FlatIndexBuilder()
    builder.add(docs[0])
    builder.add(docs[1])
    const good = builder.serialize()

    const postingDocs = new Int32Array(good.postingDocs.slice(0))
    postingDocs[0] = 999 // out of [0, documentCount)
    expect(() => loadFlatIndex({ ...good, postingDocs: postingDocs.buffer })).toThrow()
  })

  it('rejects non-monotonic offsets', () => {
    const builder = new FlatIndexBuilder()
    builder.add(docs[0])
    builder.add(docs[1])
    const good = builder.serialize()

    const termOffsets = new Int32Array(good.termOffsets.slice(0))
    expect(termOffsets.length).toBeGreaterThan(2)
    // Shove an interior offset past a later one so the run decreases.
    termOffsets[1] = termOffsets[termOffsets.length - 1]
    expect(() => loadFlatIndex({ ...good, termOffsets: termOffsets.buffer })).toThrow()
  })
})

describe('FlatIndexBuilder.fromData (grow after restore)', () => {
  it('reconstructs a mutable builder that grows and searches correctly', () => {
    const built = new FlatIndexBuilder()
    built.add(docs[0])
    built.add(docs[1])

    // Restore-then-grow: rebuild a builder from the serialized bundle, add a new
    // doc, and confirm both old and new docs are searchable.
    const grown = FlatIndexBuilder.fromData(built.serialize())
    expect(grown.has('a')).toBe(true)
    expect(grown.has('c')).toBe(false)
    grown.add(docs[2])

    expect(grown.documentCount).toBe(3)
    expect(ids(grown.search('电脑'))).toEqual(['a'])
    expect(ids(grown.search('bar'))).toEqual(['b'])
    expect(ids(grown.search('learning'))).toEqual(['c'])

    // And it re-serializes to a view that agrees.
    const view = loadFlatIndex(grown.serialize())
    expect(ids(view.search('learning'))).toEqual(['c'])
  })
})
