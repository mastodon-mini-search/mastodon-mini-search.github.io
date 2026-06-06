import { createRestAPIClient, createOAuthAPIClient } from "masto"
import { ResolvedAccountSetting } from "../models/AccountSetting"
import sessions from "./sessions"

// Shown to the user on the instance's authorization screen and listed under
// their account's "Authorized apps".
const APP_NAME = "mastodon-mini-search.github.io"
// `read` covers everything this app needs — own statuses, favourites and
// bookmarks — and nothing it doesn't (no write/follow/push).
const SCOPE = "read"

// Accept anything the user might paste — `user@instance`, `@user@instance`,
// `instance.tld`, or a full `https://instance` URL — and reduce it to the
// instance origin we register and authorize against.
export function instanceUrlOf(input: string): string {
  let host = input.trim().replace(/^@/, "")
  // Strip scheme and path first, so a pasted profile URL like
  // `https://fsk.im/@merely` reduces to the host rather than to `merely`.
  host = host.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  if (host.includes("@")) {
    host = host.split("@").pop() ?? "" // user@instance → instance
  }
  return `https://${host}`
}

// The page itself is the OAuth redirect target. Strip query/hash so the value
// is stable across the register → authorize → token round-trip (the instance
// rejects any mismatch). Computed identically on both legs of the flow, so the
// browser always lands back on exactly the URI we registered.
function redirectUri(): string {
  return window.location.origin + window.location.pathname
}

// Drop the `?code=&state=` (or `?error=`) the instance appended, leaving a clean
// URL so a reload can't re-trigger the exchange.
function cleanUrl(): void {
  window.history.replaceState({}, document.title, redirectUri())
}

// Step 1: register the app on the instance (or reuse a cached registration),
// stash the in-flight login, then navigate to the instance's consent screen.
// Returns by leaving the page; control resumes in completeLoginFromRedirect
// once the browser comes back.
export async function beginLogin(input: string): Promise<void> {
  const instanceUrl = instanceUrlOf(input)
  const redirect = redirectUri()

  let app = await sessions.loadOAuthApp(instanceUrl)
  // Re-register if the cached app was minted for a different redirect URI or
  // scope (e.g. the app moved to a new path) — the old credentials wouldn't be
  // accepted for this redirect.
  if (!app || app.redirectUri !== redirect || app.scope !== SCOPE) {
    const created = await createRestAPIClient({ url: instanceUrl }).v1.apps.create({
      clientName: APP_NAME,
      redirectUris: redirect,
      scopes: SCOPE,
      website: redirect
    })
    app = {
      instanceUrl,
      clientId: created.clientId ?? "",
      clientSecret: created.clientSecret ?? "",
      redirectUri: redirect,
      scope: SCOPE
    }
    await sessions.saveOAuthApp(app)
  }

  const state = crypto.randomUUID()
  await sessions.savePendingAuth({ instanceUrl, state, redirectUri: redirect, scope: SCOPE })

  const authorize = new URL("/oauth/authorize", instanceUrl)
  authorize.searchParams.set("client_id", app.clientId)
  authorize.searchParams.set("redirect_uri", redirect)
  authorize.searchParams.set("response_type", "code")
  authorize.searchParams.set("scope", SCOPE)
  authorize.searchParams.set("state", state)
  window.location.assign(authorize.toString())
}

// Step 2: run on every page load. Returns the authenticated account (with its
// fresh `apiKey`) when this load is an OAuth callback, or null on a normal load
// or a failed/denied/forged callback. Always clears the pending record and
// cleans the URL so a stray callback can't linger or replay.
export async function completeLoginFromRedirect(): Promise<ResolvedAccountSetting | null> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get("code")
  const state = params.get("state")
  const error = params.get("error")
  if (!code && !error) {
    return null // ordinary load, not a callback
  }

  const pending = await sessions.loadPendingAuth()
  await sessions.clearPendingAuth()
  cleanUrl()

  // Reject denials, missing codes, and state mismatches (stale or forged).
  if (error || !code || !pending || pending.state !== state) {
    return null
  }
  const app = await sessions.loadOAuthApp(pending.instanceUrl)
  if (!app) {
    return null
  }

  // A failed exchange / verify (network hiccup, revoked app, instance down)
  // returns null rather than throwing, so the caller falls back to a normal
  // load instead of getting stuck behind Main's Suspense boundary.
  try {
    const token = await createOAuthAPIClient({ url: pending.instanceUrl }).token.create({
      grantType: "authorization_code",
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      redirectUri: pending.redirectUri,
      code,
      scope: pending.scope
    })

    // Confirm the token works and learn who we are (id is needed to page the
    // account's own statuses).
    const me = await createRestAPIClient({
      url: pending.instanceUrl,
      accessToken: token.accessToken
    }).v1.accounts.verifyCredentials()

    const host = new URL(pending.instanceUrl).host
    return {
      instanceUrl: pending.instanceUrl,
      // verifyCredentials returns the bare username for a local account; qualify
      // it with the instance host so it displays as `user@instance`.
      acct: me.acct.includes("@") ? me.acct : `${me.username}@${host}`,
      accountId: me.id,
      apiKey: token.accessToken
    }
  } catch {
    return null
  }
}
