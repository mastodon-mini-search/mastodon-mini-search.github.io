<template>
  <label class="sorter">
    <span class="label">排序</span>
    <select v-model="sort" aria-label="排序方式">
      <option value="relevance">相關度</option>
      <option value="newest">最新</option>
      <option value="oldest">最舊</option>
    </select>
  </label>
</template>

<script setup lang="ts">
import SortOrder from '../models/SortOrder'

// Just the result-ordering picker. The parent's useSearch composable owns the
// `sort` state and reorders `filtered` off it — this only edits it (two-way via
// v-model).
const sort = defineModel<SortOrder>({ required: true })
</script>

<style scoped>
.sorter {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.label {
  color: var(--text-muted);
  font-size: 0.85rem;
  white-space: nowrap;
}
select {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.3rem 1.6rem 0.3rem 0.7rem;
  border-radius: 999px;
  /* Native chevron, tinted to match the muted text. */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.6rem center;
}
select:hover {
  background-color: var(--surface-hover);
}
select:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
</style>
