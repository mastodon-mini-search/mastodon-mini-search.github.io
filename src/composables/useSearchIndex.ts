import { ref, Ref } from 'vue'
import { SearchResult } from 'minisearch'
import { StatusStore } from '../models/StatusStore'
import sessions from '../functions/sessions'
import { extractDocs, cacheMatches } from '../functions/createIndex'
import type { IndexEngine } from '../functions/indexEngine'
import { createWorkerEngine } from '../functions/indexWorkerEngine'

// Owns the search index for the active account. The index itself lives behind an
// IndexEngine — in production a Web Worker (createWorkerEngine) that holds the
// MiniSearch off the main thread, so neither loadJSON (restoring a ~16MB cache)
// nor search ever blocks the page. This composable only orchestrates it:
// restore-or-build on load, grow on fetch, drop on switch, and mirror which toots
// are indexed. `store` is a ref so `grow` indexes whatever the active store
// currently holds; `load` takes its store explicitly since the caller swaps it in
// around a rebuild.
//
// `engine` is injected (defaulting to the worker) so tests run the index
// in-process instead of spawning a worker happy-dom can't host.
export function useSearchIndex(
  store: Ref<StatusStore | undefined>,
  engine: IndexEngine = createWorkerEngine(),
) {
  // True once the engine holds a usable index for the active account, so the UI
  // shows the search box instead of the "load first" hint or the building one.
  const ready = ref(false)

  // True while (re)loading the index for the active account — a cache restore or
  // a full build — so the UI shows an indexing indicator. Left false during the
  // incremental `grow`, which is fast and shouldn't flicker the indicator.
  const building = ref(false)

  // The uris the engine's index currently holds, mirrored on the main thread so a
  // `grow` strips and ships only the new toots (keeping the heavy stripHTML
  // minimal) rather than re-sending the whole corpus. The engine has-checks
  // defensively, so a stale mirror only costs redundant work, never a wrong index.
  let indexedUris = new Set<string>()

  // Generation guard. Engine calls are async, so an account switch can land
  // mid-load/grow; every load/clear bumps this and each awaited step bails if a
  // newer request (or a clear) superseded it, so a stale result can't publish the
  // wrong account's index.
  let generation = 0

  // Build from the store via the engine and publish — unless superseded while it
  // ran. Caches the result so the next cold start can restore instead of rebuild.
  async function buildFresh(s: StatusStore, mine: number): Promise<void> {
    const persisted = await engine.build(extractDocs(s))
    if (mine !== generation) {
      return
    }
    indexedUris = new Set(Object.keys(s.statuses))
    ready.value = true
    await sessions.saveIndex(s.account, persisted)
  }

  // Restore the cached index if one is stored and still valid; otherwise build
  // from the toots.
  async function load(s: StatusStore): Promise<void> {
    const mine = ++generation
    building.value = true
    ready.value = false
    try {
      const cached = await sessions.loadIndex(s.account)
      if (mine !== generation) {
        return
      }
      if (cached && cacheMatches(s, cached) && await engine.restore(cached.json)) {
        if (mine !== generation) {
          return
        }
        indexedUris = new Set(Object.keys(s.statuses))
        ready.value = true
        return
      }
      if (mine !== generation) {
        return
      }
      await buildFresh(s, mine)
    } finally {
      if (mine === generation) {
        building.value = false
      }
    }
  }

  // A fetch finished: the store was mutated in place and already persisted by
  // fetchStatuses. Grow the index with just the toots it doesn't already hold,
  // then re-cache it — cheap, so it stays inline. If there's no index yet (the
  // first fetch right after setup), build it fresh instead.
  async function grow(): Promise<void> {
    const s = store.value
    if (!s) {
      return
    }
    if (ready.value) {
      const mine = generation
      const docs = extractDocs(s, indexedUris)
      if (docs.length === 0) {
        return
      }
      const persisted = await engine.grow(docs)
      if (mine !== generation) {
        return
      }
      for (const doc of docs) {
        indexedUris.add(doc.uri)
      }
      await sessions.saveIndex(s.account, persisted)
      return
    }
    const mine = ++generation
    building.value = true
    try {
      await buildFresh(s, mine)
    } finally {
      if (mine === generation) {
        building.value = false
      }
    }
  }

  // Drop the index (while a switch rebuilds it, or on logout) so a stale index
  // can't be searched against the new account. Bumps the generation so an
  // in-flight load/grow can't republish what we just cleared.
  function clear(): void {
    generation++
    building.value = false
    ready.value = false
    indexedUris = new Set()
    engine.clear()
  }

  // Run a query against the active account's index (off the main thread in
  // production). Resolves to empty if there's no index yet.
  function search(query: string): Promise<SearchResult[]> {
    return engine.search(query)
  }

  return { ready, building, search, load, grow, clear }
}
