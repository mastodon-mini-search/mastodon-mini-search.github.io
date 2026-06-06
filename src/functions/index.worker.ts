import { buildIndexFromDocs, persistIndex } from './createIndex'
import type { IndexDoc } from './createIndex'

// Runs off the main thread. The expensive part of indexing is the tokenizer:
// NFKC-normalizing, per-char traditional->simplified, and emitting unigrams +
// bigrams for every CJK character of every toot, which can freeze the page for a
// noticeable beat on a large account. Doing it here keeps the UI responsive and
// lets the indexing indicator actually animate.
//
// The docs arrive already HTML-stripped (extractDocs / stripHTML run on the main
// thread, since a worker has no `document`), so this file only tokenizes,
// indexes, and serializes — no DOM is touched. It posts back a PersistedIndex;
// the main thread rebuilds the searchable instance with loadIndexJSON, because a
// MiniSearch carries its tokenize function and can't cross the worker boundary.
self.onmessage = (e: MessageEvent) => {
  const docs = e.data as IndexDoc[]
  self.postMessage(persistIndex(docs.length, buildIndexFromDocs(docs)))
}
