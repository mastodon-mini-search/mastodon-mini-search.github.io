import isCJKWord from './isCJKWord'
import tokenize from './tokenize'
import { IndexView, Postings, FuzzyMatch, searchFlat, boundedEditDistance } from './searchFlat'
import { SearchHit } from '../models/SearchHit'
import { FlatIndexData } from '../models/PersistedIndex'
import type { IndexDoc } from './createIndex'

// The flat inverted index, in two representations sharing one search algorithm
// (searchFlat over the IndexView they both implement):
//
//   FlatIndexBuilder — mutable, used to build and grow. Holds term -> postings
//     Maps; serialize() packs them into the flat ArrayBuffers.
//   FlatIndexView — read-only, used to restore a cache. Wraps the buffers in
//     typed-array views with NO reconstruction (the whole point: cold-start
//     restore is wrapping, not rebuilding a radix tree).
//
// Field length is the count of *unique* tokens in a doc (matching MiniSearch's
// `new Set(tokens).size`); term frequency counts every occurrence. Tokens are
// lowercased (MiniSearch's default processTerm) before indexing; the unique
// count is taken over the raw tokenizer output, before lowercasing.

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Materialize a term -> (docId -> freq) map into parallel arrays, docIds
// ascending (they're inserted in docId order, so insertion order already is).
function mapToPostings(postings: Map<number, number>): Postings {
  const size = postings.size
  const docs = new Int32Array(size)
  const freqs = new Int32Array(size)
  let i = 0
  for (const [doc, freq] of postings) {
    docs[i] = doc
    freqs[i] = freq
    i++
  }
  return { docs, freqs, df: size }
}

export class FlatIndexBuilder implements IndexView {
  private uris: string[] = []
  private docIndex = new Map<string, number>()
  private lengths: number[] = []
  private terms = new Map<string, Map<number, number>>()
  private totalLength = 0

  get documentCount(): number {
    return this.uris.length
  }

  get avgFieldLength(): number {
    return this.uris.length ? this.totalLength / this.uris.length : 0
  }

  has(uri: string): boolean {
    return this.docIndex.has(uri)
  }

  // Index one doc. No-op if its uri is already present (toots are immutable by
  // uri), so callers needn't pre-check for correctness — though indexDocs does,
  // to report how many were genuinely new.
  add(doc: IndexDoc): void {
    if (this.docIndex.has(doc.uri)) {
      return
    }
    const id = this.uris.length
    this.uris.push(doc.uri)
    this.docIndex.set(doc.uri, id)

    const tokens = tokenize(doc.content)
    const unique = new Set(tokens).size
    this.lengths.push(unique)
    this.totalLength += unique

    for (const raw of tokens) {
      const term = raw.toLowerCase()
      if (!term) {
        continue
      }
      let postings = this.terms.get(term)
      if (!postings) {
        this.terms.set(term, postings = new Map())
      }
      postings.set(id, (postings.get(id) ?? 0) + 1)
    }
  }

  fieldLength(doc: number): number {
    return this.lengths[doc]
  }

  uri(doc: number): string {
    return this.uris[doc]
  }

  getPostings(term: string): Postings | undefined {
    const postings = this.terms.get(term)
    return postings ? mapToPostings(postings) : undefined
  }

  fuzzyMatches(term: string, maxDistance: number): FuzzyMatch[] {
    const matches: FuzzyMatch[] = []
    for (const [candidate, postings] of this.terms) {
      if (isCJKWord(candidate)) {
        continue
      }
      const distance = boundedEditDistance(term, candidate, maxDistance)
      if (distance >= 0) {
        matches.push({ term: candidate, distance, postings: mapToPostings(postings) })
      }
    }
    return matches
  }

  search(query: string): SearchHit[] {
    return searchFlat(this, query)
  }

