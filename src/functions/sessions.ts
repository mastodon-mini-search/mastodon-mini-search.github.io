import localforage from "localforage"
import { ResolvedAccountSetting } from "../models/AccountSetting"
import { SessionRegistry } from "../models/Session"
import { StatusStore } from "../models/StatusStore"
import { PersistedIndex } from "../models/PersistedIndex"
import { OAuthApp, PendingAuth } from "../models/OAuthApp"
import resolveAccount from "./resolveAccount"

// One registry record under a fixed key; each account's toots under their own
// key. See docs/sessions.md.
const REGISTRY_KEY = 'sessions'
// Pre-multi-account builds stored a single StatusStore here; migrated on first
// read (see `loadRegistry`).
const LEGACY_STORE_KEY = 'store'
// The single OAuth login in flight (survives the redirect away and back).
const PENDING_AUTH_KEY = 'oauth-pending'

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

// The cached search index lives under its own namespace, parallel to the store.
// Kept separate so it can be loaded/rebuilt/dropped independently of the toots
// (it's a derived, throwaway artifact — see PersistedIndex).
export function indexKey(account: { instanceUrl: string; accountId: string }): string {
  return `index:${account.instanceUrl}:${account.accountId}`
}

// Registered OAuth client credentials, keyed per instance so repeat logins on
// the same instance reuse the same app rather than registering a new one each
// time.
export function oauthAppKey(instanceUrl: string): string {
  return `oauth-app:${instanceUrl}`
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

  // The cached search index for an account, or undefined if none is stored.
  // Opaque here — validity (version/count/decode) is the index layer's call.
  async loadIndex(account: { instanceUrl: string; accountId: string }): Promise<PersistedIndex | undefined> {
    return (await this.kv.getItem<PersistedIndex>(indexKey(account))) ?? undefined
  }

  async saveIndex(account: { instanceUrl: string; accountId: string }, index: PersistedIndex): Promise<void> {
    await this.kv.setItem(indexKey(account), index)
  }

  async setActive(key: string | null): Promise<void> {
    const registry = await this.loadRegistry()
    registry.activeKey = key
    await this.saveRegistry(registry)
  }

  // Add an account by handle (resolves it unauthenticated, no token). Kept for
  // the resolve-only path and the session tests; the OAuth flow uses
  // addResolvedSession with the account it already has in hand.
  async addSession(acct: string): Promise<StatusStore> {
    return this.addResolvedSession(await this.resolve(acct))
  }

  // Register (or re-activate) an already-resolved account — the OAuth flow's
  // entry point, since it ends up holding the full account (incl. a fresh
  // `apiKey`) rather than a bare handle. Existing cached toots are kept;
  // switching is non-destructive, only removeSession deletes data. A re-login
  // refreshes the stored account (new token) in both the registry and the store
  // without touching the toots.
  async addResolvedSession(account: ResolvedAccountSetting): Promise<StatusStore> {
    const key = storeKey(account)
    const registry = await this.loadRegistry()

    let store = await this.loadStore(key)
    if (store) {
      store.account = account
      await this.saveStore(store)
    } else {
      store = emptyStore(account)
      await this.saveStore(store)
    }

    const i = registry.accounts.findIndex(a => storeKey(a) === key)
    if (i === -1) {
      registry.accounts.push(account)
    } else {
      registry.accounts[i] = account
    }
    registry.activeKey = key
    await this.saveRegistry(registry)
    return store
  }

  // --- OAuth credential storage -------------------------------------------
  // The registered client per instance, the in-flight login, and helpers to
  // read/clear them. Routed through the same KeyValueStore as everything else
  // so the single-storage-entrypoint contract (see docs/sessions.md) holds.

  async loadOAuthApp(instanceUrl: string): Promise<OAuthApp | undefined> {
    return (await this.kv.getItem<OAuthApp>(oauthAppKey(instanceUrl))) ?? undefined
  }

  async saveOAuthApp(app: OAuthApp): Promise<void> {
    await this.kv.setItem(oauthAppKey(app.instanceUrl), app)
  }

  async loadPendingAuth(): Promise<PendingAuth | undefined> {
    return (await this.kv.getItem<PendingAuth>(PENDING_AUTH_KEY)) ?? undefined
  }

  async savePendingAuth(pending: PendingAuth): Promise<void> {
    await this.kv.setItem(PENDING_AUTH_KEY, pending)
  }

  async clearPendingAuth(): Promise<void> {
    await this.kv.removeItem(PENDING_AUTH_KEY)
  }

  // Remove an account and its cached toots. If it was active, fall back to any
  // remaining account, else go inactive.
  async removeSession(key: string): Promise<void> {
    const registry = await this.loadRegistry()
    const removed = registry.accounts.find(a => storeKey(a) === key)
    registry.accounts = registry.accounts.filter(a => storeKey(a) !== key)
    if (registry.activeKey === key) {
      registry.activeKey = registry.accounts.length > 0 ? storeKey(registry.accounts[0]) : null
    }
    await this.kv.removeItem(key)
    // Drop the derived index cache too, so it can't outlive its toots.
    if (removed) {
      await this.kv.removeItem(indexKey(removed))
    }
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
