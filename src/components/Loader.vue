<template>
  <div class="loader">
    <div class="stats">
      <span class="stat" style="--c: var(--accent)">嘟文 <strong>{{ counts.posts.toLocaleString() }}</strong></span>
      <template v-if="hasToken">
        <span class="stat" style="--c: var(--favourite)">喜歡 <strong>{{ counts.favourites.toLocaleString() }}</strong></span>
        <span class="stat" style="--c: var(--bookmark)">書籤 <strong>{{ counts.bookmarks.toLocaleString() }}</strong></span>
      </template>
    </div>
    <div class="actions">
      <button class="accent" :disabled="!!loading" @click="run('posts', fetchPosts)">
        <span v-if="loading === 'posts'" class="spinner" aria-hidden="true"></span>
        {{ loading === 'posts' ? '載入中…' : '載入嘟文' }}
      </button>
      <template v-if="hasToken">
        <button class="accent" :disabled="!!loading" @click="run('favourites', fetchFavourites)">
          <span v-if="loading === 'favourites'" class="spinner" aria-hidden="true"></span>
          {{ loading === 'favourites' ? '載入中…' : '載入喜歡' }}
        </button>
        <button class="accent" :disabled="!!loading" @click="run('bookmarks', fetchBookmarks)">
          <span v-if="loading === 'bookmarks'" class="spinner" aria-hidden="true"></span>
          {{ loading === 'bookmarks' ? '載入中…' : '載入書籤' }}
        </button>
      </template>
    </div>
    <p v-if="error" class="error" role="alert">
      載入失敗：{{ error }}。已保留進度，再按一次即可從中斷處繼續。
    </p>
  </div>
</template>

<script setup lang="ts">
import { fetchPosts, fetchFavourites, fetchBookmarks } from '../functions/fetchStatuses'
import { StatusStore } from '../models/StatusStore'
import { reactive, ref } from 'vue'

const props = defineProps<{
  store: StatusStore
}>()

// Fetch only mutates the store in place (and persists it). Indexing is the
// parent's job — it owns the index lifecycle (restore / build / grow / cache).
const emit = defineEmits<{
  (e: 'loadComplete'): void
}>()

type Category = 'posts' | 'favourites' | 'bookmarks'

// Per-category tallies, recomputed from the store after every batch so the
// active category's number visibly climbs while it fetches. A toot can carry
// more than one type (e.g. favourited and bookmarked), so these intentionally
// overlap rather than summing to a single total. 嘟文 covers own posts + boosts.
const counts = reactive({ posts: 0, favourites: 0, bookmarks: 0 })
function recount() {
  let posts = 0, favourites = 0, bookmarks = 0
  for (const uri in props.store.statuses) {
    const types = props.store.statuses[uri].types
    if (types.includes('post') || types.includes('boost')) {
      posts++
    }
    if (types.includes('favourite')) {
      favourites++
    }
    if (types.includes('bookmark')) {
      bookmarks++
    }
  }
  counts.posts = posts
  counts.favourites = favourites
  counts.bookmarks = bookmarks
}
recount()

// Which category is currently fetching, or '' when idle. Only one runs at a
// time: each fetch persists the whole store, so overlapping runs would race the
// save. The active button shows a spinner; the rest disable.
const loading = ref<Category | ''>('')

// The last fetch error, shown inline. Own posts persist per batch, so a failed
// run keeps its progress — re-running resumes from where it stopped.
const error = ref('')

// Favourites and bookmarks need an OAuth token; without one only own posts are
// reachable, so we hide those two buttons (and their tallies) entirely.
const hasToken = !!props.store.account.apiKey

async function run(
  kind: Category,
  fetcher: (store: StatusStore, afterBatch?: () => void) => Promise<void>
) {
  loading.value = kind
  error.value = ''
  try {
    await fetcher(props.store, recount)
    // Only index on a clean finish so the on-disk index never references toots
    // that weren't persisted (favourites/bookmarks save only at the end). Own
    // posts persist per batch, so a failed run keeps its progress on disk; the
    // next successful run indexes everything via grow()'s indexedUris diff.
    emit('loadComplete')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    recount()
    loading.value = ''
  }
}
</script>

<style scoped>
.loader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.6rem 0.75rem;
  padding: 0.6rem 0.85rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 0.25rem;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.9rem;
  font-size: 0.875rem;
  color: var(--text-muted);
}
.stat {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
}
.stat::before {
  content: "";
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--c);
}
.stat strong {
  color: var(--text);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.error {
  flex-basis: 100%;
  margin: 0;
  font-size: 0.85rem;
  color: var(--danger);
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
