// OAuth2 client credentials, registered once per instance (POST /api/v1/apps)
// and cached so repeat logins on the same instance reuse the same app. The
// `redirectUri` is pinned here because it must match byte-for-byte across the
// register → authorize → token-exchange steps, and the instance rejects any
// mismatch.
export interface OAuthApp {
  instanceUrl: string
  clientId: string
  clientSecret: string
  redirectUri: string
  scope: string
}

// The one login currently in flight. Persisted before we navigate away to the
// instance's authorize page, then read back when the browser returns to the
// redirect URI carrying `?code=&state=`. `state` is a nonce we mint and verify
// on return to reject forged / stale callbacks.
export interface PendingAuth {
  instanceUrl: string
  state: string
  redirectUri: string
  scope: string
}
