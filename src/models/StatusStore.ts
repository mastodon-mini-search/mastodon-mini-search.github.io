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
  statusMinId: string
  favouriteMinId: string
  bookmarkMinId: string
}

export interface StatusStore {
  account: ResolvedAccountSetting
  position: LoadedPosition,
  statuses: Record<string, StatusDocument>
}