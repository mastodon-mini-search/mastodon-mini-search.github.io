import { IndexHolder } from './indexHolder'
import type { WorkerRequest, WorkerResponse } from './indexWorkerProtocol'

// Owns the active account's index for the app's lifetime (one worker, reused
// across account switches via 'clear' then rebuild). loadJSON (restoring a
// cache) and search are the heavy CPU steps for a large CJK corpus; running them
// here is the whole point — it keeps the page responsive while a ~16MB cached
// index is reconstructed or queried. Docs arrive already HTML-stripped
// (extractDocs / stripHTML run on the main thread, since a worker has no
// `document`), so this file never touches the DOM.
const holder = new IndexHolder()

function reply(response: WorkerResponse): void {
  self.postMessage(response)
}

self.onmessage = (e: MessageEvent) => {
  const req = e.data as WorkerRequest
  try {
    switch (req.type) {
      case 'restore':
        reply({ id: req.id, ok: holder.restore(req.json) })
        break
      case 'build':
        reply({ id: req.id, ok: holder.build(req.docs) })
        break
      case 'grow':
        reply({ id: req.id, ok: holder.grow(req.docs) })
        break
      case 'search':
        reply({ id: req.id, ok: holder.search(req.query) })
        break
      case 'clear':
        holder.clear()
        break
    }
  } catch (err) {
    reply({ id: req.id, error: String(err) })
  }
}
