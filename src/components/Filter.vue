<template>
  <div class="filter" role="group" aria-label="篩選貼文類型">
    <button
      v-for="t in types"
      :key="t.key"
      type="button"
      class="chip"
      :class="{ active: filter[t.key] }"
      :style="{ '--chip': t.color }"
      :aria-pressed="filter[t.key]"
      @click="filter[t.key] = !filter[t.key]"
    >{{ t.label }}</button>
  </div>
</template>

<script setup lang="ts">
import FilterState from '../models/FilterState'

const props = defineProps<{
  filter: FilterState
}>()
const { filter } = props

const types: { key: keyof FilterState; label: string; color: string }[] = [
  { key: 'post', label: '原創', color: 'var(--accent)' },
  { key: 'boost', label: '轉嘟', color: 'var(--boost)' },
  { key: 'favourite', label: '喜歡', color: 'var(--favourite)' },
  { key: 'bookmark', label: '書籤', color: 'var(--bookmark)' },
]
</script>

<style scoped>
.filter {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.chip {
  padding: 0.3rem 0.85rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 0.875rem;
  font-weight: 600;
}
.chip:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text);
}
.chip.active {
  background: var(--chip);
  border-color: var(--chip);
  color: #fff;
}
.chip.active:hover:not(:disabled) {
  background: var(--chip);
  color: #fff;
  filter: brightness(0.94);
}
</style>
