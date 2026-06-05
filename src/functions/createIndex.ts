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
    miniSearch.add({
      uri: uri,
      content: stripHTML(status.content)
    })
  })
  return miniSearch
}
