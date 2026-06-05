import localforage from "localforage"
import { ResolvedAccountSetting } from "../models/AccountSetting"
import { SessionRegistry } from "../models/Session"
import { StatusStore } from "../models/StatusStore"
import resolveAccount from "./resolveAccount"

// One registry record under a fixed key; each account's toots under their own
// key. See docs/sessions.md.
const REGISTRY_KEY = 'sessions'
// Pre-multi-account builds stored a single StatusStore here; migrated on first
// read (see `loadRegistry`).
const LEGACY_STORE_KEY = 'store'

// The persistence seam. Production uses localforage (IndexedDB); tests inject an
// in-memory map, so the session logic is unit-testable without a real database.
export interface KeyValueStore {
  getItem<T>(key: string): Promise<T | null>
  setItem<T>(key: string, value: T): Promise<T>
  removeItem(key: string): Promise<void>
}

// accountId is unique only within an instance, so the key must carry the
// instance too — otherwise two accounts that share an id across instances would
// collide.
export function storeKey(account: { instanceUrl: string; accountId: string }): string {
  return `store:${account.instanceUrl}:${account.accountId}`
}

function emptyStore(account: ResolvedAccountSetting): StatusStore {
  return {
    account,
    statuses: {},
    position: { statusMinId: '0', favouriteMinId: '0', bookmarkMinId: '0' }
  }
}

export class SessionRepository {
  constructor(
    private kv: KeyValueStore,
    private resolve: (acct: string) => Promise<ResolvedAccountSetting> = resolveAccount
  ) {}

  private async loadRegistry(): Promise<SessionRegistry> {
    const existing = await this.kv.getItem<SessionRegistry>(REGISTRY_KEY)
    if (existing) {
      return existing
    }
    // First run on a build that predates multi-account: fold the lone 'store'
    // blob into the new keying so the user keeps their cached toots.
    const legacy = await this.kv.getItem<StatusStore>(LEGACY_STORE_KEY)
    if (legacy && legacy.account) {
      const key = storeKey(legacy.account)
      await this.kv.setItem(key, legacy)
      await this.kv.removeItem(LEGACY_STORE_KEY)
      const migrated: SessionRegistry = { accounts: [legacy.account], activeKey: key }
      await this.kv.setItem(REGISTRY_KEY, migrated)
      return migrated
    }
    return { accounts: [], activeKey: null }
  }

  private saveRegistry(registry: SessionRegistry): Promise<SessionRegistry> {
    return this.kv.setItem(REGISTRY_KEY, registry)
  }

  async listSessions(): Promise<ResolvedAccountSetting[]> {
    return (await this.loadRegistry()).accounts
  }

  async getActiveKey(): Promise<string | null> {
    return (await this.loadRegistry()).activeKey
  }

  async loadStore(key: string): Promise<StatusStore | undefined> {
    return (await this.kv.getItem<StatusStore>(key)) ?? undefined
  }

  async loadActiveStore(): Promise<StatusStore | undefined> {
    const { activeKey } = await this.loadRegistry()
    if (!activeKey) {
      return undefined
    }
    return this.loadStore(activeKey)
  }

  async saveStore(store: StatusStore): Promise<void> {
    await this.kv.setItem(storeKey(store.account), store)
  }

  async setActive(key: string | null): Promise<void> {
    const registry = await this.loadRegistry()
    registry.activeKey = key
    await this.saveRegistry(registry)
  }

  // Add an account (or re-activate one already known). Existing cached toots are
  // kept — switching is non-destructive; only removeSession deletes data.
  async addSession(acct: string): Promise<StatusStore> {
    const account = await this.resolve(acct)
    const key = storeKey(account)
    const registry = await this.loadRegistry()

    let store = await this.loadStore(key)
    if (!store) {
      store = emptyStore(account)
      await this.saveStore(store)
    }
    if (!registry.accounts.some(a => storeKey(a) === key)) {
      registry.accounts.push(account)
    }
    registry.activeKey = key
    await this.saveRegistry(registry)
    return store
  }

  // Remove an account and its cached toots. If it was active, fall back to any
  // remaining account, else go inactive.
  async removeSession(key: string): Promise<void> {
    const registry = await this.loadRegistry()
    registry.accounts = registry.accounts.filter(a => storeKey(a) !== key)
    if (registry.activeKey === key) {
      registry.activeKey = registry.accounts.length > 0 ? storeKey(registry.accounts[0]) : null
    }
    await this.kv.removeItem(key)
    await this.saveRegistry(registry)
  }
}

const localforageKv: KeyValueStore = {
  getItem<T>(key: string) { return localforage.getItem<T>(key) },
  setItem<T>(key: string, value: T) { return localforage.setItem<T>(key, value) },
  removeItem(key: string) { return localforage.removeItem(key) }
}

// The app-wide repository. Tests construct their own with an in-memory store.
export default new SessionRepository(localforageKv)
