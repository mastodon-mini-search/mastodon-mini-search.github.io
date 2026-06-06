// A serialized MiniSearch index, cached per account so the index can be restored
// on load instead of rebuilt from scratch. `json` is MiniSearch's `toJSON`
// output stringified; `MiniSearch.loadJSON` reconstructs it (see createIndex.ts).
export interface PersistedIndex {
  // App-level schema version (createIndex's INDEX_VERSION at serialize time).
  // Bump it whenever the indexing logic changes so a cache written by an older
  // build is discarded rather than loaded into an incompatible reader.
  version: number
  // Number of documents indexed when serialized — a cheap consistency check
  // against the store this cache accompanies. Toots are append-only, so a count
  // match means the index still covers the same set.
  documentCount: number
  // MiniSearch's serialized form, as a JSON string ready for `loadJSON`.
  json: string
}
