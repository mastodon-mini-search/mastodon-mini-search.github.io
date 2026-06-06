<template>
  <Setup v-if="!store" @setupComplete="saveStoreCreated"/>
  <div v-if="store">
    當前賬號：{{ store.account.acct }} <BlockingButton :click="logOut">退出</BlockingButton>
  </div>
  <Loader v-if="store" :store="store" @loadComplete="onFetched"/>
  <Searcher v-if="index" :index="index" @searchComplete="saveResults"/>
  <Filter v-if="index" :filter="filter"/>
  <Results v-if="store && results.length > 0" :results="results" :store="store" :filter="filter"/>
</template>

<script setup lang="ts">
import Setup from "./Setup.vue"
import { shallowRef, ShallowRef, reactive } from "vue"
import { StatusStore } from "../models/StatusStore"
import sessions from "../functions/sessions"
import Loader from './Loader.vue'
import MiniSearch, { SearchResult } from 'minisearch'
import Filter from './Filter.vue'
import Searcher from './Searcher.vue'
import Results from './Results.vue'
import createIndex, { toPersistedIndex, restoreIndex, indexNewStatuses } from '../functions/createIndex'
import FilterState from '../models/FilterState'
import BlockingButton from './BlockingButton.vue'

const store: ShallowRef<StatusStore | undefined> = shallowRef(await sessions.loadActiveStore())
const index: ShallowRef<MiniSearch | undefined> = shallowRef(undefined)
const filter: FilterState = reactive({
  post: true,
  boost: true,
  favourite: false,
  bookmark: false
})
const results: ShallowRef<SearchResult[]> = shallowRef([])

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

function saveStoreCreated(storeCreated: StatusStore) {
  // addSession already persisted it; just show it.
  store.value = storeCreated
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

function saveResults(rs: SearchResult[]) {
  results.value = rs
}

async function logOut() {
  const activeKey = await sessions.getActiveKey()
  if (activeKey) {
    await sessions.removeSession(activeKey)
  }
  store.value = undefined
  index.value = undefined
  results.value = []
}
</script>

<style scoped>

</style>
