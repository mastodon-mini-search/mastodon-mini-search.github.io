<template>
  <form class="searcher" role="search" @submit.prevent="$emit('submit')">
    <span class="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    </span>
    <input
      ref="input"
      type="search"
      v-model="text"
      placeholder="搜索你的嘟文…"
      aria-label="搜索"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
    />
    <button
      v-if="text"
      type="button"
      class="clear"
      aria-label="清除"
      @click="clear"
    >×</button>
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'

// Purely the input box. The parent's useSearch composable owns the debounce,
// the committed query, and running the index — this just edits the live text
// (two-way via v-model) and reports Enter so the parent can search immediately.
const text = defineModel<string>({ required: true })
defineEmits<{
  (e: 'submit'): void
}>()

const input = ref<HTMLInputElement | null>(null)

function clear() {
  text.value = ''
  input.value?.focus()
}
</script>

<style scoped>
.searcher {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.5rem 0 0.85rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  box-shadow: var(--shadow);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.searcher:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.icon {
  display: flex;
  color: var(--text-muted);
}
.searcher:focus-within .icon {
  color: var(--accent);
}
input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 0.85rem 0;
  font-size: 1.05rem;
  outline: none;
}
/* Hide the native search "x" — we render our own. */
input::-webkit-search-cancel-button {
  -webkit-appearance: none;
}
.clear {
  flex: none;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 1.4rem;
  line-height: 1;
  padding: 0.25rem 0.5rem;
  border-radius: 999px;
}
.clear:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--text);
}
</style>
