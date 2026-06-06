import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shallowRef, nextTick, type Ref } from 'vue'
import MiniSearch from 'minisearch'
import { useSearch } from '../../src/composables/useSearch'
import createIndex from '../../src/functions/createIndex'
import { StatusStore, StatusDocument, StatusType } from '../../src/models/StatusStore'
import { withSetup, unmountAll } from './withSetup'

function makeStore(docs: Record<string, { content: string; types: StatusType[] }>): StatusStore {
  const statuses: Record<string, StatusDocument> = {}
  for (const [uri, d] of Object.entries(docs)) {
    statuses[uri] = { content: d.content, createdAt: '', types: d.types, acct: 'tester', id: uri }
  }
  return {
    account: { instanceUrl: 'https://a.social', acct: 'tester', accountId: '1' },
    position: { statusMinId: '0', favouriteMinId: '0', bookmarkMinId: '0' },
    statuses,
  }
}

const ids = (rs: { id: string | number }[]) => rs.map(r => String(r.id)).sort()

describe('useSearch', () => {
  let store: StatusStore
  let indexRef: Ref<MiniSearch | undefined>
  let storeRef: Ref<StatusStore | undefined>

  beforeEach(() => {
    // Fake timers keep the debounce deterministic across every test: scheduled
    // runs only fire when a test advances them, and afterEach's unmount clears
    // any that are still pending.
    vi.useFakeTimers()
    store = makeStore({
      a: { content: '<p>alpha apple</p>', types: ['post'] },
      b: { content: '<p>alpha banana</p>', types: ['favourite'] },
    })
    indexRef = shallowRef<MiniSearch | undefined>(createIndex(store))
    storeRef = shallowRef<StatusStore | undefined>(store)
  })

  afterEach(() => {
    unmountAll()
    vi.useRealTimers()
  })

  it('runNow searches the index immediately and publishes query/results/searched together', () => {
    const [{ text, query, results, searched, runNow }] = withSetup(() => useSearch(indexRef, storeRef))

    text.value = 'alpha'
    runNow()

    expect(query.value).toBe('alpha')
    expect(ids(results.value)).toEqual(['a', 'b'])
    expect(searched.value).toBe(true)
  })

  it('treats a blank query as no search, clearing results and the searched flag', () => {
    const [{ text, query, results, searched, runNow }] = withSetup(() => useSearch(indexRef, storeRef))

    text.value = '   '
    runNow()

    expect(query.value).toBe('')
    expect(results.value).toEqual([])
    expect(searched.value).toBe(false)
  })

  it('debounces typing: a run only fires after the 250ms window', async () => {
    const [{ text, results }] = withSetup(() => useSearch(indexRef, storeRef))

    text.value = 'alpha'
    await nextTick() // let the watcher schedule the debounced run

    vi.advanceTimersByTime(249)
    expect(results.value).toEqual([]) // not yet

    vi.advanceTimersByTime(1)
    expect(ids(results.value)).toEqual(['a', 'b'])
  })

  it('filters results by the active type toggles', () => {
    const [{ text, results, filtered, filter, runNow }] = withSetup(() => useSearch(indexRef, storeRef))

    text.value = 'alpha'
    runNow()
    expect(ids(results.value)).toEqual(['a', 'b'])

    // Default toggles: posts on, favourites off — so the favourite drops out.
    expect(ids(filtered.value)).toEqual(['a'])

    filter.favourite = true
    expect(ids(filtered.value)).toEqual(['a', 'b'])
  })

  it('yields no filtered results when there is no active store', () => {
    const [{ text, results, filtered, runNow }] =
      withSetup(() => useSearch(indexRef, shallowRef<StatusStore | undefined>(undefined)))

    text.value = 'alpha'
    runNow()

    expect(results.value.length).toBeGreaterThan(0)
    expect(filtered.value).toEqual([])
  })

  it('reset clears the search state', () => {
    const [{ text, query, results, searched, reset, runNow }] = withSetup(() => useSearch(indexRef, storeRef))

    text.value = 'alpha'
    runNow()
    expect(results.value.length).toBeGreaterThan(0)

    reset()
    expect(text.value).toBe('')
    expect(query.value).toBe('')
    expect(results.value).toEqual([])
    expect(searched.value).toBe(false)
  })

  it('reset cancels a pending debounced run so a stale query cannot repopulate results', async () => {
    const [{ text, results, reset }] = withSetup(() => useSearch(indexRef, storeRef))
    const search = vi.spyOn(indexRef.value!, 'search')

    text.value = 'alpha'
    await nextTick() // a run is now scheduled
    reset()

    vi.advanceTimersByTime(500)
    expect(search).not.toHaveBeenCalled()
    expect(results.value).toEqual([])
  })

  it('cancels the pending debounce on unmount', async () => {
    const [{ text }, unmount] = withSetup(() => useSearch(indexRef, storeRef))
    const search = vi.spyOn(indexRef.value!, 'search')

    text.value = 'alpha'
    await nextTick() // schedule the run
    unmount()

    vi.advanceTimersByTime(500)
    expect(search).not.toHaveBeenCalled()
  })
})
