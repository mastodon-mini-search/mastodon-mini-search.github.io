<template>
  <div class="loader">
    <span class="count">已加載 <strong>{{ count }}</strong> 則嘟文</span>
    <button class="accent" :disabled="loading" @click="doFetch">
      <span v-if="loading" class="spinner" aria-hidden="true"></span>
      {{ loading ? '載入中…' : '載入更多' }}
    </button>
  </div>
</template>

<script setup lang="ts">
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
const loading = ref(false)

async function doFetch() {
  loading.value = true
  try {
    await fetchStatuses(props.store, function() {
      count.value = Object.keys(props.store.statuses).length
    })
    emit('loadComplete')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.loader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.6rem 0.85rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 0.25rem;
}
.count {
  color: var(--text-muted);
  font-size: 0.9rem;
}
.count strong {
  color: var(--text);
}
.accent {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}
.spinner {
  width: 0.9em;
  height: 0.9em;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
