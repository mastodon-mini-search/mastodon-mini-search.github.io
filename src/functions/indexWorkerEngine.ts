import type { SearchResult } from 'minisearch'
import type { PersistedIndex } from '../models/PersistedIndex'
import type { IndexEngine } from './indexEngine'
import type { WorkerRequestBody, WorkerResponse, WorkerResult } from './indexWorkerProtocol'

// The production engine: a long-lived Web Worker that owns the index, fronted by
// a small request/response layer. One worker for the app's lifetime — builds and
// account switches reuse it (clear + rebuild) — so there's no per-operation
// spin-up cost and a single natural owner of "the active account's index". Each
// call gets an id so replies match their caller even with several in flight.
export function createWorkerEngine(): IndexEngine {
  const worker = new Worker(new URL('./indexWorker.ts', import.meta.url), { type: 'module' })
  const pending = new Map<number, { resolve: (v: WorkerResult) => void; reject: (e: unknown) => void }>()
  let nextId = 1

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data
    const p = pending.get(msg.id)
    if (!p) {
      return
    }
    pending.delete(msg.id)
    if ('error' in msg) {
      p.reject(new Error(msg.error))
    } else {
      p.resolve(msg.ok)
    }
  }
  worker.onerror = (err) => {
    // The worker fell over; fail every in-flight call rather than leave them hung.
    for (const p of pending.values()) {
      p.reject(err)
    }
    pending.clear()
  }

  function call(req: WorkerRequestBody): Promise<WorkerResult> {
    const id = nextId++
    return new Promise<WorkerResult>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      worker.postMessage({ ...req, id })
    })
  }

  return {
    restore: (json) => call({ type: 'restore', json }) as Promise<boolean>,
    build: (docs) => call({ type: 'build', docs }) as Promise<PersistedIndex>,
    grow: (docs) => call({ type: 'grow', docs }) as Promise<PersistedIndex>,
    search: (query) => call({ type: 'search', query }) as Promise<SearchResult[]>,
    // Fire-and-forget: the worker drops its index and sends no reply.
    clear: () => worker.postMessage({ type: 'clear', id: 0 }),
  }
}
