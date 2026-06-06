<template>
  <Setup
    v-if="!store || addingAccount"
    :cancelable="!!store"
    @cancel="addingAccount = false"
  />

  <template v-else>
    <header class="topbar">
      <div class="brand">
        <span class="logo" aria-hidden="true">🔍</span>
        <span class="title">站外搜索</span>
      </div>
      <AccountSwitcher :account="store.account" @add="startAddAccount"/>
    </header>

    <Loader :key="accountKey" :store="store" @loadComplete="growIndex"/>

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
    <p v-else-if="building" class="hint building">
      <span class="spinner" aria-hidden="true"></span>
      正在建立搜索索引…
    </p>
    <p v-else class="hint">先載入嘟文，建立搜索索引。</p>
  </template>
</template>

<script setup lang="ts">
import Setup from "./Setup.vue"
import { ref, computed, watch } from "vue"
import { StatusStore } from "../models/StatusStore"
import { storeKey } from "../functions/sessions"
import Loader from './Loader.vue'
import Filter from './Filter.vue'
import Searcher from './Searcher.vue'
import Results from './Results.vue'
import AccountSwitcher from './AccountSwitcher.vue'
import { useSessions } from '../composables/useSessions'
import { useSearchIndex } from '../composables/useSearchIndex'
import { useSearch } from '../composables/useSearch'

// The active account's store (shared with AccountSwitcher / Setup), the index
// driven off it (restore / build / grow / cache), and the search state driven
// off the index. All three live in composables so Main just wires them together
// and reacts to the active account changing. `useSearch` registers an
// onBeforeUnmount, so it must run before the awaits below, during synchronous setup.
const { activeStore: store, bootstrap } = useSessions()
const { index, building, load: loadIndex, grow: growIndex, clear: clearIndex } = useSearchIndex(store)
const { text, query, results, filtered, searched, filter, runNow, reset } = useSearch(index, store)

// When true, the Setup screen is shown on top of an existing session to add
// another account (the switcher's "新增帳號" routes here instead of an inline
// form). Cleared by applyActiveStore once the new account lands, or by the
// Setup screen's cancel.
const addingAccount = ref(false)

// Keys the per-account Loader so its counts reset when the active account changes.
const accountKey = computed(() => (store.value ? storeKey(store.value.account) : ''))

// React to the active account changing (bootstrap, switch, remove, or a new
// account from Setup). Clear the previous search and index first — before any
// re-render — so stale result ids can't be looked up against the new store and a
// stale index can't be searched mid-switch. Then rebuild the index, but only
// once the store actually holds toots: an empty store leaves the index undefined
// so the UI shows the "load first" hint, and the first fetch builds it (growIndex).
async function applyActiveStore(s: StatusStore | undefined) {
  reset()
  clearIndex()
  addingAccount.value = false
  if (s && Object.keys(s.statuses).length > 0) {
    await loadIndex(s)
  }
}

// Bootstrap (OAuth callback or resume) before first paint — that's the only
// thing Suspense waits on, and it's just storage I/O. Building the index is
// deliberately NOT awaited here: it can take a beat on a large account, so we
// let the shell paint and run the build in a worker (useSearchIndex), surfacing
// progress via `building` rather than blocking behind the Suspense fallback.
// Wire the watcher after this initial kick-off so it only handles later account
// changes (no double-fire on the first store).
await bootstrap()
void applyActiveStore(store.value)
watch(store, applyActiveStore)

// The switcher asked to add an account: show the Setup screen over the current
// session. Clear the active search first so backing out doesn't reveal a stale
// query box against still-listed results.
function startAddAccount() {
  reset()
  addingAccount.value = true
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
.building {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
}
.spinner {
  width: 1.1rem;
  height: 1.1rem;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
