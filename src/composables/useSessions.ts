import { ref, shallowRef } from 'vue'
import { ResolvedAccountSetting } from '../models/AccountSetting'
import { StatusStore } from '../models/StatusStore'
import sessions, { storeKey } from '../functions/sessions'
import { completeLoginFromRedirect } from '../functions/oauth'

// Shared, app-wide session state. Module-level (not per-call) so the two
// components that touch accounts read and mutate the same state without an event
// seam between them: Main renders `activeStore` and drives its search index;
// AccountSwitcher lists `accounts` and switches/removes. `busy` disables the
// switcher's rows while a switch/remove is in flight.
const activeStore = shallowRef<StatusStore | undefined>(undefined)
const accounts = ref<ResolvedAccountSetting[]>([])
const busy = ref(false)

// Reload the known-accounts list (after anything that adds or drops one).
async function refresh(): Promise<void> {
  accounts.value = await sessions.listSessions()
}

// First load: finish an OAuth callback into the freshly authorized account, or
// resume the last active one. Returns the store so the caller can build its
// index before the app paints (Main awaits this inside Suspense's setup).
async function bootstrap(): Promise<StatusStore | undefined> {
  const authed = await completeLoginFromRedirect()
  activeStore.value = authed
    ? await sessions.addResolvedSession(authed)
    : await sessions.loadActiveStore()
  await refresh()
  return activeStore.value
}

// Make another known account active. The caller skips the no-op case (switching
// to the already-active account) since it knows the active key; here we always
// switch. The index rebuild is the active-store watcher's job, not ours, so
// `busy` only covers the data swap (matching the old switcher behaviour).
async function switchTo(key: string): Promise<void> {
  busy.value = true
  try {
    await sessions.setActive(key)
    activeStore.value = await sessions.loadStore(key)
  } finally {
    busy.value = false
  }
}

// Remove the active account (and its cached toots); fall back to the first
// remaining account, or to none.
async function remove(): Promise<void> {
  const s = activeStore.value
  if (!s) {
    return
  }
  busy.value = true
  try {
    await sessions.removeSession(storeKey(s.account))
    activeStore.value = await sessions.loadActiveStore()
    await refresh()
  } finally {
    busy.value = false
  }
}

// Add an account by handle (the no-login browse path) and make it active.
// Throws if the handle can't be resolved, so the caller can show its own error.
async function addByHandle(handle: string): Promise<void> {
  activeStore.value = await sessions.addSession(handle)
  await refresh()
}

export function useSessions() {
  return { activeStore, accounts, busy, refresh, bootstrap, switchTo, remove, addByHandle }
}
