import MiniSearch from "minisearch"
import { StatusStore } from "../models/StatusStore"
import stripHTML from "./stripHTML"
import isCJKWord from "./isCJKWord"
import tokenize from "./tokenize"

export default function(store: StatusStore) {
  const miniSearch = new MiniSearch({
    fields: ['content'],
    idField: 'uri',
    tokenize,
    searchOptions: {
      combineWith: 'AND',
      fuzzy(term) {
        // CJK tokens are single chars / bigrams; fuzzy there is pure noise.
        return isCJKWord(term) ? false : 0.35
      },
      maxFuzzy: 4
    }
  })
  Object.entries(store.statuses).forEach(([uri, status]) => {
    // Index the body plus the content warning and any media alt text, so a
    // toot is findable by its CW or by what's written in an image's alt.
    const parts = [stripHTML(status.content)]
    if (status.spoilerText) {
      parts.push(status.spoilerText)
    }
    for (const m of status.media ?? []) {
      if (m.description) {
        parts.push(m.description)
      }
    }
    miniSearch.add({
      uri: uri,
      content: parts.join(' ')
    })
  })
  return miniSearch
}
