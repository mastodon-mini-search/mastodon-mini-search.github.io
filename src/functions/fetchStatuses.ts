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

// Own posts/boosts page cleanly by status id, so we resume from the newest one
// seen (`statusMinId`) and only pull what's new.
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
      if (afterBatch) {
        afterBatch()
      }
    }
  }
}

// Favourites and bookmarks page by an internal record id (exposed only via the
// Link header, never on the returned statuses), so we can't resume them by
// status id the way own posts do. Instead we walk newest-first from the top and
// stop at the first page that's entirely statuses we've already stored under
// this type — i.e. where we caught up to last time. The first run (empty store)
// has nothing known, so it pulls the whole list.
async function fetchMarked(
  store: StatusStore,
  pages: AsyncIterable<mastodon.v1.Status[]>,
  type: StatusType,
  afterBatch?: () => void
) {
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
  }
}

export default async function (store: StatusStore, afterBatch?: () => void) {
  const masto = createRestAPIClient({
    url: store.account.instanceUrl,
    accessToken: store.account.apiKey
  })

  await fetchOwnStatuses(store, masto, afterBatch)
  // Favourites and bookmarks are private endpoints — only reachable with an
  // OAuth token. Without one we fetch just the public own-posts timeline.
  if (store.account.apiKey) {
    await fetchMarked(store, masto.v1.favourites.list({ limit: 40 }), 'favourite', afterBatch)
    await fetchMarked(store, masto.v1.bookmarks.list({ limit: 40 }), 'bookmark', afterBatch)
  }
  await sessions.saveStore(store)
}