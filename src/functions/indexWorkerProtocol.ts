import type { SearchResult } from 'minisearch'
import type { PersistedIndex } from '../models/PersistedIndex'
import type { IndexDoc } from './createIndex'

// The message protocol between the main thread (indexWorkerEngine) and the index
// worker (indexWorker). Each request carries an `id` the worker echoes back so
// the client can match a reply to its caller — a search and a grow can be in
// flight at once. Payloads are plain serializable data (docs in; the serialized
// index or search results out); a MiniSearch instance never crosses the boundary
// (it carries its tokenize fn and can't be structured-cloned).
export type WorkerRequest =
  | { id: number; type: 'restore'; json: string }
  | { id: number; type: 'build'; docs: IndexDoc[] }
  | { id: number; type: 'grow'; docs: IndexDoc[] }
  | { id: number; type: 'search'; query: string }
  | { id: number; type: 'clear' }

// A request without its id — what the client builds; the id is stamped on at
// send time. Distributive so each variant keeps its own fields (a plain
// `Omit<WorkerRequest, 'id'>` would collapse the union to just the shared `type`).
export type WorkerRequestBody = WorkerRequest extends infer R
  ? R extends { id: number } ? Omit<R, 'id'> : never
  : never

// What a request resolves to: restore -> boolean, build/grow -> the cache blob,
// search -> results. 'clear' gets no reply (fire-and-forget).
export type WorkerResult = boolean | PersistedIndex | SearchResult[]

export type WorkerResponse =
  | { id: number; ok: WorkerResult }
  | { id: number; error: string }
