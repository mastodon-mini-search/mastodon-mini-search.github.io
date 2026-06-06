import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { useSessions } from '../../src/composables/useSessions'
import sessions, { SessionRepository, KeyValueStore, storeKey } from '../../src/functions/sessions'
import { ResolvedAccountSetting } from '../../src/models/AccountSetting'

// Control the one OAuth-callback dependency. vi.hoisted so the mock factory
// (itself hoisted above the imports) can reference it.
const { completeLogin } = vi.hoisted(() => ({ completeLogin: vi.fn() }))
vi.mock('../../src/functions/oauth', () => ({
  completeLoginFromRedirect: completeLogin,
}))

function memoryKv(): KeyValueStore {
  const map = new Map<string, unknown>()
  return {
    async getItem<T>(key: string) { return (map.has(key) ? (map.get(key) as T) : null) },
    async setItem<T>(key: string, value: T) { map.set(key, value); return value },
    async removeItem(key: string) { map.delete(key) },
  }
}

const accounts: Record<string, ResolvedAccountSetting> = {
  'alice@a.social': { instanceUrl: 'https://a.social', acct: 'alice@a.social', accountId: '1' },
  'bob@b.social': { instanceUrl: 'https://b.social', acct: 'bob@b.social', accountId: '2' },
}
async function fakeResolve(acct: string): Promise<ResolvedAccountSetting> {
  const account = accounts[acct]
  if (!account) throw new Error(`unknown acct ${acct}`)
  return account
}

// useSessions drives the shared singleton; here every data-bearing method is
// delegated to a fresh in-memory SessionRepository, so the orchestration runs
// against the real session logic without IndexedDB. `storeKey` stays the real
// export, so remove() keys the active account correctly.
describe('useSessions', () => {
  let repo: SessionRepository
  let removeSession: MockInstance

  beforeEach(() => {
    repo = new SessionRepository(memoryKv(), fakeResolve)
    vi.spyOn(sessions, 'listSessions').mockImplementation(() => repo.listSessions())
    vi.spyOn(sessions, 'addSession').mockImplementation(acct => repo.addSession(acct))
    vi.spyOn(sessions, 'addResolvedSession').mockImplementation(a => repo.addResolvedSession(a))
    vi.spyOn(sessions, 'loadActiveStore').mockImplementation(() => repo.loadActiveStore())
    vi.spyOn(sessions, 'loadStore').mockImplementation(key => repo.loadStore(key))
    vi.spyOn(sessions, 'setActive').mockImplementation(key => repo.setActive(key))
    removeSession = vi.spyOn(sessions, 'removeSession').mockImplementation(key => repo.removeSession(key))
    completeLogin.mockReset().mockResolvedValue(null)

    // The composable's state is module-level — reset it between tests.
    const { activeStore, accounts: list, busy } = useSessions()
    activeStore.value = undefined
    list.value = []
    busy.value = false
  })

  afterEach(() => vi.restoreAllMocks())

  it('bootstrap resumes the last active account when there is no OAuth callback', async () => {
    await repo.addSession('alice@a.social') // the stored, active account
    const { activeStore, accounts: list, bootstrap } = useSessions()

    const store = await bootstrap()

    expect(completeLogin).toHaveBeenCalled()
    expect(store?.account.acct).toBe('alice@a.social')
    expect(activeStore.value?.account.acct).toBe('alice@a.social')
    expect(list.value.map(a => a.acct)).toEqual(['alice@a.social'])
  })

  it('bootstrap finishes an OAuth callback into the freshly authorized account', async () => {
    completeLogin.mockResolvedValue({ ...accounts['alice@a.social'], apiKey: 'tok-1' })
    const { activeStore, accounts: list, bootstrap } = useSessions()

    await bootstrap()

    expect(activeStore.value?.account.apiKey).toBe('tok-1')
    expect(list.value.map(a => a.acct)).toEqual(['alice@a.social'])
  })

  it('switchTo activates another known account and loads its store', async () => {
    await repo.addSession('alice@a.social')
    await repo.addSession('bob@b.social') // bob is active in the repo
    const { activeStore, switchTo } = useSessions()

    await switchTo(storeKey(accounts['alice@a.social']))

    expect(activeStore.value?.account.acct).toBe('alice@a.social')
  })

  it('switchTo flips busy on for the duration of the swap and off after', async () => {
    await repo.addSession('alice@a.social')
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    vi.spyOn(sessions, 'setActive').mockReturnValue(gate)
    const { busy, switchTo } = useSessions()

    const pending = switchTo(storeKey(accounts['alice@a.social']))
    expect(busy.value).toBe(true) // set synchronously before the first await

    release()
    await pending
    expect(busy.value).toBe(false)
  })

  it('remove deletes the active account and falls back to a remaining one', async () => {
    await repo.addSession('alice@a.social')
    const bob = await repo.addSession('bob@b.social') // bob is active
    const { activeStore, accounts: list, remove } = useSessions()
    activeStore.value = bob // mirror the live flow: the active store is set

    await remove()

    expect(activeStore.value?.account.acct).toBe('alice@a.social')
    expect(list.value.map(a => a.acct)).toEqual(['alice@a.social'])
  })

  it('remove is a no-op when no account is active', async () => {
    const { busy, remove } = useSessions() // activeStore left undefined by beforeEach

    await remove()

    expect(removeSession).not.toHaveBeenCalled()
    expect(busy.value).toBe(false)
  })

  it('addByHandle adds an account, activates it, and refreshes the list', async () => {
    const { activeStore, accounts: list, addByHandle } = useSessions()

    await addByHandle('bob@b.social')

    expect(activeStore.value?.account.acct).toBe('bob@b.social')
    expect(list.value.map(a => a.acct)).toEqual(['bob@b.social'])
  })

  it('refresh reloads the known-accounts list', async () => {
    await repo.addSession('alice@a.social')
    await repo.addSession('bob@b.social')
    const { accounts: list, refresh } = useSessions()
    expect(list.value).toEqual([]) // reset, not yet loaded

    await refresh()

    expect(list.value.map(a => a.acct)).toEqual(['alice@a.social', 'bob@b.social'])
  })
})
