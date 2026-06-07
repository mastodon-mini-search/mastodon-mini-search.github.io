import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shallowRef } from 'vue'
import type { SearchHit } from '../../src/models/SearchHit'
import { useSearchIndex } from '../../src/composables/useSearchIndex'
import { createInProcessEngine } from '../../src/functions/indexEngine'
import sessions from '../../src/functions/sessions'
import createIndex, { toPersistedIndex, INDEX_VERSION } from '../../src/functions/createIndex'
import { StatusStore, StatusDocument } from '../../src/models/StatusStore'
import { PersistedIndex } from '../../src/models/PersistedIndex'

// In production the index lives in a Web Worker; happy-dom can't run one, so we
// inject the in-process engine. It goes through the real build / serialize /
// restore path, so the composable exercises the same orchestration the worker
// path does — just synchronously on this thread.

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

const found = async (search: (q: string) => Promise<SearchHit[]>, q: string) =>
  (await search(q)).map(r => String(r.id))

// The cache layer is stubbed (no IndexedDB); the real engine build/restore/grow
// runs for real, since that's what the composable orchestrates.
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
    const { ready, search, load } = useSearchIndex(shallowRef<StatusStore | undefined>(store), createInProcessEngine())

    await load(store)

    expect(loadIndex).toHaveBeenCalledWith(store.account)
    expect(ready.value).toBe(true)
    expect(await found(search, 'alpha')).toEqual(['a'])
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
    const { ready, search, load } = useSearchIndex(shallowRef<StatusStore | undefined>(store), createInProcessEngine())

    await load(store)

    expect(ready.value).toBe(true)
    expect(await found(search, 'alpha')).toEqual(['a'])
    expect(saveIndex).not.toHaveBeenCalled()
  })

  it('load discards a cache from a different index version and rebuilds', async () => {
    const store = storeWith({ a: '<p>alpha</p>' })
    const stale = toPersistedIndex(store, createIndex(store))
    stale.version = INDEX_VERSION + 1
    loadIndex.mockResolvedValue(stale)
    const { search, load } = useSearchIndex(shallowRef<StatusStore | undefined>(store), createInProcessEngine())

    await load(store)

    expect(await found(search, 'alpha')).toEqual(['a'])
    expect(saveIndex).toHaveBeenCalledTimes(1) // rebuilt and re-cached
  })

  it('load rebuilds when the cached blob is corrupt instead of failing', async () => {
    const store = storeWith({ a: '<p>alpha</p>' })
    // Passes the version/count gate, but a truncated buffer fails to wrap.
    const corrupt = { ...toPersistedIndex(store, createIndex(store)), postingDocs: new ArrayBuffer(0) }
    loadIndex.mockResolvedValue(corrupt)
    const { ready, search, load } = useSearchIndex(shallowRef<StatusStore | undefined>(store), createInProcessEngine())

    await load(store)

    expect(ready.value).toBe(true)
    expect(await found(search, 'alpha')).toEqual(['a'])
    expect(saveIndex).toHaveBeenCalledTimes(1)
  })

  it('grow builds the index when there is none yet and caches it', async () => {
    const store = storeWith({ a: '<p>alpha</p>' })
    const { ready, search, grow } = useSearchIndex(shallowRef<StatusStore | undefined>(store), createInProcessEngine())

    await grow()

    expect(ready.value).toBe(true)
    expect(await found(search, 'alpha')).toEqual(['a'])
    expect(saveIndex).toHaveBeenCalledTimes(1)
  })

  it('grow extends the existing index with only the newly fetched toots, then re-caches', async () => {
    const store = storeWith({ a: '<p>alpha</p>' })
    const engine = createInProcessEngine()
    const build = vi.spyOn(engine, 'build')
    const growEngine = vi.spyOn(engine, 'grow')
    const { search, grow } = useSearchIndex(shallowRef<StatusStore | undefined>(store), engine)

    await grow() // initial build
    store.statuses['b'] = { content: '<p>beta</p>', createdAt: '', types: ['post'], acct: 'tester', id: 'b' }
    await grow() // grows with just the new toot rather than rebuilding

    expect(build).toHaveBeenCalledTimes(1)
    expect(growEngine).toHaveBeenCalledTimes(1)
    // Only the new toot is stripped and shipped to the engine.
    expect(growEngine.mock.calls[0][0].map(d => d.uri)).toEqual(['b'])
    expect(await found(search, 'beta')).toEqual(['b'])
    expect(await found(search, 'alpha')).toEqual(['a'])
    expect(saveIndex).toHaveBeenCalledTimes(2)
  })

  it('grow is a no-op when there is no active store', async () => {
    const { ready, grow } = useSearchIndex(shallowRef<StatusStore | undefined>(undefined), createInProcessEngine())

    await grow()

    expect(ready.value).toBe(false)
    expect(saveIndex).not.toHaveBeenCalled()
  })

  it('clear drops the index so a stale one cannot be searched against a new account', async () => {
    const store = storeWith({ a: '<p>alpha</p>' })
    const { ready, search, grow, clear } = useSearchIndex(shallowRef<StatusStore | undefined>(store), createInProcessEngine())

    await grow()
    expect(ready.value).toBe(true)

    clear()
    expect(ready.value).toBe(false)
    expect(await found(search, 'alpha')).toEqual([]) // the engine dropped its index
  })
})
