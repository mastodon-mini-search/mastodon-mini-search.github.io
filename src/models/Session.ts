import { ResolvedAccountSetting } from "./AccountSetting"

// The account registry: which accounts are known, and which one is active.
// Each account's toots live under its own key (see `storeKey`); this small
// record is the only piece of cross-account state.
export interface SessionRegistry {
  accounts: ResolvedAccountSetting[]
  activeKey: string | null
}
