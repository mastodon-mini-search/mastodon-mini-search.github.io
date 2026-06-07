import { StatusStore } from "../models/StatusStore"
import resolveAccount from "./resolveAccount"

export default async function(store: StatusStore, acct: string) {
  const resolvedAccount = await resolveAccount(acct)
  if (resolvedAccount.accountId === store.account.accountId && resolvedAccount.instanceUrl === store.account.instanceUrl) {

  } else {
    store.account = resolvedAccount
    store.statuses = {}
    store.position = {
      statusMinId: '0',
      favouriteMaxId: '0',
      bookmarkMaxId: '0'
    }
  }
}