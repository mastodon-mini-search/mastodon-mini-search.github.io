import { ref, shallowRef, reactive, computed, watch, onBeforeUnmount, Ref } from 'vue'
import { SearchResult } from 'minisearch'
import { StatusStore } from '../models/StatusStore'
import FilterState from '../models/FilterState'
import SortOrder from '../models/SortOrder'

// Owns everything about turning the search box into a filtered result list: the
// live box text, the committed query that produced the current results, the
// debounce, the type filter, and the filtered view. The components above (the
// search box, the result count, the empty-state hints) just read these refs.
//
// `search` runs a query against the active account's index, which lives in a Web
// Worker — so it resolves asynchronously. `ready` says whether that index exists
// yet, and `store` is passed as a ref so the composable always sees the active
// account's corpus without being recreated on every switch.
export function useSearch(
  search: (query: string) => Promise<SearchResult[]>,
  ready: Ref<boolean>,
  store: Ref<StatusStore | undefined>,
) {
  // `text` is what's in the box right now; `query` is the term that actually
  // produced `results`. Keeping them apart lets the results and hints lag behind
  // the debounce instead of flashing "no match" on every keystroke.
  const text = ref('')
  const query = ref('')
  const results = shallowRef<SearchResult[]>([])
  const searched = ref(false)

  const filter: FilterState = reactive({
    post: true,
    boost: true,
    favourite: false,
    bookmark: false,
  })

  // How the result list is ordered. Like `filter`, this persists across account
  // switches (reset leaves it alone) — it's a viewing preference, not per-corpus.
  const sort = ref<SortOrder>('relevance')

  // Filter the raw results by the active type toggles, then order them. Lives here
  // (rather than inside Results) so the result count and empty states can react to
  // it too. `search` already returns matches sorted by score (descending), so
  // 'relevance' is just the filtered list as-is; 'newest'/'oldest' reorder by
  // createdAt (a same-format ISO UTC string, so a lexical compare is chronological).
  const filtered = computed(() => {
    const s = store.value
    if (!s) {
      return []
    }
    const matched = results.value.filter(r => s.statuses[r.id].types.some(t => filter[t]))
    if (sort.value === 'relevance') {
      return matched
    }
    const dir = sort.value === 'newest' ? -1 : 1
    // matched is a fresh array from .filter(), so sorting it in place is safe.
    return matched.sort((a, b) => {
      const ta = s.statuses[a.id].createdAt
      const tb = s.statuses[b.id].createdAt
      return ta < tb ? -dir : ta > tb ? dir : 0
    })
  })

  // Each run gets a token; only the latest may publish. The search resolves
  // asynchronously (it round-trips to the worker that owns the index), so a later
  // keystroke — or an account switch via reset() — must be able to invalidate an
  // in-flight run before its results land against the wrong corpus.
  let token = 0

  // Commit the current box text: run it against the index and publish the query,
  // results, and searched flag together so the UI never shows a half-applied state.
  async function run(): Promise<void> {
    const q = text.value.trim()
    const mine = ++token
    if (!q || !ready.value) {
      query.value = q
      results.value = []
      searched.value = q.length > 0
      return
    }
    const found = await search(q)
    if (mine !== token) {
      return
    }
    query.value = q
    results.value = found
    searched.value = true
  }

  // Search as the user types, but debounce so we don't churn on every keystroke.
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(text, () => {
    clearTimeout(timer)
    timer = setTimeout(run, 250)
  })
  onBeforeUnmount(() => clearTimeout(timer))

  // Enter searches immediately rather than waiting on the debounce.
  function runNow(): Promise<void> {
    clearTimeout(timer)
    return run()
  }

  // Clear the search (e.g. when the active account changes), cancelling any
  // pending debounce and invalidating any in-flight run so a stale one can't
  // repopulate results afterwards. Leaves the `filter` toggles and `sort` order
  // alone — those are viewing preferences that persist across accounts, as before.
  function reset() {
    clearTimeout(timer)
    token++
    text.value = ''
    query.value = ''
    results.value = []
    searched.value = false
  }

  return { text, query, results, filtered, searched, filter, sort, runNow, reset }
}
