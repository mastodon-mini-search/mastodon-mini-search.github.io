import { ref, shallowRef, reactive, computed, watch, onBeforeUnmount, Ref } from 'vue'
import MiniSearch, { SearchResult } from 'minisearch'
import { StatusStore } from '../models/StatusStore'
import FilterState from '../models/FilterState'

// Owns everything about turning the search box into a filtered result list: the
// live box text, the committed query that produced the current results, the
// debounce, the type filter, and the filtered view. The components above (the
// search box, the result count, the empty-state hints) just read these refs.
//
// `index` and `store` are passed as refs so the composable always sees the
// active account's index/corpus without being recreated on every switch.
export function useSearch(
  index: Ref<MiniSearch | undefined>,
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

  // Filter the raw results by the active type toggles. Lives here (rather than
  // inside Results) so the result count and empty states can react to it too.
  const filtered = computed(() => {
    const s = store.value
    if (!s) {
      return []
    }
    return results.value.filter(r => s.statuses[r.id].types.some(t => filter[t]))
  })

  // Commit the current box text: run it against the index and publish the query,
  // results, and searched flag together so the UI never shows a half-applied state.
  function run() {
    const q = text.value.trim()
    const idx = index.value
    query.value = q
    results.value = q && idx ? idx.search(q) : []
    searched.value = q.length > 0
  }

  // Search as the user types, but debounce so we don't churn on every keystroke.
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(text, () => {
    clearTimeout(timer)
    timer = setTimeout(run, 250)
  })
  onBeforeUnmount(() => clearTimeout(timer))

  // Enter searches immediately rather than waiting on the debounce.
  function runNow() {
    clearTimeout(timer)
    run()
  }

  // Clear the search (e.g. when the active account changes), cancelling any
  // pending debounce so a stale run can't repopulate results afterwards. Leaves
  // the `filter` toggles alone — those persist across accounts, as before.
  function reset() {
    clearTimeout(timer)
    text.value = ''
    query.value = ''
    results.value = []
    searched.value = false
  }

  return { text, query, results, filtered, searched, filter, runNow, reset }
}
