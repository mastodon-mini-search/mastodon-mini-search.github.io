import type { SearchResult } from 'minisearch'
import type { PersistedIndex } from '../models/PersistedIndex'
import type { IndexDoc } from './createIndex'
import { IndexHolder } from './indexHolder'

// The search index lives behind this interface. In production it's a Web Worker
// (createWorkerEngine) so loadJSON — restoring a cached index — and search, the
// CPU-bound steps for a large CJK corpus, never block the page; the main thread
// holds only this handle and talks to the index by message. Tests inject the
// in-process engine below, since happy-dom can't spawn a worker.
export interface IndexEngine {
  // Load a cached serialized index. true if it loaded, false if it was corrupt
  // (caller rebuilds). The caller has already gated on version + document count.
  restore(json: string): Promise<boolean>
  // Build from already-stripped docs, keep it live, and return the cache blob.
  build(docs: IndexDoc[]): Promise<PersistedIndex>
  // Add docs the live index doesn't hold, and return the updated cache blob.
  grow(docs: IndexDoc[]): Promise<PersistedIndex>
  // Query the live index (empty if there's none yet).
  search(query: string): Promise<SearchResult[]>
  // Drop the live index so it can't be searched against a new account.
  clear(): void
}

// An engine that runs the index on the calling thread. Used by tests; in
// production the worker engine runs the same IndexHolder off-thread.
export function createInProcessEngine(): IndexEngine {
  const holder = new IndexHolder()
  return {
    restore: (json) => Promise.resolve(holder.restore(json)),
    build: (docs) => Promise.resolve(holder.build(docs)),
    grow: (docs) => Promise.resolve(holder.grow(docs)),
    search: (query) => Promise.resolve(holder.search(query)),
    clear: () => holder.clear(),
  }
}
