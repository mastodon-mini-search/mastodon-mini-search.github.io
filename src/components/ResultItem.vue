<template>
  <article>
    <p v-if="status.spoilerText" class="cw">⚠ {{ status.spoilerText }}</p>
    <main v-html="highlighted"></main>
    <div v-if="media.length > 0" class="media">
      <a v-for="(m, i) in media" :key="i" :href="m.url || link" target="_blank" class="thumb">
        <img :src="m.previewUrl" :alt="m.description || ''" :title="m.description || ''">
      </a>
    </div>
    <div class="meta">
      <a :href="link" target="_blank">原文</a> 來自 <a :href="authorLink" target="_blank">@{{ status.acct }}</a>
    </div>
    <hr>
  </article>
</template>

<script setup lang="ts">
import { StatusStore } from '../models/StatusStore'
import { SearchResult } from 'minisearch'
import { computed } from 'vue'
import highlight from '../functions/highlight'

const props = defineProps<{
  result: SearchResult
  store: StatusStore
}>()

const status = computed(() => props.store.statuses[props.result.id])
const highlighted = computed(() => highlight(status.value.content, props.result.terms))
const media = computed(() => status.value.media ?? [])
// Prefer the canonical permalink; fall back to a constructed one for toots
// stored before `url` was captured.
const link = computed(() => status.value.url || `${props.store.account.instanceUrl}/@${status.value.acct}/${status.value.id}`)
const authorLink = computed(() => `${props.store.account.instanceUrl}/@${status.value.acct}`)
/*
const typeNames = {
  post: '原創',
  boost: '轉嘟',
  favourite: '喜歡',
  bookmark: '書籤'
}
const types = computed(() => status.value.types.map(t => typeNames[t]).join(' '))
*/
</script>

<style scoped>
main {
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.cw {
  margin: 0 0 0.5rem;
  padding: 0.25rem 0.5rem;
  font-weight: 600;
  color: #92400e;
  background: #fef3c7;
  border-radius: 4px;
}
.media {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.thumb img {
  display: block;
  height: 5rem;
  width: auto;
  border-radius: 6px;
  object-fit: cover;
}
.meta {
  margin-top: 0.5rem;
}
/* v-html content is not scoped, so reach into it with :deep(). */
main :deep(mark) {
  background: #fde68a;
  color: inherit;
  border-radius: 2px;
}
</style>