  // Pack the index into the flat buffer bundle for caching. Terms are sorted by
  // JS string order so the view can binary-search them.
  serialize(): FlatIndexData {
    const sortedTerms = [...this.terms.keys()].sort()
    const termCount = sortedTerms.length

    const termChunks = sortedTerms.map(t => encoder.encode(t))
    const termOffsets = new Int32Array(termCount + 1)
    for (let i = 0; i < termCount; i++) {
      termOffsets[i + 1] = termOffsets[i] + termChunks[i].length
    }
    const termBytes = new Uint8Array(termOffsets[termCount])
    for (let i = 0; i < termCount; i++) {
      termBytes.set(termChunks[i], termOffsets[i])
    }

    const postingsOffsets = new Int32Array(termCount + 1)
    for (let i = 0; i < termCount; i++) {
      postingsOffsets[i + 1] = postingsOffsets[i] + this.terms.get(sortedTerms[i])!.size
    }
    const postingCount = postingsOffsets[termCount]
    const postingDocs = new Int32Array(postingCount)
    const postingFreqs = new Int32Array(postingCount)
    const nonCjkTermIds: number[] = []
    let p = 0
    for (let i = 0; i < termCount; i++) {
      const term = sortedTerms[i]
      if (!isCJKWord(term)) {
        nonCjkTermIds.push(i)
      }
      const postings = this.terms.get(term)!
      const docs = [...postings.keys()].sort((a, b) => a - b)
      for (const doc of docs) {
        postingDocs[p] = doc
        postingFreqs[p] = postings.get(doc)!
        p++
      }
    }

    const docCount = this.uris.length
    const uriChunks = this.uris.map(u => encoder.encode(u))
    const uriOffsets = new Int32Array(docCount + 1)
    for (let i = 0; i < docCount; i++) {
      uriOffsets[i + 1] = uriOffsets[i] + uriChunks[i].length
    }
    const uriBytes = new Uint8Array(uriOffsets[docCount])
    for (let i = 0; i < docCount; i++) {
      uriBytes.set(uriChunks[i], uriOffsets[i])
    }

    return {
      uriBytes: uriBytes.buffer,
      uriOffsets: uriOffsets.buffer,
      fieldLengths: Int32Array.from(this.lengths).buffer,
      termBytes: termBytes.buffer,
      termOffsets: termOffsets.buffer,
      postingsOffsets: postingsOffsets.buffer,
      postingDocs: postingDocs.buffer,
      postingFreqs: postingFreqs.buffer,
      nonCjkTermIds: Int32Array.from(nonCjkTermIds).buffer,
    }
  }

  // Rebuild a mutable builder from a serialized bundle — the grow-after-restore
  // path (a fetch brought new toots after a cache hit). Off the cold-start
  // critical path; restore itself never does this.
  static fromData(data: FlatIndexData): FlatIndexBuilder {
    const builder = new FlatIndexBuilder()

    const uriBytes = new Uint8Array(data.uriBytes)
    const uriOffsets = new Int32Array(data.uriOffsets)
    const lengths = new Int32Array(data.fieldLengths)
    const docCount = uriOffsets.length - 1
    for (let i = 0; i < docCount; i++) {
      const uri = decoder.decode(uriBytes.subarray(uriOffsets[i], uriOffsets[i + 1]))
      builder.uris.push(uri)
      builder.docIndex.set(uri, i)
      builder.lengths.push(lengths[i])
      builder.totalLength += lengths[i]
    }

    const termBytes = new Uint8Array(data.termBytes)
    const termOffsets = new Int32Array(data.termOffsets)
    const postingsOffsets = new Int32Array(data.postingsOffsets)
    const postingDocs = new Int32Array(data.postingDocs)
    const postingFreqs = new Int32Array(data.postingFreqs)
    const termCount = termOffsets.length - 1
    for (let i = 0; i < termCount; i++) {
      const term = decoder.decode(termBytes.subarray(termOffsets[i], termOffsets[i + 1]))
      const postings = new Map<number, number>()
      for (let k = postingsOffsets[i]; k < postingsOffsets[i + 1]; k++) {
        postings.set(postingDocs[k], postingFreqs[k])
      }
      builder.terms.set(term, postings)
    }

    return builder
  }
}

export class FlatIndexView implements IndexView {
  private uriBytes: Uint8Array
  private uriOffsets: Int32Array
  private lengths: Int32Array
  private termBytes: Uint8Array
  private termOffsets: Int32Array
  private postingsOffsets: Int32Array
  private postingDocs: Int32Array
  private postingFreqs: Int32Array
  private nonCjkTermIds: Int32Array
  private termCount: number

  readonly documentCount: number
  readonly avgFieldLength: number

  constructor(readonly data: FlatIndexData) {
    this.uriBytes = new Uint8Array(data.uriBytes)
    this.uriOffsets = new Int32Array(data.uriOffsets)
    this.lengths = new Int32Array(data.fieldLengths)
    this.termBytes = new Uint8Array(data.termBytes)
    this.termOffsets = new Int32Array(data.termOffsets)
    this.postingsOffsets = new Int32Array(data.postingsOffsets)
    this.postingDocs = new Int32Array(data.postingDocs)
    this.postingFreqs = new Int32Array(data.postingFreqs)
    this.nonCjkTermIds = new Int32Array(data.nonCjkTermIds)

    this.documentCount = this.uriOffsets.length - 1
    this.termCount = this.termOffsets.length - 1

    this.validate()

    let total = 0
    for (let i = 0; i < this.lengths.length; i++) {
      total += this.lengths[i]
    }
    this.avgFieldLength = this.documentCount ? total / this.documentCount : 0
  }

