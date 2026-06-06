import type { IndexDoc } from './createIndex'
import type { PersistedIndex } from '../models/PersistedIndex'

// Build the search index in a Web Worker so tokenizing the whole corpus doesn't
// freeze the page on a large account (see index.worker.ts for what's heavy). The
// caller hands over docs that are already HTML-stripped (stripHTML needs the DOM,
// which a worker lacks) and gets back a serialized PersistedIndex; it then turns
// that into a searchable instance on the main thread with loadIndexJSON, since a
// MiniSearch can't be posted across the worker boundary.
//
// A fresh worker per build, terminated once it answers: builds are infrequent
// (cold start, account switch, first fetch), so spin-up cost is irrelevant and
// there's no idle worker to manage. Injected into useSearchIndex so tests can
// swap in a synchronous in-process builder instead of spawning a real worker.
export function buildPersistedIndex(docs: IndexDoc[]): Promise<PersistedIndex> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./index.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<PersistedIndex>) => {
      worker.terminate()
      resolve(e.data)
    }
    worker.onerror = (err) => {
      worker.terminate()
      reject(err)
    }
    worker.postMessage(docs)
  })
}
