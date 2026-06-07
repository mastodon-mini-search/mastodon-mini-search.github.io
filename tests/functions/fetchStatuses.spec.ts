import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mastodon } from 'masto'
import { fetchMarked, nextMaxId } from '../../src/functions/fetchStatuses'
import { StatusStore, MarkedPosition } from '../../src/models/StatusStore'
import sessions from '../../src/functions/sessions'

// A stand-in for masto's PaginatorHttp. The real one keeps the *next* page's
// Link in a private `nextParams` query string, updated each time a page is
// fetched; fetchMarked reads max_id out of it to persist a resume cursor. We
// model just that: yield the given pages, exposing the matching `nextParams`
// after each (or undefined for a missing/unreadable Link), and optionally throw
// part-way to simulate a network failure mid-walk.
class FakePaginator implements AsyncIterable<mastodon.v1.Status[]> {
  nextParams: string | undefined
  calls = 0
  private i = 0
  constructor(
    private pages: mastodon.v1.Status[][],
    private cursors: (string | undefined)[],
    private throwAfter?: number // throw on the next() once this many pages were yielded
  ) {}
  [Symbol.asyncIterator]() {
    return this
  }
  async next(): Promise<IteratorResult<mastodon.v1.Status[]>> {
    this.calls++
    if (this.throwAfter !== undefined && this.i >= this.throwAfter) {
      throw new Error('network')
    }
    if (this.i >= this.pages.length) {
      this.nextParams = undefined
      return { done: true, value: undefined as never }
    }
    const page = this.pages[this.i]
    const cursor = this.cursors[this.i]
    this.nextParams = cursor === undefined ? undefined : `limit=40&max_id=${cursor}`
    this.i++
    return { done: false, value: page }
  }
}

// fetchMarked opens a paginator once per pass (backfill, then catch-up). Hand out
// the given paginators in order and record the max_id each open was called with,
// so a test can assert *where* each pass started (top = undefined vs a cursor).
function opener(paginators: FakePaginator[]) {
  const opened: (string | undefined)[] = []
  let i = 0
  const open = (maxId: string | undefined) => {
    opened.push(maxId)
    const p = paginators[i++]
    if (!p) throw new Error(`unexpected open #${i} (maxId=${String(maxId)})`)
    return p
  }
  return { open, opened }
}

function fakeStatus(uri: string, id: string): mastodon.v1.Status {
  return {
    uri,
    id,
    content: `content ${id}`,
    createdAt: '2024-01-01T00:00:00.000Z',
    spoilerText: '',
    url: `https://x/${id}`,
    mediaAttachments: [],
    account: {
      acct: 'tester',
      displayName: 'Tester',
      avatarStatic: 'https://x/avatar.png',
      url: 'https://x/@tester'
    }
  } as unknown as mastodon.v1.Status
}

function makeStore(favourite: MarkedPosition = { backfill: 'top', catchup: 'idle' }): StatusStore {
  return {
    account: {} as never,
    position: { statusMinId: '0', favourite, bookmark: { backfill: 'top', catchup: 'idle' } },
    statuses: {}
  }
}

// Pre-seed an already-stored favourite, so a catch-up reaching it sees a fully
// known page (its stop signal).
function seedFavourite(store: StatusStore, uri: string, id: string) {
  store.statuses[uri] = { content: 'x', createdAt: '', types: ['favourite'], acct: 'tester', id }
}

// The favourite cursor pair as persisted at each save, snapshotted at call time
// (the store is mutated in place; each assignment makes a fresh cursor object, so
// a shallow clone is a faithful point-in-time copy).
let saved: MarkedPosition[]

