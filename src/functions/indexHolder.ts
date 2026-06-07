import { SearchHit } from '../models/SearchHit'
import { PersistedIndex } from '../models/PersistedIndex'
import { buildIndexFromDocs, indexDocs, loadIndex, persistIndex } from './createIndex'
import type { IndexDoc } from './createIndex'
import { FlatIndexBuilder, FlatIndexView } from './flatIndex'
import { IndexView, searchFlat } from './searchFlat'

// Holds one account's flat index and the operations over it — the stateful core
// shared by both engines (see indexEngine.ts): in production a Web Worker runs a
// holder off the main thread; tests run one in-process. Everything here is
// synchronous and DOM-free (docs arrive already HTML-stripped), so the same code
// runs on either side of the worker boundary.
//
// Two internal shapes: a mutable `builder` (build/grow) and a read-only
// `restored` view (cache restore, wrapped without reconstruction). Whichever is
// present is the live index; a restore replaces a builder and vice versa.
export class IndexHolder {
  private builder: FlatIndexBuilder | undefined
  private restored: FlatIndexView | undefined

  private active(): IndexView | undefined {
    return this.builder ?? this.restored
  }

  // Load a cached serialized index by wrapping its buffers — no reconstruction,
  // so this is the cheap cold-start path. Returns false (and stays empty) if the
  // bundle is inconsistent / truncated, so the caller rebuilds. The caller has
  // already checked the version and document count (see cacheMatches).
  restore(data: PersistedIndex): boolean {
    try {
      this.restored = loadIndex(data)
      this.builder = undefined
      return true
    } catch {
      this.restored = undefined
      this.builder = undefined
      return false
    }
  }

  // Build a fresh index from already-stripped docs, keep it as the live index,
  // and return its serialized form for caching.
  build(docs: IndexDoc[]): PersistedIndex {
    this.builder = buildIndexFromDocs(docs)
    this.restored = undefined
    return persistIndex(this.builder.documentCount, this.builder)
  }

  // Grow the live index with docs it doesn't already hold (building it first if
  // there's none yet), and return the updated serialized form for caching. If
  // the live index is a restored read-only view (a fetch arrived after a cache
  // hit), it's rebuilt into a mutable builder once — off the cold-start path.
  grow(docs: IndexDoc[]): PersistedIndex {
    if (!this.builder) {
      this.builder = this.restored
        ? FlatIndexBuilder.fromData(this.restored.data)
        : new FlatIndexBuilder()
      this.restored = undefined
    }
    indexDocs(this.builder, docs)
    return persistIndex(this.builder.documentCount, this.builder)
  }

  // Run a query, or no results if there's no index yet.
  search(query: string): SearchHit[] {
    const index = this.active()
    return index ? searchFlat(index, query) : []
  }

  // Drop the index (account switch / logout).
  clear(): void {
    this.builder = undefined
    this.restored = undefined
  }
}
