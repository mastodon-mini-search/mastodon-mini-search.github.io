import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mastodon } from 'masto'
import { fetchMarked, nextMaxId } from '../../src/functions/fetchStatuses'
import { StatusStore } from '../../src/models/StatusStore'
import sessions from '../../src/functions/sessions'

// A stand-in for masto's PaginatorHttp. The real one keeps the *next* page's
// Link in a private `nextParams` query string, updated each time a page is
// fetched; fetchMarked reads max_id out of it to persist a resume cursor. We
// model just that: yield the given pages, and after each one expose the matching
// `nextParams` (or undefined to simulate a missing/unreadable Link).
class FakePaginator implements AsyncIterable<mastodon.v1.Status[]> {
  nextParams: string | undefined
  calls = 0
  private i = 0
  constructor(
    private pages: mastodon.v1.Status[][],
    private cursors: (string | undefined)[]
  ) {}
  [Symbol.asyncIterator]() {
    return this
  }
  async next(): Promise<IteratorResult<mastodon.v1.Status[]>> {
    this.calls++
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

function makeStore(favouriteMaxId = '0'): StatusStore {
  return {
    account: {} as never,
    position: { statusMinId: '0', favouriteMaxId, bookmarkMaxId: '0' },
    statuses: {}
  }
}

// Cursor value seen by saveStore at each call, captured at call time (the store
// is mutated in place, so we snapshot synchronously inside the spy).
let savedCursors: string[]

beforeEach(() => {
  savedCursors = []
  vi.spyOn(sessions, 'saveStore').mockImplementation(async (s: StatusStore) => {
    savedCursors.push(s.position.favouriteMaxId)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchMarked resume cursor', () => {
  it('walks from the top, saves each page cursor, then clears on completion', async () => {
    const store = makeStore('0')
    let openedWith: string | undefined | 'UNSET' = 'UNSET'
    const paginator = new FakePaginator(
      [
        [fakeStatus('u1', '1'), fakeStatus('u2', '2')],
        [fakeStatus('u3', '3'), fakeStatus('u4', '4')],
        [] // end
      ],
      ['c1', 'c2', undefined]
    )

    await fetchMarked(store, maxId => { openedWith = maxId; return paginator }, 'favourite', 'favouriteMaxId')

    expect(openedWith).toBeUndefined() // '0' cursor → start from the top
    expect(Object.keys(store.statuses).sort()).toEqual(['u1', 'u2', 'u3', 'u4'])
    expect(store.statuses['u1'].types).toContain('favourite')
    // c1/c2 persisted per page, then cleared back to '0' on the empty page.
    expect(savedCursors).toEqual(['c1', 'c2', '0'])
    expect(store.position.favouriteMaxId).toBe('0')
  })

  it('resumes from the saved cursor instead of the top', async () => {
    const store = makeStore('resume-me')
    let openedWith: string | undefined | 'UNSET' = 'UNSET'
    const paginator = new FakePaginator([[fakeStatus('u5', '5')], []], ['c3', undefined])

    await fetchMarked(store, maxId => { openedWith = maxId; return paginator }, 'favourite', 'favouriteMaxId')

    expect(openedWith).toBe('resume-me')
    expect(savedCursors).toEqual(['c3', '0'])
    expect(store.position.favouriteMaxId).toBe('0')
  })

  it('stops at the first all-known page and clears the cursor', async () => {
    const store = makeStore('0')
    // Pre-seed u1 as an already-stored favourite, so page 0 is entirely known.
    store.statuses['u1'] = { content: 'x', createdAt: '', types: ['favourite'], acct: 'tester', id: '1' }
    const paginator = new FakePaginator(
      [[fakeStatus('u1', '1')], [fakeStatus('u2', '2')]],
      ['c1', 'c2']
    )

    await fetchMarked(store, () => paginator, 'favourite', 'favouriteMaxId')

    expect(paginator.calls).toBe(1) // fetched page 0 only, then stopped
    expect(store.statuses['u2']).toBeUndefined() // never reached page 1
    // No per-page save before the all-known break — only the final clear.
    expect(savedCursors).toEqual(['0'])
    expect(store.position.favouriteMaxId).toBe('0')
  })

  it('falls back to a single end-save when max_id is unreadable', async () => {
    const store = makeStore('0')
    const paginator = new FakePaginator([[fakeStatus('u1', '1')], []], [undefined, undefined])

    await fetchMarked(store, () => paginator, 'favourite', 'favouriteMaxId')

    // nextParams unreadable → no mid-walk cursor saves, just the final clear.
    expect(savedCursors).toEqual(['0'])
    expect(store.statuses['u1'].types).toContain('favourite') // still stored
    expect(store.position.favouriteMaxId).toBe('0')
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
