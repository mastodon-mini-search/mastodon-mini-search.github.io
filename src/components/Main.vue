<template>
  <Setup v-if="!store" @setupComplete="saveStoreCreated"/>
  <div v-if="store">
    當前賬號：{{ store.account.acct }} <BlockingButton :click="logOut">退出</BlockingButton>
  </div>
  <Loader v-if="store" :store="store" @loadComplete="saveStoreAndIndex"/>
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
import createIndex from '../functions/createIndex'
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
  index.value = createIndex(store.value)
}

function saveStoreCreated(storeCreated: StatusStore) {
  // addSession already persisted it; just show it.
  store.value = storeCreated
}

function saveStoreAndIndex(storeToSave: StatusStore, indexToSave: MiniSearch) {
  sessions.saveStore(storeToSave)
  store.value = storeToSave
  index.value = indexToSave
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
