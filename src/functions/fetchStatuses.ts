import { createRestAPIClient, mastodon } from "masto"
import { StatusStore, StatusType, MarkedPosition } from "../models/StatusStore"
import sessions from "./sessions"

type MarkedType = 'favourite' | 'bookmark'

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

// Store one page of a marked category, returning whether every status was already
// known under this type — the signal a catch-up has reached covered ground.
function storePage(store: StatusStore, page: mastodon.v1.Status[], type: MarkedType): boolean {
  let allKnown = true
  page.forEach(status => {
    const known = !!store.statuses[status.uri] && store.statuses[status.uri].types.includes(type)
    saveStatus(store, status)
    markType(store, status.uri, type)
    if (!known) {
      allKnown = false
    }
  })
  return allKnown
}

// Read a category's two cursors, migrating a legacy single-cursor `${type}MaxId`
// in place. Old '0' meant "completed (or never started)" — treat as a finished
// backfill so existing users don't re-pull their whole list; a real id was an
// interrupted backfill, so resume it. Neither field present = a brand-new store.
function markedPosition(store: StatusStore, type: MarkedType): MarkedPosition {
  const pos = store.position as unknown as {
    favourite?: MarkedPosition
    bookmark?: MarkedPosition
    favouriteMaxId?: string
    bookmarkMaxId?: string
  }
  let cur = pos[type]
  if (!cur) {
    const legacy = pos[`${type}MaxId`]
    cur =
      typeof legacy === 'string' && legacy !== '0'
        ? { backfill: { maxId: legacy }, catchup: 'idle' }
        : { backfill: legacy === '0' ? 'done' : 'top', catchup: 'idle' }
    pos[type] = cur
    delete pos[`${type}MaxId`]
  }
  return cur
}

// Favourites/bookmarks are fetched in two independently-resumable passes, both
// paging newest→oldest by the Link-header max_id (see nextMaxId):
//
//   1. Backfill — pull the whole list once, top→bottom. 'top' starts a fresh
//      sync; a saved cursor resumes an interrupted one. Each page advances and
//      persists the cursor, so a mid-run failure resumes without re-fetching;
//      reaching the end flips it to 'done'.
//   2. Catch-up (only once backfill is 'done') — pull entries newer than what we
//      have: walk from the top until a page is entirely already-stored (caught up
//      to the covered region) or the list ends. It persists its own cursor per
//      page too, so it's resumable without re-fetching the pages already pulled.
//
// Two cursors, because the passes have separate live frontiers — the top and the
// bottom of one contiguous covered block. The lone residual gap: entries added at
// the very top *during* a catch-up interruption are skipped until the next run
// starts catch-up fresh from the top — a narrow, self-healing window.
export async function fetchMarked(
  store: StatusStore,
  open: (maxId: string | undefined) => AsyncIterable<mastodon.v1.Status[]>,
  type: MarkedType,
  afterBatch?: () => void
) {
  const pos = markedPosition(store, type)

  if (pos.backfill !== 'done') {
    const pages = open(pos.backfill === 'top' ? undefined : pos.backfill.maxId)
    for await (const page of pages) {
      if (page.length == 0) {
        break
      }
      storePage(store, page, type)
      if (afterBatch) {
        afterBatch()
      }
      // The paginator has already advanced to the next page's Link, so this is the
      // max_id for the page *after* the one we just stored — where a resume picks
      // up. If unreadable, leave the cursor and fall back to the next save.
      const next = nextMaxId(pages)
      if (next !== undefined) {
        pos.backfill = { maxId: next }
        await sessions.saveStore(store)
      }
    }
    pos.backfill = 'done'
    await sessions.saveStore(store)
  }

  // Backfill is 'done' now (already, or just finished above), so catch up the top.
  const pages = open(pos.catchup === 'idle' ? undefined : pos.catchup.maxId)
  for await (const page of pages) {
    if (page.length == 0) {
      break
    }
    const allKnown = storePage(store, page, type)
    if (afterBatch) {
      afterBatch()
    }
    if (allKnown) {
      break
    }
    const next = nextMaxId(pages)
    if (next !== undefined) {
      pos.catchup = { maxId: next }
      await sessions.saveStore(store)
    }
  }
  // Reached the covered region, the bottom, or the end of the paginator — all mean
  // caught up; restart from the top next run. A failure throws out before here,
  // leaving the last persisted cursor to resume from.
  pos.catchup = 'idle'
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
    afterBatch
  )
}
