<template>
  <div>
    已加載嘟文：{{ count }} <BlockingButton :click="doFetch">加載</BlockingButton>
  </div>
</template>

<script setup lang="ts">
import BlockingButton from './BlockingButton.vue'
import fetchStatuses from '../functions/fetchStatuses'
import { StatusStore } from '../models/StatusStore'
import { ref } from 'vue'

const props = defineProps<{
  store: StatusStore
}>()

// Fetch only mutates the store in place (and persists it). Indexing is the
// parent's job — it owns the index lifecycle (restore / build / grow / cache).
const emit = defineEmits<{
  (e: 'loadComplete'): void
}>()

const count = ref(Object.keys(props.store.statuses).length)

async function doFetch() {
  await fetchStatuses(props.store, function() {
    count.value = Object.keys(props.store.statuses).length
  })
  emit('loadComplete')
}
</script>

<style scoped>

</style>