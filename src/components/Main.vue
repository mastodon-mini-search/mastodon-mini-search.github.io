<template>
  <Setup
    v-if="!store || addingAccount"
    :cancelable="!!store"
    @setupComplete="onSetupComplete"
    @cancel="addingAccount = false"
  />

  <template v-else>
    <header class="topbar">
      <div class="brand">
        <span class="logo" aria-hidden="true">🔍</span>
        <span class="title">站外搜索</span>
      </div>
      <AccountSwitcher :account="store.account" @changed="onAccountChanged" @add="startAddAccount"/>
    </header>

    <Loader :key="accountKey" :store="store" @loadComplete="onFetched"/>

    <template v-if="index">
      <section class="search">
        <Searcher v-model="text" @submit="runNow"/>
        <div class="search-bar">
          <Filter :filter="filter"/>
          <span v-if="searched" class="count">{{ filtered.length }} 條結果</span>
        </div>
      </section>

      <p v-if="!searched" class="hint">輸入關鍵字，開始搜索你的嘟文。</p>
      <p v-else-if="results.length === 0" class="hint">沒有符合「{{ query }}」的嘟文。</p>
      <p v-else-if="filtered.length === 0" class="hint">{{ results.length }} 條結果都被類型篩選擋掉了，試著多勾選幾個類型。</p>
      <Results v-else :results="filtered" :store="store"/>
    </template>
    <p v-else class="hint">先載入嘟文，建立搜索索引。</p>
  </template>
</template>

<script setup lang="ts">
import Setup from "./Setup.vue"
import { shallowRef, ShallowRef, ref, computed } from "vue"
import { StatusStore } from "../models/StatusStore"
import sessions, { storeKey } from "../functions/sessions"
import Loader from './Loader.vue'
import MiniSearch from 'minisearch'
import Filter from './Filter.vue'
import Searcher from './Searcher.vue'
import Results from './Results.vue'
import createIndex, { toPersistedIndex, restoreIndex, indexNewStatuses } from '../functions/createIndex'
import AccountSwitcher from './AccountSwitcher.vue'
import { completeLoginFromRedirect } from '../functions/oauth'
import { useSearch } from '../composables/useSearch'

const store: ShallowRef<StatusStore | undefined> = shallowRef(undefined)
const index: ShallowRef<MiniSearch | undefined> = shallowRef(undefined)

// Search state + behaviour (live box text, committed query, type filter,
// debounce, filtered results) lives in one composable; this component only
// wires it to the active index and clears it on account changes. Created before
// the awaits below so its onBeforeUnmount registers during synchronous setup.
const { text, query, results, filtered, searched, filter, runNow, reset } = useSearch(index, store)

// When true, the Setup screen is shown on top of an existing session to add
// another account (the switcher's "新增帳號" routes here instead of an inline
// form). Reset once the new account lands or the user backs out.
const addingAccount = ref(false)

// Keys the per-account Loader so its counts reset when the active account changes.
const accountKey = computed(() => (store.value ? storeKey(store.value.account) : ''))

// Bootstrap: if this load is an OAuth callback, finish the login and make the
// freshly authorized account active; otherwise resume the last active account.
const authed = await completeLoginFromRedirect()
store.value = authed ? await sessions.addResolvedSession(authed) : await sessions.loadActiveStore()
if (store.value) {
  index.value = await loadOrBuildIndex(store.value)
}

// Restore the cached index if one is stored and still valid; otherwise rebuild
// from the toots and cache the result for next time.
async function loadOrBuildIndex(s: StatusStore): Promise<MiniSearch> {
  const cached = await sessions.loadIndex(s.account)
  const restored = cached && restoreIndex(s, cached)
  if (restored) {
    return restored
  }
  const built = createIndex(s)
  await sessions.saveIndex(s.account, toPersistedIndex(s, built))
  return built
}

// The switcher asked to add an account: show the Setup screen over the current
// session. Clear the active search first so backing out doesn't reveal a stale
// query box against still-listed results.
function startAddAccount() {
  reset()
  addingAccount.value = true
}

// Setup finished (no-login browse path; the OAuth path returns via the redirect
// instead). addSession already persisted and activated the account. For the
// first-run setup there's no prior account, so just show it. When adding on top
// of an existing session, leave the add screen and swap to the new account the
// same way the switcher does.
function onSetupComplete(storeCreated: StatusStore) {
  if (addingAccount.value) {
    addingAccount.value = false
    onAccountChanged(storeCreated)
  } else {
    store.value = storeCreated
  }
}

// A fetch finished: the store was mutated in place and already persisted by
// fetchStatuses. Grow the existing index with just the new toots — or build it
// fresh if there's none yet (e.g. right after setup) — then re-cache it so the
// next cold start can skip the rebuild.
function onFetched() {
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

// The switcher already performed the data-layer change (switch / add / remove);
// here we just swap in the new active store — rebuilding its index and clearing
// the previous search — or fall back to Setup when no account remains.
async function onAccountChanged(s: StatusStore | undefined) {
  if (!s) {
    resetToSetup()
    return
  }
  // Clear the previous account's search before swapping the store, so a
  // re-render can't look up stale result ids against the new store. Drop the
  // index too while it rebuilds, so a stale index can't be searched mid-switch.
  reset()
  index.value = undefined
  store.value = s
  index.value = await loadOrBuildIndex(s)
}

function resetToSetup() {
  store.value = undefined
  index.value = undefined
  reset()
}
</script>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding-bottom: 0.75rem;
  margin-bottom: 0.5rem;
  border-bottom: 1px solid var(--border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.logo {
  font-size: 1.1rem;
}
.title {
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: 0.01em;
}
.account {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}
.acct {
  color: var(--text-muted);
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 12rem;
}
.account :deep(.logout) {
  padding: 0.35rem 0.7rem;
  font-size: 0.85rem;
  font-weight: 600;
}

/* Keep the search box reachable while scrolling a long result list. */
.search {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.75rem 0;
  margin-bottom: 0.25rem;
  background: var(--bg);
}
.search-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
}
.count {
  color: var(--text-muted);
  font-size: 0.85rem;
  white-space: nowrap;
}
.hint {
  color: var(--text-muted);
  text-align: center;
  padding: 2.5rem 1rem;
  margin: 0;
}
</style>
