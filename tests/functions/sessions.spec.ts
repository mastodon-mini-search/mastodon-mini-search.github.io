import { describe, it, expect, beforeEach } from 'vitest'
import { SessionRepository, KeyValueStore, storeKey, indexKey } from '../../src/functions/sessions'
import { ResolvedAccountSetting } from '../../src/models/AccountSetting'
import { SessionRegistry } from '../../src/models/Session'
import { StatusStore } from '../../src/models/StatusStore'
import { PersistedIndex } from '../../src/models/PersistedIndex'

// In-memory KeyValueStore so the session logic runs without IndexedDB.
function memoryKv(): KeyValueStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>()
  return {
    map,
    async getItem<T>(key: string) {
      return (map.has(key) ? (map.get(key) as T) : null)
    },
    async setItem<T>(key: string, value: T) {
      map.set(key, value)
      return value
    },
    async removeItem(key: string) {
      map.delete(key)
    }
  }
}

// Resolve acct → account deterministically, no network.
const accounts: Record<string, ResolvedAccountSetting> = {
  'alice@a.social': { instanceUrl: 'https://a.social', acct: 'alice@a.social', accountId: '1' },
  'bob@b.social': { instanceUrl: 'https://b.social', acct: 'bob@b.social', accountId: '2' },
  // Same accountId as alice, different instance — must not collide.
  'carol@b.social': { instanceUrl: 'https://b.social', acct: 'carol@b.social', accountId: '1' }
}
async function fakeResolve(acct: string): Promise<ResolvedAccountSetting> {
  const account = accounts[acct]
  if (!account) throw new Error(`unknown acct ${acct}`)
  return account
}

describe('SessionRepository', () => {
  let kv: ReturnType<typeof memoryKv>
  let repo: SessionRepository

  beforeEach(() => {
    kv = memoryKv()
    repo = new SessionRepository(kv, fakeResolve)
  })

  it('starts empty', async () => {
    expect(await repo.loadActiveStore()).toBeUndefined()
    expect(await repo.listSessions()).toEqual([])
    expect(await repo.getActiveKey()).toBeNull()
  })

  it('addSession registers, activates, and persists an empty store', async () => {
    const store = await repo.addSession('alice@a.social')
    expect(store.statuses).toEqual({})

    expect(await repo.listSessions()).toEqual([accounts['alice@a.social']])
    expect(await repo.getActiveKey()).toBe('store:https://a.social:1')
    const active = await repo.loadActiveStore()
    expect(active?.account.acct).toBe('alice@a.social')
  })

  it('keys by instance + accountId so same id on different instances does not collide', async () => {
    await repo.addSession('alice@a.social') // id 1 @ a.social
    await repo.addSession('carol@b.social') // id 1 @ b.social
    expect(storeKey(accounts['alice@a.social'])).not.toBe(storeKey(accounts['carol@b.social']))
    expect((await repo.listSessions()).length).toBe(2)
  })

  it('keeps each account’s cached toots when switching (non-destructive)', async () => {
    const a = await repo.addSession('alice@a.social')
    a.statuses['uri-a'] = { content: '<p>hello</p>', createdAt: '', types: ['post'], acct: 'alice@a.social', id: '10' }
    await repo.saveStore(a)

    // Switch to bob, then back to alice.
    await repo.addSession('bob@b.social')
    expect((await repo.loadActiveStore())?.account.acct).toBe('bob@b.social')

    await repo.setActive(storeKey(accounts['alice@a.social']))
    const back = await repo.loadActiveStore()
    expect(Object.keys(back!.statuses)).toEqual(['uri-a'])
  })

  it('re-adding a known account reactivates it without wiping data', async () => {
    const a = await repo.addSession('alice@a.social')
    a.statuses['uri-a'] = { content: 'x', createdAt: '', types: ['post'], acct: 'alice@a.social', id: '10' }
    await repo.saveStore(a)
    await repo.addSession('bob@b.social')

    const again = await repo.addSession('alice@a.social')
    expect(Object.keys(again.statuses)).toEqual(['uri-a'])
    expect((await repo.listSessions()).length).toBe(2) // not duplicated
    expect(await repo.getActiveKey()).toBe(storeKey(accounts['alice@a.social']))
  })

  it('removeSession deletes the data and drops it from the registry', async () => {
    await repo.addSession('alice@a.social')
    await repo.addSession('bob@b.social') // bob now active
    const aliceKey = storeKey(accounts['alice@a.social'])

    await repo.removeSession(storeKey(accounts['bob@b.social']))
    expect(await repo.loadStore(storeKey(accounts['bob@b.social']))).toBeUndefined()
    expect((await repo.listSessions()).map(a => a.acct)).toEqual(['alice@a.social'])
    // Active fell back to the remaining account.
    expect(await repo.getActiveKey()).toBe(aliceKey)
  })

  it('removing the last account goes inactive', async () => {
    await repo.addSession('alice@a.social')
    await repo.removeSession(storeKey(accounts['alice@a.social']))
    expect(await repo.getActiveKey()).toBeNull()
    expect(await repo.loadActiveStore()).toBeUndefined()
  })

  it('saveIndex / loadIndex round-trips a cached index, keyed per account', async () => {
    await repo.addSession('alice@a.social')
    const account = accounts['alice@a.social']
    const cache: PersistedIndex = { version: 1, documentCount: 2, json: '{"v":1}' }

    await repo.saveIndex(account, cache)
    expect(await repo.loadIndex(account)).toEqual(cache)
    // Stored under its own index namespace, distinct from the store key.
    expect(kv.map.has(indexKey(account))).toBe(true)
    expect(indexKey(account)).not.toBe(storeKey(account))
  })

  it('loadIndex returns undefined when no index is cached', async () => {
    expect(await repo.loadIndex(accounts['alice@a.social'])).toBeUndefined()
  })

  it('removeSession also deletes the derived index cache', async () => {
    await repo.addSession('alice@a.social')
    const account = accounts['alice@a.social']
    await repo.saveIndex(account, { version: 1, documentCount: 0, json: '{}' })

    await repo.removeSession(storeKey(account))
    expect(kv.map.has(indexKey(account))).toBe(false)
    expect(await repo.loadIndex(account)).toBeUndefined()
  })

  it('migrates a legacy single-store blob on first read', async () => {
    // Seed the pre-multi-account layout: one StatusStore under 'store'.
    const legacy: StatusStore = {
      account: accounts['alice@a.social'],
      position: { statusMinId: '5', favouriteMinId: '0', bookmarkMinId: '0' },
      statuses: { 'uri-old': { content: 'old', createdAt: '', types: ['post'], acct: 'alice@a.social', id: '7' } }
    }
    await kv.setItem('store', legacy)

    const active = await repo.loadActiveStore()
    expect(Object.keys(active!.statuses)).toEqual(['uri-old'])
    expect(active!.position.statusMinId).toBe('5')

    // Legacy key removed, registry written, data under the new key.
    expect(kv.map.has('store')).toBe(false)
    const registry = await kv.getItem<SessionRegistry>('sessions')
    expect(registry?.activeKey).toBe(storeKey(accounts['alice@a.social']))
    expect(kv.map.has(storeKey(accounts['alice@a.social']))).toBe(true)
  })
})
