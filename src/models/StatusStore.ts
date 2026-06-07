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

// A walk paused mid-list: the Link-header max_id of the next page to fetch.
// Distinct from the sentinels below so a real record id can never be mistaken for
// one (and vice versa).
export interface ResumeCursor {
  maxId: string
}

// Backfill toward the *oldest* entry. 'top' = first sync not started (walk from
// the top); 'done' = reached the oldest entry; a ResumeCursor = an interrupted
// backfill to continue from. Advances + persists per page, so a failure resumes
// without re-fetching.
export type BackfillCursor = 'top' | 'done' | ResumeCursor

// Catch up *new* entries at the top, run once backfill is 'done'. 'idle' = start
// a fresh walk from the top next run; a ResumeCursor = an interrupted catch-up to
// continue from (so it skips the pages it already pulled). Cleared back to 'idle'
// once it reaches entries it already has (or the bottom).
export type CatchupCursor = 'idle' | ResumeCursor

// Favourites/bookmarks have no status-id cursor (see fetchStatuses): they page by
// an instance-internal record id carried only in the Link header. Each is fetched
// in two independently-resumable passes, so it carries both cursors.
export interface MarkedPosition {
  backfill: BackfillCursor
  catchup: CatchupCursor
}

export interface LoadedPosition {
  // Own posts resume by status id: the newest one seen, so we only pull newer.
  statusMinId: string
  favourite: MarkedPosition
  bookmark: MarkedPosition
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