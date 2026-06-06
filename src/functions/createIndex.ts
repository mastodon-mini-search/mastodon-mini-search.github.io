import MiniSearch, { Options } from "minisearch"
import { StatusStore, StatusDocument } from "../models/StatusStore"
import { PersistedIndex } from "../models/PersistedIndex"
import stripHTML from "./stripHTML"
import isCJKWord from "./isCJKWord"
import tokenize from "./tokenize"

// Bump whenever the indexing logic changes in a way that makes an index built by
// an older build unusable by this one: the MiniSearch options below, the
// tokenizer, or which text gets fed into `content` (body / CW / alt text …). A
// persisted cache tagged with a different version is discarded and rebuilt.
// MiniSearch's own serializationVersion only guards library upgrades, not our
// content/tokenization changes — this version covers those.
export const INDEX_VERSION = 1

// The single source of truth for the index shape. Building and restoring MUST
// use the same options — `loadJSON` rebuilds against whatever options it's given,
// and custom functions (tokenize, fuzzy) aren't serialized, so they have to be
// supplied identically here.
const options: Options = {
  fields: ['content'],
  idField: 'uri',
  tokenize,
  searchOptions: {
    combineWith: 'AND',
    fuzzy(term) {
      // CJK tokens are single chars / bigrams; fuzzy there is pure noise.
      return isCJKWord(term) ? false : 0.35
    },
    maxFuzzy: 4
  }
}

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
export function buildIndexFromDocs(docs: IndexDoc[]): MiniSearch {
  const miniSearch = new MiniSearch(options)
  miniSearch.addAll(docs)
  return miniSearch
}

export default function(store: StatusStore): MiniSearch {
  return buildIndexFromDocs(extractDocs(store))
}

// Add to an index any docs it doesn't already hold, skipping ones already
// present (toots are immutable by uri, so a present uri needs no update). Used
// to grow the index with just the new toots after a fetch instead of rebuilding.
// Operates on already-stripped docs, so it runs wherever the index lives (the
// worker in production). Returns how many were added.
export function indexDocs(index: MiniSearch, docs: IndexDoc[]): number {
  let added = 0
  for (const doc of docs) {
    if (!index.has(doc.uri)) {
      index.add(doc)
      added++
    }
  }
  return added
}

// Package a built index for persistence: its serialized form tagged with the
// current version and the document count it covers (the cheap restore check).
export function persistIndex(documentCount: number, index: MiniSearch): PersistedIndex {
  return {
    version: INDEX_VERSION,
    documentCount: documentCount,
    json: JSON.stringify(index)
  }
}

// Package a freshly built index for persistence alongside its store.
export function toPersistedIndex(store: StatusStore, index: MiniSearch): PersistedIndex {
  return persistIndex(Object.keys(store.statuses).length, index)
}

// Reconstruct a searchable index from serialized JSON — the engine's build
// output, or a cache blob. Runs wherever the index lives (the worker in
// production, never the main thread). loadJSON must be given the same options the
// index was built with, since custom functions (tokenize) aren't serialized;
// throws on corrupt / incompatible data, which the engine turns into a rebuild.
export function loadIndexJSON(json: string): MiniSearch {
  return MiniSearch.loadJSON(json, options)
}

// Whether a cached blob is worth decoding for this store: same app version and
// same document count (toots are append-only, so a count match means the cache
// still covers the same set). The cheap gate the main thread runs before handing
// the json to the engine to actually loadJSON — decodability / corruption is the
// engine's call (it loads in the worker and reports back whether it succeeded).
export function cacheMatches(store: StatusStore, persisted: PersistedIndex): boolean {
  return persisted.version === INDEX_VERSION
    && persisted.documentCount === Object.keys(store.statuses).length
}
