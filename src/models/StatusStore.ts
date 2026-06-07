import { ResolvedAccountSetting } from "./AccountSetting"

export type StatusType = 'post' | 'boost' | 'favourite' | 'bookmark'

export interface MediaItem {
  type: string            // image | video | gifv | audio | unknown
  url: string             // full media, used as the link target
  previewUrl: string      // thumbnail
  description: string | null // alt text — searchable
}

export interface StatusDocument {
  content: string
  createdAt: string
  types: StatusType[]
  acct: string
  id: string
  // Optional: absent on toots fetched before these fields were added. Read
  // defensively (`?? ''` / `?? []`) — never assume present.
  url?: string | null     // canonical permalink (correct for boosts/cross-instance)
  spoilerText?: string    // content warning
  media?: MediaItem[]
}

export interface LoadedPosition {
  // Own posts resume by status id: the newest one seen, so we only pull newer.
  statusMinId: string
  // Favourites/bookmarks resume by the Link-header max_id of the next page to
  // fetch — they have no status-id cursor (see fetchStatuses). '0' means "no run
  // in progress, start from the top"; a real id means an interrupted run to
  // continue backfilling from. Cleared back to '0' on clean completion.
  favouriteMaxId: string
  bookmarkMaxId: string
}

// Author info, normalized out of StatusDocument (which keeps `acct` as the
// foreign key). Keyed by acct: local authors are `username`, remote ones
// `username@domain`, so it's unique within one home-instance store. Upserted on
// every fetch, so avatars/display names stay current.
export interface AuthorInfo {
  acct: string
  displayName: string
  avatar: string   // avatarStatic — never animated
  url: string      // profile permalink
}

export interface StatusStore {
  account: ResolvedAccountSetting
  position: LoadedPosition,
  statuses: Record<string, StatusDocument>
  // Optional: absent on stores written before authors were captured. Read
  // defensively and fall back to the bare `acct`.
  authors?: Record<string, AuthorInfo>
}