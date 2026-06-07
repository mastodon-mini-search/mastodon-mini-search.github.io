import { StatusStore, StatusDocument } from "../models/StatusStore"
import { PersistedIndex, FlatIndexData } from "../models/PersistedIndex"
import stripHTML from "./stripHTML"
import { FlatIndexBuilder, FlatIndexView, loadFlatIndex } from "./flatIndex"

// Bump whenever the indexing logic changes in a way that makes an index built by
// an older build unusable by this one: the tokenizer, the search semantics
// (searchFlat), the serialized format, or which text gets fed into `content`
// (body / CW / alt text …). A persisted cache tagged with a different version is
// discarded and rebuilt.
//
// v2: switched from a serialized MiniSearch blob to the flat ArrayBuffer index
// (reconstruction-free restore). v1 MiniSearch caches fail this gate and rebuild.
export const INDEX_VERSION = 2

// The searchable text for one toot: the body plus the content warning and any
// media alt text, so a toot is findable by its CW or by what's in an image's alt.
function searchableContent(status: StatusDocument): string {
  const parts = [stripHTML(status.content)]
  if (status.spoilerText) {
    parts.push(status.spoilerText)
  }
  for (const m of status.media ?? []) {
    if (m.description) {
      parts.push(m.description)
    }
  }
  return parts.join(' ')
}

// One ready-to-index document: a toot's uri and its already-stripped searchable
// text. The unit that crosses the worker boundary, so it's plain and DOM-free.
export interface IndexDoc {
  uri: string
  content: string
}

// Pull the searchable docs out of a store, optionally skipping uris that are
// already indexed (so a `grow` strips and ships only the new toots). Touches the
// DOM (stripHTML), so this runs on the main thread — the worker is handed the
// stripped docs, not the raw statuses, because a worker has no `document`.
export function extractDocs(store: StatusStore, skip?: Set<string>): IndexDoc[] {
  const docs: IndexDoc[] = []
  for (const [uri, status] of Object.entries(store.statuses)) {
    if (skip?.has(uri)) {
      continue
    }
    docs.push({ uri: uri, content: searchableContent(status) })
  }
  return docs
}

// Build an index from already-extracted docs. DOM-free (the tokenizer only does
// string work), so this is the half that runs in a worker — see indexHolder.ts.
export function buildIndexFromDocs(docs: IndexDoc[]): FlatIndexBuilder {
  const index = new FlatIndexBuilder()
  for (const doc of docs) {
    index.add(doc)
  }
  return index
}

export default function(store: StatusStore): FlatIndexBuilder {
  return buildIndexFromDocs(extractDocs(store))
}

// Add to an index any docs it doesn't already hold, skipping ones already
// present (toots are immutable by uri, so a present uri needs no update). Used
// to grow the index with just the new toots after a fetch instead of rebuilding.
// Operates on already-stripped docs, so it runs wherever the index lives (the
// worker in production). Returns how many were added.
export function indexDocs(index: FlatIndexBuilder, docs: IndexDoc[]): number {
  let added = 0
  for (const doc of docs) {
    if (!index.has(doc.uri)) {
      index.add(doc)
      added++
    }
  }
  return added
}

// Package a built index for persistence: its flat buffer bundle tagged with the
// current version and the document count it covers (the cheap restore check).
export function persistIndex(documentCount: number, index: FlatIndexBuilder): PersistedIndex {
  return {
    version: INDEX_VERSION,
    documentCount: documentCount,
    ...index.serialize(),
  }
}

// Package a freshly built index for persistence alongside its store.
export function toPersistedIndex(store: StatusStore, index: FlatIndexBuilder): PersistedIndex {
  return persistIndex(Object.keys(store.statuses).length, index)
}

// Restore a read-only searchable index from a serialized bundle — a cache blob,
// or the engine's build output. Runs wherever the index lives (the worker in
// production, never the main thread). Throws on an inconsistent / truncated
// bundle, which the engine turns into a rebuild. Cheap: it wraps the buffers in
// typed-array views with no reconstruction (the cold-start win — see flatIndex).
export function loadIndex(data: FlatIndexData): FlatIndexView {
  return loadFlatIndex(data)
}

// Whether a cached blob is worth wrapping for this store: same app version and
// same document count (toots are append-only, so a count match means the cache
// still covers the same set). The cheap gate the main thread runs before handing
// the buffers to the engine — decodability / corruption is the engine's call (it
// wraps in the worker and reports back whether the bundle was consistent).
export function cacheMatches(store: StatusStore, persisted: PersistedIndex): boolean {
  return persisted.version === INDEX_VERSION
    && persisted.documentCount === Object.keys(store.statuses).length
}
