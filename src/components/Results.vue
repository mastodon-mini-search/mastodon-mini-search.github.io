<template>
  <ul class="results">
    <li v-for="result in results" :key="result.id">
      <ResultItem :result="result" :store="store" />
    </li>
  </ul>
</template>

<script setup lang="ts">
import { StatusStore } from '../models/StatusStore'
import { SearchResult } from 'minisearch'
import ResultItem from './ResultItem.vue'

defineProps<{
  store: StatusStore
  results: SearchResult[]
}>()
</script>

<style scoped>
.results {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
</style>
