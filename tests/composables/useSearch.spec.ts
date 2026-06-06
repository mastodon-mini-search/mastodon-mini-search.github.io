import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { ref, shallowRef, nextTick, type Ref } from 'vue'
import type { SearchResult } from 'minisearch'
import { useSearch } from '../../src/composables/useSearch'
import createIndex from '../../src/functions/createIndex'
import { StatusStore, StatusDocument, StatusType } from '../../src/models/StatusStore'
import { withSetup, unmountAll } from './withSetup'

function makeStore(
  docs: Record<string, { content: string; types: StatusType[]; createdAt?: string }>,
): StatusStore {
  const statuses: Record<string, StatusDocument> = {}
  for (const [uri, d] of Object.entries(docs)) {
    statuses[uri] = { content: d.content, createdAt: d.createdAt ?? '', types: d.types, acct: 'tester', id: uri }
  }
  return {
    account: { instanceUrl: 'https://a.social', acct: 'tester', accountId: '1' },
    position: { statusMinId: '0', favouriteMinId: '0', bookmarkMinId: '0' },
    statuses,
  }
}

const ids = (rs: { id: string | number }[]) => rs.map(r => String(r.id)).sort()
// Order-preserving variant, for asserting how the result list is sorted.
const order = (rs: { id: string | number }[]) => rs.map(r => String(r.id))

