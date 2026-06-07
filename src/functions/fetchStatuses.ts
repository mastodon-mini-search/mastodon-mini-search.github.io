import { createRestAPIClient, mastodon } from "masto"
import { StatusStore, StatusType } from "../models/StatusStore"
import sessions from "./sessions"

function saveAuthor(store: StatusStore, account: mastodon.v1.Account) {
  if (!store.authors) {
    store.authors = {}
  }
  // Unconditional upsert (even if the toot was already stored) so avatar /
  // display name stay current as the author updates them.
  store.authors[account.acct] = {
    acct: account.acct,
    displayName: account.displayName,
    avatar: account.avatarStatic,
    url: account.url
  }
}

function saveStatus(store: StatusStore, status: mastodon.v1.Status) {
  saveAuthor(store, status.account)
  if (store.statuses[status.uri]) {

  } else {
    store.statuses[status.uri] = {
      content: status.content,
      createdAt: status.createdAt,
      types: [],
      acct: status.account.acct,
      id: status.id,
      url: status.url ?? null,
      spoilerText: status.spoilerText,
      media: status.mediaAttachments.map(m => ({
        type: m.type,
        url: m.url ?? '',
        previewUrl: m.previewUrl,
        description: m.description ?? null
      }))
    }
  }
}

function markType(store: StatusStore, uri: string, type: StatusType) {
  const stored = store.statuses[uri]
  if (stored.types.includes(type)) {

  } else {
    stored.types.push(type)
  }
}

function client(store: StatusStore): mastodon.rest.Client {
  return createRestAPIClient({
    url: store.account.instanceUrl,
    accessToken: store.account.apiKey
  })
}

// Own posts/boosts page cleanly by status id, so we resume from the newest one
// seen (`statusMinId`) and only pull what's new. We persist after every batch
// (not just at the end): the cursor advances per page, so if the run dies
// mid-way — network drop, rate limit — the next one resumes from where it
// stopped instead of restarting, and the toots fetched so far survive a reload.
// Re-saving the whole store each batch is cheap relative to the network
// round-trip it overlaps, and incremental runs only do a handful of batches.
async function fetchOwnStatuses(
  store: StatusStore,
  masto: mastodon.rest.Client,
  afterBatch?: () => void
) {
  while (true) {
    const batch = await masto.v1.accounts.$select(store.account.accountId).statuses.list({
      limit: 40,
      minId: store.position.statusMinId
    })
    if (batch.length == 0) {
      break
    } else {
      batch.forEach(status => {
        if (status.reblog) {
          saveStatus(store, status.reblog)
          markType(store, status.reblog.uri, 'boost')
        } else {
          saveStatus(store, status)
          markType(store, status.uri, 'post')
        }
      })
      store.position.statusMinId = batch[0].id
      await sessions.saveStore(store)
      if (afterBatch) {
        afterBatch()
      }
    }
  }
}

// masto pages favourites/bookmarks by an instance-internal record id carried
// only in each response's Link header — never on the statuses themselves — and
// surfaces it solely through the paginator's private `nextParams` query string.
// We read it (defensively: any shape change just yields undefined) to persist a
// resume cursor, since there's no status-id cursor to resume by.
export function nextMaxId(paginator: AsyncIterable<unknown>): string | undefined {
  const params = (paginator as { nextParams?: unknown }).nextParams
  if (typeof params !== 'string') {
    return undefined
  }
  return new URLSearchParams(params).get('max_id') ?? undefined
}

// Favourites and bookmarks resume by the Link-header max_id (see nextMaxId),
// persisted in `store.position[cursor]`. Each run walks newest-first: from the
// saved cursor if a run was interrupted (keep backfilling older entries), else
// from the top. It stops at the first page that's entirely statuses we've already
// stored under this type (caught up to a previously-completed block) or at the
// empty page past the end, then clears the cursor so the next run starts fresh
// from the top (first run on an empty store has nothing known, so it pulls the
// whole list). Persisting the cursor + store after each page makes a mid-run
// failure resumable; the one gap is entries added at the very top *during* an
// interruption window, which a later top-walk picks up.
export async function fetchMarked(
  store: StatusStore,
  open: (maxId: string | undefined) => AsyncIterable<mastodon.v1.Status[]>,
  type: StatusType,
  cursor: 'favouriteMaxId' | 'bookmarkMaxId',
  afterBatch?: () => void
) {
  const pending = store.position[cursor]
  const pages = open(pending && pending !== '0' ? pending : undefined)
  for await (const page of pages) {
    if (page.length == 0) {
      break
    }
    let allKnown = true
    page.forEach(status => {
      const known = !!store.statuses[status.uri] && store.statuses[status.uri].types.includes(type)
      saveStatus(store, status)
      markType(store, status.uri, type)
      if (!known) {
        allKnown = false
      }
    })
    if (afterBatch) {
      afterBatch()
    }
    if (allKnown) {
      break
    }
    // The paginator has already advanced to the next page's Link, so this is the
    // max_id for the page *after* the one we just stored — exactly where a resume
    // should pick up. If we can't read it, skip the per-page save and fall back
    // to the single save at the end: persisting mid-walk without a cursor would
    // let a reload restart from the top and cut the backfill short at the first
    // all-known page.
    const next = nextMaxId(pages)
    if (next !== undefined) {
      store.position[cursor] = next
      await sessions.saveStore(store)
    }
  }
  store.position[cursor] = '0'
  await sessions.saveStore(store)
}

// Each category is fetched on its own, so the UI can pull posts quickly without
// waiting on a possibly enormous favourites list, and re-run any one of them
// independently. All three persist after every page now, so any of them resumes
// after a failure (own posts by status id, favourites/bookmarks by max_id).

export async function fetchPosts(store: StatusStore, afterBatch?: () => void) {
  // No trailing save: fetchOwnStatuses already persisted every batch, so
  // progress is durable whether this resolves or throws part-way through.
  await fetchOwnStatuses(store, client(store), afterBatch)
}

// Favourites and bookmarks are private endpoints — only reachable with an OAuth
// token. Without one there's nothing to fetch, so we bail before hitting them.
// No trailing save: fetchMarked persists every page and clears the cursor at the
// end, so progress is durable whether this resolves or throws part-way through.
export async function fetchFavourites(store: StatusStore, afterBatch?: () => void) {
  if (!store.account.apiKey) {
    return
  }
  const c = client(store)
  await fetchMarked(
    store,
    maxId => c.v1.favourites.list(maxId ? { limit: 40, maxId } : { limit: 40 }),
    'favourite',
    'favouriteMaxId',
    afterBatch
  )
}

export async function fetchBookmarks(store: StatusStore, afterBatch?: () => void) {
  if (!store.account.apiKey) {
    return
  }
  const c = client(store)
  await fetchMarked(
    store,
    maxId => c.v1.bookmarks.list(maxId ? { limit: 40, maxId } : { limit: 40 }),
    'bookmark',
    'bookmarkMaxId',
    afterBatch
  )
}
