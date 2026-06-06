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

export default function(store: StatusStore) {
  const miniSearch = new MiniSearch(options)
  Object.entries(store.statuses).forEach(([uri, status]) => {
    miniSearch.add({
      uri: uri,
      content: searchableContent(status)
    })
  })
  return miniSearch
}

// Grow an existing index with any toots it doesn't already hold, skipping ones
// already indexed (toots are immutable by uri, so a present uri needs no update).
// Used after a fetch to add just the new toots instead of rebuilding the whole
// index. Returns how many were added.
export function indexNewStatuses(index: MiniSearch, store: StatusStore): number {
  let added = 0
  for (const [uri, status] of Object.entries(store.statuses)) {
    if (!index.has(uri)) {
      index.add({ uri: uri, content: searchableContent(status) })
      added++
    }
  }
  return added
}

// Package a freshly built index for persistence alongside its store.
export function toPersistedIndex(store: StatusStore, index: MiniSearch): PersistedIndex {
  return {
    version: INDEX_VERSION,
    documentCount: Object.keys(store.statuses).length,
    json: JSON.stringify(index)
  }
}

// Restore a cached index, or `undefined` if the cache can't be trusted for this
// store: wrong app version, the store has grown/shrunk since (count mismatch), or
// the serialized data is corrupt / from an incompatible MiniSearch. In every
// rejection the caller should rebuild from the store.
export function restoreIndex(store: StatusStore, persisted: PersistedIndex): MiniSearch | undefined {
  if (persisted.version !== INDEX_VERSION) {
    return undefined
  }
  if (persisted.documentCount !== Object.keys(store.statuses).length) {
    return undefined
  }
  try {
    return MiniSearch.loadJSON(persisted.json, options)
  } catch {
    return undefined
  }
}
