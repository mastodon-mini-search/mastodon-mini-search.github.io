import { shallowRef, Ref } from 'vue'
import MiniSearch from 'minisearch'
import { StatusStore } from '../models/StatusStore'
import sessions from '../functions/sessions'
import createIndex, { toPersistedIndex, restoreIndex, indexNewStatuses } from '../functions/createIndex'

// Owns the MiniSearch index for the active account: restoring it from cache,
// building it from the toots, growing it as new toots arrive, and re-caching it
// so the next cold start can skip the rebuild. `store` is passed as a ref so
// `grow` always indexes whatever the active store currently holds; `load` takes
// its store explicitly since the caller swaps it in around the rebuild.
export function useSearchIndex(store: Ref<StatusStore | undefined>) {
  const index = shallowRef<MiniSearch | undefined>(undefined)

  // Restore the cached index if one is stored and still valid; otherwise build
  // from the toots and cache the result for next time. Publishes into `index`.
  async function load(s: StatusStore): Promise<void> {
    const cached = await sessions.loadIndex(s.account)
    const restored = cached && restoreIndex(s, cached)
    if (restored) {
      index.value = restored
      return
    }
    const built = createIndex(s)
    await sessions.saveIndex(s.account, toPersistedIndex(s, built))
    index.value = built
  }

  // A fetch finished: the store was mutated in place and already persisted by
  // fetchStatuses. Grow the existing index with just the new toots — or build it
  // fresh if there's none yet (e.g. right after setup) — then re-cache it so the
  // next cold start can skip the rebuild.
  function grow(): void {
    const s = store.value
    if (!s) {
      return
    }
    let idx = index.value
    if (idx) {
      indexNewStatuses(idx, s)
    } else {
      idx = createIndex(s)
      index.value = idx
    }
    sessions.saveIndex(s.account, toPersistedIndex(s, idx))
  }

  // Drop the index (while a switch rebuilds it, or on logout) so a stale index
  // can't be searched against the new account.
  function clear(): void {
    index.value = undefined
  }

  return { index, load, grow, clear }
}
