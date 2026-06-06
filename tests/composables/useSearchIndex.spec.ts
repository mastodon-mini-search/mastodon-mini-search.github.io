import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shallowRef } from 'vue'
import { useSearchIndex } from '../../src/composables/useSearchIndex'
import sessions from '../../src/functions/sessions'
import createIndex, { toPersistedIndex, INDEX_VERSION } from '../../src/functions/createIndex'
import { StatusStore, StatusDocument } from '../../src/models/StatusStore'
import { PersistedIndex } from '../../src/models/PersistedIndex'

function storeWith(contents: Record<string, string>): StatusStore {
  const statuses: Record<string, StatusDocument> = {}
  for (const [uri, content] of Object.entries(contents)) {
    statuses[uri] = { content, createdAt: '', types: ['post'], acct: 'tester', id: uri }
  }
  return {
    account: { instanceUrl: 'https://a.social', acct: 'tester', accountId: '1' },
    position: { statusMinId: '0', favouriteMinId: '0', bookmarkMinId: '0' },
    statuses,
  }
}

const found = (i: { search: (q: string) => { id: string | number }[] }, q: string) =>
  i.search(q).map(r => String(r.id))

// The cache layer is stubbed (no IndexedDB); the real index build/restore/grow
// functions run for real, since that's what the composable orchestrates.
describe('useSearchIndex', () => {
  let loadIndex: ReturnType<typeof vi.spyOn>
  let saveIndex: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    loadIndex = vi.spyOn(sessions, 'loadIndex').mockResolvedValue(undefined)
    saveIndex = vi.spyOn(sessions, 'saveIndex').mockResolvedValue(undefined)
  })

  afterEach(() => vi.restoreAllMocks())

  it('load builds the index from the store and caches it when nothing is cached', async () => {
    const store = storeWith({ a: '<p>alpha</p>', b: '<p>beta</p>' })
    const { index, load } = useSearchIndex(shallowRef<StatusStore | undefined>(store))

    await load(store)

    expect(loadIndex).toHaveBeenCalledWith(store.account)
    expect(index.value).toBeDefined()
    expect(found(index.value!, 'alpha')).toEqual(['a'])
    // Cached, keyed by the account, so the next cold start can skip the rebuild.
    expect(saveIndex).toHaveBeenCalledTimes(1)
    const [account, persisted] = saveIndex.mock.calls[0] as [unknown, PersistedIndex]
    expect(account).toBe(store.account)
    expect(persisted.version).toBe(INDEX_VERSION)
    expect(persisted.documentCount).toBe(2)
  })

  it('load restores a valid cached index without rebuilding or re-caching', async () => {
    const store = storeWith({ a: '<p>alpha</p>' })
    loadIndex.mockResolvedValue(toPersistedIndex(store, createIndex(store)))
    const { index, load } = useSearchIndex(shallowRef<StatusStore | undefined>(store))

    await load(store)

    expect(index.value).toBeDefined()
    expect(found(index.value!, 'alpha')).toEqual(['a'])
    expect(saveIndex).not.toHaveBeenCalled()
  })

  it('load discards a cache from a different index version and rebuilds', async () => {
    const store = storeWith({ a: '<p>alpha</p>' })
    const stale = toPersistedIndex(store, createIndex(store))
    stale.version = INDEX_VERSION + 1
    loadIndex.mockResolvedValue(stale)
    const { index, load } = useSearchIndex(shallowRef<StatusStore | undefined>(store))

    await load(store)

    expect(found(index.value!, 'alpha')).toEqual(['a'])
    expect(saveIndex).toHaveBeenCalledTimes(1) // rebuilt and re-cached
  })

  it('grow builds the index when there is none yet and caches it', () => {
    const store = storeWith({ a: '<p>alpha</p>' })
    const { index, grow } = useSearchIndex(shallowRef<StatusStore | undefined>(store))

    grow()

    expect(found(index.value!, 'alpha')).toEqual(['a'])
    expect(saveIndex).toHaveBeenCalledTimes(1)
  })

  it('grow extends the existing index with newly fetched toots in place, then re-caches', () => {
    const store = storeWith({ a: '<p>alpha</p>' })
    const { index, grow } = useSearchIndex(shallowRef<StatusStore | undefined>(store))

    grow() // initial build
    const built = index.value
    store.statuses['b'] = { content: '<p>beta</p>', createdAt: '', types: ['post'], acct: 'tester', id: 'b' }
    grow() // grows the same instance rather than rebuilding

    expect(index.value).toBe(built)
    expect(found(index.value!, 'beta')).toEqual(['b'])
    expect(found(index.value!, 'alpha')).toEqual(['a'])
    expect(saveIndex).toHaveBeenCalledTimes(2)
  })

  it('grow is a no-op when there is no active store', () => {
    const { index, grow } = useSearchIndex(shallowRef<StatusStore | undefined>(undefined))

    grow()

    expect(index.value).toBeUndefined()
    expect(saveIndex).not.toHaveBeenCalled()
  })

  it('clear drops the index so a stale one cannot be searched against a new account', () => {
    const store = storeWith({ a: '<p>alpha</p>' })
    const { index, grow, clear } = useSearchIndex(shallowRef<StatusStore | undefined>(store))

    grow()
    expect(index.value).toBeDefined()

    clear()
    expect(index.value).toBeUndefined()
  })
})
