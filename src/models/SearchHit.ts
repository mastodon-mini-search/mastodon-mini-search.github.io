// One search result, the only shape the UI consumes. `id` is the toot uri (the
// index's idField); `terms` are the matched *index* terms (the actual stored
// terms a doc hit, incl. fuzzy variants), which highlight.ts marks. `score` is
// the BM25 relevance the results are ordered by (descending). This replaces
// MiniSearch's richer SearchResult now that the index is our own flat engine —
// the components only ever read `id` and `terms`, and order is the array order.
export interface SearchHit {
  id: string
  score: number
  terms: string[]
}