beforeEach(() => {
  saved = []
  vi.spyOn(sessions, 'saveStore').mockImplementation(async (s: StatusStore) => {
    saved.push({ ...s.position.favourite })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchMarked — backfill pass', () => {
  it('first sync backfills from the top to the bottom, then catches up', async () => {
    const store = makeStore()
    const { open, opened } = opener([
      new FakePaginator(
        [[fakeStatus('u1', '1'), fakeStatus('u2', '2')], [fakeStatus('u3', '3')], []],
        ['c1', 'c2', undefined]
      ),
      new FakePaginator([[fakeStatus('u1', '1')]], ['cx']) // catch-up: page already known
    ])

    await fetchMarked(store, open, 'favourite')

    expect(opened).toEqual([undefined, undefined]) // backfill from top, then catch-up from top
    expect(Object.keys(store.statuses).sort()).toEqual(['u1', 'u2', 'u3'])
    expect(store.statuses['u1'].types).toContain('favourite')
    expect(store.position.favourite).toEqual({ backfill: 'done', catchup: 'idle' })
  })

  it('resumes an interrupted backfill from its saved cursor, not the top', async () => {
    const store = makeStore({ backfill: { maxId: 'resume-me' }, catchup: 'idle' })
    const { open, opened } = opener([
      new FakePaginator([[fakeStatus('u5', '5')], []], ['c3', undefined]),
      new FakePaginator([[fakeStatus('u5', '5')]], ['cx']) // catch-up all-known
    ])

    await fetchMarked(store, open, 'favourite')

    expect(opened).toEqual(['resume-me', undefined])
    expect(store.statuses['u5'].types).toContain('favourite')
    expect(store.position.favourite).toEqual({ backfill: 'done', catchup: 'idle' })
  })

  it('keeps the last cursor when a backfill fails, so it resumes without re-fetching', async () => {
    const store = makeStore()
    const { open } = opener([
      new FakePaginator(
        [[fakeStatus('u1', '1')], [fakeStatus('u2', '2')]],
        ['c1', 'c2'],
        1 // throw after one page
      )
    ])

    await expect(fetchMarked(store, open, 'favourite')).rejects.toThrow()

    expect(store.statuses['u1']).toBeDefined()
    expect(store.statuses['u2']).toBeUndefined() // never reached
    // Last persisted state is the resume point; catch-up never ran.
    expect(saved.at(-1)).toEqual({ backfill: { maxId: 'c1' }, catchup: 'idle' })
    expect(store.position.favourite).toEqual({ backfill: { maxId: 'c1' }, catchup: 'idle' })
  })
})

describe('fetchMarked — catch-up pass', () => {
  it('walks from the top and stops at the first all-known page', async () => {
    const store = makeStore({ backfill: 'done', catchup: 'idle' })
    seedFavourite(store, 'u1', '1') // covered region
    const { open, opened } = opener([
      new FakePaginator([[fakeStatus('u9', '9')], [fakeStatus('u1', '1')]], ['c9', 'c1'])
    ])

    await fetchMarked(store, open, 'favourite')

    expect(opened).toEqual([undefined]) // backfill done → only catch-up, from the top
    expect(store.statuses['u9'].types).toContain('favourite') // new top entry pulled
    expect(store.position.favourite).toEqual({ backfill: 'done', catchup: 'idle' })
  })

  it('resumes an interrupted catch-up from its cursor, not the top', async () => {
    const store = makeStore({ backfill: 'done', catchup: { maxId: 'mid' } })
    seedFavourite(store, 'u1', '1')
    const { open, opened } = opener([
      new FakePaginator([[fakeStatus('u8', '8')], [fakeStatus('u1', '1')]], ['c8', 'c1'])
    ])

    await fetchMarked(store, open, 'favourite')

    expect(opened).toEqual(['mid']) // resumed from the saved catch-up cursor
    expect(store.statuses['u8']).toBeDefined()
    expect(store.position.favourite).toEqual({ backfill: 'done', catchup: 'idle' })
  })

  it('keeps the last cursor when a catch-up fails, so it resumes without re-fetching', async () => {
    const store = makeStore({ backfill: 'done', catchup: 'idle' })
    const { open } = opener([
      new FakePaginator([[fakeStatus('u7', '7')], [fakeStatus('u6', '6')]], ['c7', 'c6'], 1)
    ])

    await expect(fetchMarked(store, open, 'favourite')).rejects.toThrow()

    expect(store.statuses['u7']).toBeDefined()
    expect(saved.at(-1)).toEqual({ backfill: 'done', catchup: { maxId: 'c7' } })
    expect(store.position.favourite).toEqual({ backfill: 'done', catchup: { maxId: 'c7' } })
  })
})

describe('fetchMarked — backfill then catch-up in one run', () => {
  it('after the backfill reaches the bottom, the same run catches up new top entries', async () => {
    const store = makeStore({ backfill: { maxId: 'resume' }, catchup: 'idle' })
    seedFavourite(store, 'old', '50') // top of the covered region
    const { open, opened } = opener([
      new FakePaginator([[fakeStatus('older', '1')], []], ['cb', undefined]), // backfill to bottom
      new FakePaginator(
        [[fakeStatus('fresh', '99')], [fakeStatus('old', '50')]],
        ['cf', 'cold']
      ) // catch-up: a new top entry, then the covered region
    ])

    await fetchMarked(store, open, 'favourite')

    expect(opened).toEqual(['resume', undefined])
    expect(store.statuses['older']).toBeDefined() // backfilled below
    expect(store.statuses['fresh']).toBeDefined() // caught up above, same run — the closed gap
    expect(store.position.favourite).toEqual({ backfill: 'done', catchup: 'idle' })
  })
})

describe('fetchMarked — legacy single-cursor migration', () => {
  it('migrates a completed cursor (0) to a finished backfill', async () => {
    const store = makeStore()
    const pos = store.position as unknown as Record<string, unknown>
    delete pos.favourite // simulate an old store: flat field, no two-cursor shape
    pos.favouriteMaxId = '0'
    const { open, opened } = opener([new FakePaginator([[]], [undefined])]) // catch-up from top, empty

    await fetchMarked(store, open, 'favourite')

    expect(opened).toEqual([undefined]) // backfill 'done' → only catch-up ran
    expect(store.position.favourite).toEqual({ backfill: 'done', catchup: 'idle' })
    expect(pos.favouriteMaxId).toBeUndefined() // legacy field cleaned up
  })

  it('migrates an interrupted cursor (real id) to a resumable backfill', async () => {
    const store = makeStore()
    const pos = store.position as unknown as Record<string, unknown>
    delete pos.favourite
    pos.favouriteMaxId = 'half-done'
    const { open, opened } = opener([
      new FakePaginator([[]], [undefined]), // backfill resumes from 'half-done', already at bottom
      new FakePaginator([[]], [undefined]) // catch-up from top, empty
    ])

    await fetchMarked(store, open, 'favourite')

    expect(opened).toEqual(['half-done', undefined])
    expect(store.position.favourite).toEqual({ backfill: 'done', catchup: 'idle' })
  })
})

describe('nextMaxId', () => {
  it('extracts max_id from the paginator nextParams query string', () => {
    expect(nextMaxId({ nextParams: 'limit=40&max_id=12345' } as unknown as AsyncIterable<unknown>)).toBe('12345')
  })

  it('returns undefined when nextParams is absent, non-string, or has no max_id', () => {
    expect(nextMaxId({} as unknown as AsyncIterable<unknown>)).toBeUndefined()
    expect(nextMaxId({ nextParams: 123 } as unknown as AsyncIterable<unknown>)).toBeUndefined()
    expect(nextMaxId({ nextParams: 'limit=40' } as unknown as AsyncIterable<unknown>)).toBeUndefined()
  })
})
