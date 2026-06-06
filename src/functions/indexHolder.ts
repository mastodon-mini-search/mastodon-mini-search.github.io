import MiniSearch, { SearchResult } from 'minisearch'
import { PersistedIndex } from '../models/PersistedIndex'
import { buildIndexFromDocs, indexDocs, loadIndexJSON, persistIndex } from './createIndex'
import type { IndexDoc } from './createIndex'

// Holds one account's MiniSearch index and the operations over it — the stateful
// core shared by both engines (see indexEngine.ts): in production a Web Worker
// runs a holder off the main thread; tests run one in-process. Everything here is
// synchronous and DOM-free (docs arrive already HTML-stripped), so the same code
// runs on either side of the worker boundary.
export class IndexHolder {
  private index: MiniSearch | undefined

  // Load a cached serialized index. Returns false (and stays empty) if the blob
  // is corrupt / from an incompatible MiniSearch, so the caller rebuilds. The
  // caller has already checked the version and document count (see cacheMatches).
  restore(json: string): boolean {
    try {
      this.index = loadIndexJSON(json)
      return true
    } catch {
      this.index = undefined
      return false
    }
  }

  // Build a fresh index from already-stripped docs, keep it as the live index,
  // and return its serialized form for caching.
  build(docs: IndexDoc[]): PersistedIndex {
    this.index = buildIndexFromDocs(docs)
    return persistIndex(this.index.documentCount, this.index)
  }

  // Grow the live index with docs it doesn't already hold (building it first if
  // there's none yet), and return the updated serialized form for caching.
  grow(docs: IndexDoc[]): PersistedIndex {
    if (this.index) {
      indexDocs(this.index, docs)
    } else {
      this.index = buildIndexFromDocs(docs)
    }
    return persistIndex(this.index.documentCount, this.index)
  }

  // Run a query, or no results if there's no index yet.
  search(query: string): SearchResult[] {
    return this.index ? this.index.search(query) : []
  }

  // Drop the index (account switch / logout).
  clear(): void {
    this.index = undefined
  }
}
