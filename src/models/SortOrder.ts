// How the result list is ordered. 'relevance' keeps MiniSearch's own score order
// (it returns matches sorted by score, descending — and filtering preserves that),
// so it's the do-nothing case; 'newest'/'oldest' reorder by the toot's createdAt.
type SortOrder = 'relevance' | 'newest' | 'oldest'
export default SortOrder
