# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, front-end-only Vue 3 + TypeScript + Vite SPA (deployed to GitHub Pages, no backend). It pulls a Mastodon user's own posts/boosts, favourites, and bookmarks from their instance, builds a **client-side** MiniSearch full-text index, and searches it locally. Everything — toots, the serialized index, OAuth credentials — persists in the browser via localforage (IndexedDB). The headline feature is dictionary-free Chinese search with traditional↔simplified equivalence. The UI is in Traditional Chinese.

## Commands

```sh
npm run dev          # Vite dev server
npm run build        # vue-tsc -b && vite build (typecheck THEN build — this is the only typecheck gate; there is no separate lint step)
npm run preview      # serve the production build
npm test             # vitest run (single pass)
npm run test:watch   # vitest watch
npx vitest run tests/functions/tokenize.spec.ts      # one test file
npx vitest run -t "繁简等价"                          # tests matching a name
```

Tests run under `happy-dom` (configured in `vite.config.ts`) because `stripHTML` and `createIndex` use real DOM APIs (`document.createElement`). Deployment is automatic: pushing to `master` triggers `.github/workflows/` to build and publish `dist/` to GitHub Pages.

## Architecture

The code is layered bottom-up. Each layer only knows about the one below it.

1. **Persistence seam — `src/functions/sessions.ts`.** A single `SessionRepository` over an injectable `KeyValueStore` (localforage in production, an in-memory map in tests). **All storage keys are defined here and nowhere else** — components and other functions go through this repo, never localforage directly. Key namespaces: `sessions` (the registry of accounts + active pointer), `store:<instanceUrl>:<accountId>` (one account's toots), `index:<...>` (that account's serialized search index), `oauth-app:<instanceUrl>` and `oauth-pending`. `accountId` is only unique within an instance, so keys must carry the instance — see `storeKey`. There's a one-time migration from a pre-multi-account single `store` blob in `loadRegistry`.

2. **Data fetching — `src/functions/fetchStatuses.ts`.** Mutates a `StatusStore` in place and persists it once per category. The three categories (`fetchPosts`/`fetchFavourites`/`fetchBookmarks`) are fetched independently so the UI isn't blocked on a huge favourites list. Two different paging strategies, because the API forces it: own posts resume by status id (`statusMinId`); favourites/bookmarks have no resumable status-id cursor, so they walk newest-first and stop at the first page that's entirely already-seen toots. Favourites/bookmarks are private endpoints — they bail without an OAuth token.

3. **Search index — `src/functions/createIndex.ts` + `src/functions/tokenize.ts`.** The MiniSearch `options` object in `createIndex.ts` is the single source of truth for the index shape; building and restoring (`MiniSearch.loadJSON`) must use the *same* options, since custom functions like `tokenize` aren't serialized. The index is a **derived, throwaway cache**: `restoreIndex` validates a cached blob (version, document count, decodability) and rebuilds from toots on any mismatch; `indexNewStatuses` grows it incrementally after a fetch. `tokenize` is passed to MiniSearch and runs for **both** indexing and querying, so the two can't drift.

4. **OAuth — `src/functions/oauth.ts`.** Pure front-end OAuth via Mastodon dynamic app registration (works on static hosting). `beginLogin` registers/reuses an app and redirects away to the instance's consent screen; `completeLoginFromRedirect` runs on every page load and finishes the exchange when the URL carries `?code=&state=`. The `redirect_uri` is `location.origin + location.pathname` and must be byte-identical across register/authorize/token.

5. **Composables — `src/composables/`.** Reactive orchestration sitting between functions and components. `useSessions` is a **module-level singleton** (shared app-wide session state — `activeStore`, `accounts`, `busy`) so `Main` and `AccountSwitcher` mutate the same state with no event seam. `useSearchIndex` owns the index lifecycle (restore/build/grow/clear). `useSearch` owns the search box, debounce, committed query, and type filter.

6. **Components — `src/components/`.** `App.vue` wraps `Main` in `<Suspense>` (Main's `setup` is async — it bootstraps the session before first paint). `Main.vue` is mostly wiring: it composes the three composables and reacts to the active account changing (clear search + index first, then rebuild). `Loader.vue` only fetches and emits `loadComplete`; it never touches the index — that's the parent's job via `useSearchIndex.grow`.

## Cross-cutting contracts (easy to break)

- **Bump `INDEX_VERSION` in `createIndex.ts`** whenever you change tokenization, the MiniSearch options, or which text feeds the index (body / CW / alt text). Stale caches tagged with an old version are discarded and rebuilt; skipping the bump serves results from a mismatched index.
- **`docs/sessions.md` and `docs/tokenization.md` are authoritative specs** (written in Chinese) enforced by `tests/functions/sessions.spec.ts` and `tests/functions/tokenize.spec.ts` et al. If you change session semantics or tokenization behavior, update the spec and its tests together.
- **Switching accounts is non-destructive.** `setActive`/`switchTo` only move the active pointer; only `removeSession`/`remove` deletes data (and it also drops the derived `index:` cache so it can't outlive its toots).
- **Read newer `StatusStore` fields defensively** (`url`, `spoilerText`, `media`, `authors`) — they're absent on stores written by older builds (`?? ''` / `?? []` / fall back to bare `acct`).
- **Tokenization pipeline** (`tokenize.ts`): NFKC-normalize → insert spaces at CJK↔non-CJK boundaries → split on whitespace/punctuation → all-CJK segments get per-char traditional→simplified (`normalizeChinese`, a ~2800-entry single-char table) then unigrams + bigrams; everything else is one token. Case folding is intentionally left to MiniSearch's default `processTerm`. `highlight.ts` reuses the same normalization so highlights align across traditional/simplified and full/half-width.

## Conventions

`models/` holds plain TS interfaces only. `functions/` holds pure-ish logic (DOM-touching but framework-free), unit-tested under `tests/functions/`. `composables/` holds Vue-reactive orchestration, tested under `tests/composables/` using the `withSetup` helper (mounts a headless component so lifecycle hooks like `onBeforeUnmount` actually register). TypeScript is `strict` with `noUnusedLocals`/`noUnusedParameters` on — unused symbols fail the build.
