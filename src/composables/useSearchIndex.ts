import { shallowRef, ref, Ref } from 'vue'
import MiniSearch from 'minisearch'
import { StatusStore } from '../models/StatusStore'
import { PersistedIndex } from '../models/PersistedIndex'
import sessions from '../functions/sessions'
import { extractDocs, loadIndexJSON, restoreIndex, indexNewStatuses, toPersistedIndex } from '../functions/createIndex'
import type { IndexDoc } from '../functions/createIndex'
import { buildPersistedIndex } from '../functions/buildIndex'

// Owns the MiniSearch index for the active account: restoring it from cache,
// building it from the toots (off the main thread, in a worker), growing it as
// new toots arrive, and re-caching it so the next cold start can skip the
// rebuild. `store` is passed as a ref so `grow` always indexes whatever the
// active store currently holds; `load` takes its store explicitly since the
// caller swaps it in around the rebuild.
//
// `build` is injected (defaulting to the worker) so tests can build in-process
// instead of spawning a worker happy-dom can't run.
export function useSearchIndex(
  store: Ref<StatusStore | undefined>,
  build: (docs: IndexDoc[]) => Promise<PersistedIndex> = buildPersistedIndex,
) {
  const index = shallowRef<MiniSearch | undefined>(undefined)

  // True while the index is being (re)loaded for the active account — a cache
  // restore or a full worker rebuild — so the UI shows an indexing indicator
  // instead of the "load first" hint. Left false during incremental `grow`,
  // which is fast and shouldn't flicker the indicator.
  const building = ref(false)

  // Generation guard. The worker build is async, so an account switch can land
  // mid-build; every load/grow/clear bumps this, and a build only publishes if
  // it's still the latest request. Without it, a build that finishes after the
  // active account changed would clobber `index` with the wrong account's data.
  let generation = 0

  // Build from the store off the main thread and publish — unless a newer
  // request (or a clear) superseded this one while the worker ran. Caches the
  // result so the next cold start can restore instead of rebuild. Shared by
  // `load`'s cache miss and `grow`'s first build.
  async function buildFresh(s: StatusStore, mine: number): Promise<void> {
    const persisted = await build(extractDocs(s))
    if (mine !== generation) {
      return
    }
    index.value = loadIndexJSON(persisted.json)
    await sessions.saveIndex(s.account, persisted)
  }

  // Restore the cached index if one is stored and still valid; otherwise build
  // from the toots. Publishes into `index`.
  async function load(s: StatusStore): Promise<void> {
    const mine = ++generation
    building.value = true
    try {
      const cached = await sessions.loadIndex(s.account)
      if (mine !== generation) {
        return
      }
      const restored = cached && restoreIndex(s, cached)
      if (restored) {
        index.value = restored
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
  // fetchStatuses. Grow the existing index with just the new toots — cheap, so
  // it stays on the main thread — then re-cache it. If there's no index yet
  // (e.g. the first fetch right after setup), build it fresh in the worker.
  async function grow(): Promise<void> {
    const s = store.value
    if (!s) {
      return
    }
    const idx = index.value
    if (idx) {
      indexNewStatuses(idx, s)
      await sessions.saveIndex(s.account, toPersistedIndex(s, idx))
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
  // in-flight build can't republish the index we just cleared.
  function clear(): void {
    generation++
    building.value = false
    index.value = undefined
  }

  return { index, building, load, grow, clear }
}
