<template>
  <article class="card">
    <header class="head">
      <a class="avatar" :href="profileUrl" target="_blank" rel="noopener">
        <img v-if="avatar" :src="avatar" :alt="displayName" loading="lazy" />
        <span v-else class="fallback">{{ initial }}</span>
      </a>
      <div class="who">
        <a class="name" :href="profileUrl" target="_blank" rel="noopener">{{ displayName }}</a>
        <span class="acct">@{{ status.acct }}</span>
      </div>
      <div class="aside">
        <div v-if="badges.length" class="badges">
          <span
            v-for="b in badges"
            :key="b.label"
            class="badge"
            :style="{ '--c': b.color }"
          >{{ b.label }}</span>
        </div>
        <a v-if="time" class="time" :href="link" target="_blank" rel="noopener" :title="timeTitle">{{ time }}</a>
      </div>
    </header>

    <p v-if="status.spoilerText" class="cw">⚠ {{ status.spoilerText }}</p>
    <div ref="body" class="content" :class="{ clamp: !expanded }" v-html="highlighted"></div>
    <button v-if="overflowing" type="button" class="more" @click="expanded = !expanded">
      {{ expanded ? '收合' : '顯示更多' }}
    </button>

    <div v-if="media.length > 0" class="media">
      <a v-for="(m, i) in media" :key="i" :href="m.url || link" target="_blank" rel="noopener" class="thumb">
        <img :src="m.previewUrl" :alt="m.description || ''" :title="m.description || ''" loading="lazy" />
      </a>
    </div>

    <footer class="foot">
      <a :href="link" target="_blank" rel="noopener">原文 ↗</a>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { StatusStore, StatusType } from '../models/StatusStore'
import { SearchHit } from '../models/SearchHit'
import { computed, onMounted, ref } from 'vue'
import highlight from '../functions/highlight'
import relativeTime from '../functions/relativeTime'

const props = defineProps<{
  result: SearchHit
  store: StatusStore
}>()

const status = computed(() => props.store.statuses[props.result.id])
const highlighted = computed(() => highlight(status.value.content, props.result.terms))
const media = computed(() => status.value.media ?? [])

// Author info was normalized onto the store; fall back to the bare acct for
// toots fetched before authors were captured.
const author = computed(() => props.store.authors?.[status.value.acct])
const avatar = computed(() => author.value?.avatar || '')
const displayName = computed(() => author.value?.displayName || status.value.acct)
const initial = computed(() => [...displayName.value][0]?.toUpperCase() ?? '?')

// Prefer the canonical permalink; fall back to a constructed one for toots
// stored before `url` was captured.
const link = computed(() => status.value.url || `${props.store.account.instanceUrl}/@${status.value.acct}/${status.value.id}`)
const profileUrl = computed(() => author.value?.url || `${props.store.account.instanceUrl}/@${status.value.acct}`)

const time = computed(() => relativeTime(status.value.createdAt))
const timeTitle = computed(() => {
  const d = new Date(status.value.createdAt)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-Hant')
})

const TYPE_BADGE: Record<StatusType, { label: string; color: string }> = {
  post: { label: '原創', color: 'var(--accent)' },
  boost: { label: '轉嘟', color: 'var(--boost)' },
  favourite: { label: '喜歡', color: 'var(--favourite)' },
  bookmark: { label: '書籤', color: 'var(--bookmark)' },
}
const badges = computed(() => status.value.types.map(t => TYPE_BADGE[t]).filter(Boolean))

// Only offer "顯示更多" when the clamped body is actually overflowing.
const body = ref<HTMLElement | null>(null)
const expanded = ref(false)
const overflowing = ref(false)
onMounted(() => {
  const el = body.value
  if (el) {
    overflowing.value = el.scrollHeight - el.clientHeight > 4
  }
})
</script>

<style scoped>
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 0.9rem 1rem;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}
.card:hover {
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  box-shadow: var(--shadow);
}

.head {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
}
.avatar {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--accent-soft);
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--accent);
  font-weight: 700;
  font-size: 1.1rem;
}
.who {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.name {
  font-weight: 700;
  color: var(--text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.name:hover {
  text-decoration: underline;
}
.acct {
  color: var(--text-muted);
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.aside {
  flex: none;
  margin-left: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.35rem;
}
.badges {
  display: flex;
  gap: 0.3rem;
}
.badge {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  color: #fff;
  background: var(--c);
}
.time {
  color: var(--text-muted);
  font-size: 0.8rem;
  white-space: nowrap;
}

.cw {
  margin: 0.7rem 0 0;
  padding: 0.3rem 0.6rem;
  font-weight: 600;
  color: var(--cw-text);
  background: var(--cw-bg);
  border-radius: var(--radius);
}
.content {
  margin-top: 0.6rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.content.clamp {
  display: -webkit-box;
  -webkit-line-clamp: 6;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.content :deep(p) {
  margin: 0.4rem 0;
}
.content :deep(p:first-child) {
  margin-top: 0;
}
.content :deep(p:last-child) {
  margin-bottom: 0;
}
.content :deep(a) {
  color: var(--accent);
}
/* v-html content is not scoped, so reach into it with :deep(). */
.content :deep(mark) {
  background: var(--mark-bg);
  color: var(--mark-text);
  border-radius: 3px;
  padding: 0 1px;
}
.more {
  margin-top: 0.4rem;
  padding: 0.15rem 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 0.85rem;
  font-weight: 600;
}
.more:hover:not(:disabled) {
  background: transparent;
  text-decoration: underline;
}

.media {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.7rem;
}
.thumb img {
  display: block;
  height: 5.5rem;
  width: auto;
  border-radius: 10px;
  object-fit: cover;
}
.foot {
  margin-top: 0.75rem;
  font-size: 0.85rem;
}
</style>
