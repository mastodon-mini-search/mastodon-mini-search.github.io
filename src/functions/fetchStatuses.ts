import { createRestAPIClient, mastodon } from "masto"
import { StatusStore, StatusType } from "../models/StatusStore"
import sessions from "./sessions"

function saveStatus(store: StatusStore, status: mastodon.v1.Status) {
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

export default async function (store: StatusStore, afterBatch?: () => void) {
  const masto = createRestAPIClient({
    url: store.account.instanceUrl,
    accessToken: store.account.apiKey
  })

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
  await sessions.saveStore(store)
}