  // Corruption guard: reject a truncated / inconsistent bundle (a partial write,
  // disk corruption, a format skew that slipped past the version gate) so the
  // caller rebuilds rather than serving garbage — or returning out-of-range doc
  // ids from a posting that points past the doc table. Every slice this view
  // takes (uri / term / postings) and every doc id it dereferences is proven
  // in-bounds here. O(terms + docs + postings), once, at restore.
  //
  // Note this validates the buffers are *internally* consistent; it does not
  // know the declared documentCount metadata or the store — loadIndex cross-
  // checks that the buffers cover the count the cache claims (see createIndex).
  private validate(): void {
    const fail = (why: string): never => {
      throw new Error(`FlatIndexView: ${why}`)
    }

    // Offset arrays must start at 0, end at their backing length, and be
    // monotonic non-decreasing — that makes every subarray slice valid.
    const checkOffsets = (offsets: Int32Array, backingLength: number, name: string): void => {
      if (offsets.length === 0 || offsets[0] !== 0 || offsets[offsets.length - 1] !== backingLength) {
        fail(`${name} offsets don't span their buffer`)
      }
      for (let i = 1; i < offsets.length; i++) {
        if (offsets[i] < offsets[i - 1]) {
          fail(`${name} offsets not monotonic`)
        }
      }
    }

    if (this.documentCount < 0 || this.termCount < 0) {
      fail('empty offset arrays')
    }
    checkOffsets(this.uriOffsets, this.uriBytes.length, 'uri')
    checkOffsets(this.termOffsets, this.termBytes.length, 'term')
    checkOffsets(this.postingsOffsets, this.postingDocs.length, 'postings')

    if (
      this.lengths.length !== this.documentCount ||
      this.postingsOffsets.length !== this.termCount + 1 ||
      this.postingDocs.length !== this.postingFreqs.length
    ) {
      fail('inconsistent array lengths')
    }

    // Every doc id a posting points at must be a real document, else a hit would
    // carry an out-of-range (wrong / undefined) id.
    for (let i = 0; i < this.postingDocs.length; i++) {
      const doc = this.postingDocs[i]
      if (doc < 0 || doc >= this.documentCount) {
        fail('posting references a non-existent document')
      }
    }
    // The fuzzy-scan term ids must be real terms.
    for (let i = 0; i < this.nonCjkTermIds.length; i++) {
      const t = this.nonCjkTermIds[i]
      if (t < 0 || t >= this.termCount) {
        fail('non-CJK term id out of range')
      }
    }
  }

  fieldLength(doc: number): number {
    return this.lengths[doc]
  }

  uri(doc: number): string {
    return decoder.decode(this.uriBytes.subarray(this.uriOffsets[doc], this.uriOffsets[doc + 1]))
  }

  private termAt(i: number): string {
    return decoder.decode(this.termBytes.subarray(this.termOffsets[i], this.termOffsets[i + 1]))
  }

  private postingsAt(i: number): Postings {
    const start = this.postingsOffsets[i]
    const end = this.postingsOffsets[i + 1]
    return {
      docs: this.postingDocs.subarray(start, end),
      freqs: this.postingFreqs.subarray(start, end),
      df: end - start,
    }
  }

  getPostings(term: string): Postings | undefined {
    let lo = 0
    let hi = this.termCount - 1
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      const candidate = this.termAt(mid)
      if (candidate === term) {
        return this.postingsAt(mid)
      }
      if (candidate < term) {
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return undefined
  }

  fuzzyMatches(term: string, maxDistance: number): FuzzyMatch[] {
    const matches: FuzzyMatch[] = []
    for (let n = 0; n < this.nonCjkTermIds.length; n++) {
      const i = this.nonCjkTermIds[n]
      const candidate = this.termAt(i)
      const distance = boundedEditDistance(term, candidate, maxDistance)
      if (distance >= 0) {
        matches.push({ term: candidate, distance, postings: this.postingsAt(i) })
      }
    }
    return matches
  }

  search(query: string): SearchHit[] {
    return searchFlat(this, query)
  }
}

// Restore a read-only index from a serialized bundle — wrapping buffers in
// views, no reconstruction. Throws on an inconsistent bundle (caller rebuilds).
export function loadFlatIndex(data: FlatIndexData): FlatIndexView {
  return new FlatIndexView(data)
}
