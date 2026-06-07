// A serialized flat inverted index, cached per account so the index can be
// *restored* on load instead of rebuilt — and, unlike a MiniSearch blob,
// restored without any reconstruction. Everything is held as `ArrayBuffer`s
// (typed-array / UTF-8 backing stores), so loading is just wrapping the buffers
// in views: IndexedDB structured-clones them as-is, with no JSON.parse and no
// radix-tree rebuild (the multi-second cold-start cost this format exists to
// kill). See flatIndex.ts for how these are produced and read.
//
// All offset arrays are `Int32Array` buffers; *Bytes are concatenated UTF-8.
export interface FlatIndexData {
  // Document table, indexed by dense docId [0, documentCount).
  uriBytes: ArrayBuffer       // each doc's uri, concatenated
  uriOffsets: ArrayBuffer     // Int32[documentCount + 1] into uriBytes
  fieldLengths: ArrayBuffer   // Int32[documentCount]: unique-token count per doc (BM25 length norm)

  // Term dictionary, sorted by JS string order so a term is found by binary
  // search; T = termOffsets.length - 1 distinct terms.
  termBytes: ArrayBuffer      // each term, concatenated UTF-8
  termOffsets: ArrayBuffer    // Int32[T + 1] into termBytes

  // Postings, grouped by term in dictionary order; P total (term, doc) pairs.
  postingsOffsets: ArrayBuffer // Int32[T + 1] into postingDocs/postingFreqs
  postingDocs: ArrayBuffer     // Int32[P]: docIds holding each term (ascending within a term)
  postingFreqs: ArrayBuffer    // Int32[P]: that term's frequency in the doc

  // The dictionary positions of non-CJK terms — the only terms fuzzy search has
  // to scan (a non-CJK query term can never reach a CJK term within its edit
  // budget). Lets fuzzy skip the hundreds of thousands of CJK n-grams.
  nonCjkTermIds: ArrayBuffer   // Int32[] indices into the term dictionary
}

// A FlatIndexData tagged for caching: the app schema version and the document
// count it covers — the cheap gate (see cacheMatches) the main thread checks
// before handing the buffers to the engine to wrap.
export interface PersistedIndex extends FlatIndexData {
  // App-level schema version (createIndex's INDEX_VERSION at serialize time).
  // Bump it whenever the indexing logic changes so a cache written by an older
  // build is discarded rather than read into an incompatible reader.
  version: number
  // Number of documents indexed when serialized — a cheap consistency check
  // against the store this cache accompanies. Toots are append-only, so a count
  // match means the index still covers the same set.
  documentCount: number
}