describe('useSearch', () => {
  let store: StatusStore
  let storeRef: Ref<StatusStore | undefined>
  let ready: Ref<boolean>
  // Search delegates to a real index but resolves asynchronously, mirroring the
  // worker-backed engine in production. Spying on it lets tests assert it was
  // (or wasn't) invoked.
  let search: Mock<(query: string) => Promise<SearchResult[]>>

  beforeEach(() => {
    // Fake timers keep the debounce deterministic across every test: scheduled
    // runs only fire when a test advances them, and afterEach's unmount clears
    // any that are still pending.
    vi.useFakeTimers()
    store = makeStore({
      a: { content: '<p>alpha apple</p>', types: ['post'] },
      b: { content: '<p>alpha banana</p>', types: ['favourite'] },
    })
    const index = createIndex(store)
    search = vi.fn((q: string) => Promise.resolve(index.search(q)))
    storeRef = shallowRef<StatusStore | undefined>(store)
    ready = ref(true)
  })

  afterEach(() => {
    unmountAll()
    vi.useRealTimers()
  })

  it('runNow searches the index immediately and publishes query/results/searched together', async () => {
    const [{ text, query, results, searched, runNow }] = withSetup(() => useSearch(search, ready, storeRef))

    text.value = 'alpha'
    await runNow()

    expect(query.value).toBe('alpha')
    expect(ids(results.value)).toEqual(['a', 'b'])
    expect(searched.value).toBe(true)
  })

  it('treats a blank query as no search, clearing results and the searched flag', async () => {
    const [{ text, query, results, searched, runNow }] = withSetup(() => useSearch(search, ready, storeRef))

    text.value = '   '
    await runNow()

    expect(query.value).toBe('')
    expect(results.value).toEqual([])
    expect(searched.value).toBe(false)
    expect(search).not.toHaveBeenCalled()
  })

  it('debounces typing: a run only fires after the 250ms window', async () => {
    const [{ text, results }] = withSetup(() => useSearch(search, ready, storeRef))

    text.value = 'alpha'
    await nextTick() // let the watcher schedule the debounced run

    await vi.advanceTimersByTimeAsync(249)
    expect(results.value).toEqual([]) // not yet

    await vi.advanceTimersByTimeAsync(1)
    expect(ids(results.value)).toEqual(['a', 'b'])
  })

  it('filters results by the active type toggles', async () => {
    const [{ text, results, filtered, filter, runNow }] = withSetup(() => useSearch(search, ready, storeRef))

    text.value = 'alpha'
    await runNow()
    expect(ids(results.value)).toEqual(['a', 'b'])

    // Default toggles: posts on, favourites off — so the favourite drops out.
    expect(ids(filtered.value)).toEqual(['a'])

    filter.favourite = true
    expect(ids(filtered.value)).toEqual(['a', 'b'])
  })

  it('yields no filtered results when there is no active store', async () => {
    const [{ text, results, filtered, runNow }] =
      withSetup(() => useSearch(search, ready, shallowRef<StatusStore | undefined>(undefined)))

    text.value = 'alpha'
    await runNow()

    expect(results.value.length).toBeGreaterThan(0)
    expect(filtered.value).toEqual([])
  })

  it('does not search while the index is not ready yet', async () => {
    ready.value = false
    const [{ text, results, searched, runNow }] = withSetup(() => useSearch(search, ready, storeRef))

    text.value = 'alpha'
    await runNow()

    expect(search).not.toHaveBeenCalled()
    expect(results.value).toEqual([])
    expect(searched.value).toBe(true) // a query was entered, it just found nothing
  })

  it('reset clears the search state', async () => {
    const [{ text, query, results, searched, reset, runNow }] = withSetup(() => useSearch(search, ready, storeRef))

    text.value = 'alpha'
    await runNow()
    expect(results.value.length).toBeGreaterThan(0)

    reset()
    expect(text.value).toBe('')
    expect(query.value).toBe('')
    expect(results.value).toEqual([])
    expect(searched.value).toBe(false)
  })

  it('reset cancels a pending debounced run so a stale query cannot repopulate results', async () => {
    const [{ text, results, reset }] = withSetup(() => useSearch(search, ready, storeRef))

    text.value = 'alpha'
    await nextTick() // a run is now scheduled
    reset()

    await vi.advanceTimersByTimeAsync(500)
    expect(search).not.toHaveBeenCalled()
    expect(results.value).toEqual([])
  })

  it('drops an in-flight run whose result lands after reset (stale corpus guard)', async () => {
    // A search that resolves only when we say so, so reset() can land between the
    // call and its resolution — exactly the account-switch race.
    let resolveSearch!: (rs: SearchResult[]) => void
    const deferred = vi.fn((_q: string) => new Promise<SearchResult[]>(res => { resolveSearch = res }))
    const [{ text, results, searched, runNow, reset }] = withSetup(() => useSearch(deferred, ready, storeRef))

    text.value = 'alpha'
    const pending = runNow() // search called, now awaiting
    reset()                  // supersedes the in-flight run
    resolveSearch([{ id: 'a' } as unknown as SearchResult])
    await pending

    expect(results.value).toEqual([]) // stale result dropped, not published
    expect(searched.value).toBe(false)
  })

  it('cancels the pending debounce on unmount', async () => {
    const [{ text }, unmount] = withSetup(() => useSearch(search, ready, storeRef))

    text.value = 'alpha'
    await nextTick() // schedule the run
    unmount()

    await vi.advanceTimersByTimeAsync(500)
    expect(search).not.toHaveBeenCalled()
  })

  describe('sort order', () => {
    // Three equally-matching posts at distinct times, so only the sort decides
    // their order. All 'post' so the default type toggles keep every one.
    function timedSearch() {
      const s = makeStore({
        a: { content: '<p>alpha</p>', types: ['post'], createdAt: '2024-01-01T00:00:00.000Z' },
        b: { content: '<p>alpha</p>', types: ['post'], createdAt: '2024-03-01T00:00:00.000Z' },
        c: { content: '<p>alpha</p>', types: ['post'], createdAt: '2024-02-01T00:00:00.000Z' },
      })
      const index = createIndex(s)
      const localSearch = vi.fn((q: string) => Promise.resolve(index.search(q)))
      return { storeRef: shallowRef<StatusStore | undefined>(s), localSearch }
    }

    it('defaults to relevance, keeping MiniSearch\'s own order', async () => {
      const { storeRef: sRef, localSearch } = timedSearch()
      const [{ text, results, filtered, sort, runNow }] =
        withSetup(() => useSearch(localSearch, ready, sRef))

      text.value = 'alpha'
      await runNow()

      expect(sort.value).toBe('relevance')
      // Filtering preserves the score order search() returned — no reordering.
      expect(order(filtered.value)).toEqual(order(results.value))
    })

    it('orders by createdAt, newest first', async () => {
      const { storeRef: sRef, localSearch } = timedSearch()
      const [{ text, filtered, sort, runNow }] =
        withSetup(() => useSearch(localSearch, ready, sRef))

      text.value = 'alpha'
      await runNow()
      sort.value = 'newest'

      expect(order(filtered.value)).toEqual(['b', 'c', 'a'])
    })

    it('orders by createdAt, oldest first', async () => {
      const { storeRef: sRef, localSearch } = timedSearch()
      const [{ text, filtered, sort, runNow }] =
        withSetup(() => useSearch(localSearch, ready, sRef))

      text.value = 'alpha'
      await runNow()
      sort.value = 'oldest'

      expect(order(filtered.value)).toEqual(['a', 'c', 'b'])
    })
  })
})
