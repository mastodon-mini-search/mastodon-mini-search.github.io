# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, front-end-only Vue 3 + TypeScript + Vite SPA (deployed to GitHub Pages, no backend). It pulls a Mastodon user's own posts/boosts, favourites, and bookmarks from their instance, builds a **client-side** full-text index (a hand-rolled flat inverted index, BM25-ranked), and searches it locally. Everything — toots, the serialized index, OAuth credentials — persists in the browser via localforage (IndexedDB). The headline feature is dictionary-free Chinese search with traditional↔simplified equivalence. The UI is in Traditional Chinese.

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

Tests run under `happy-dom` (configured in `vite.config.ts`) because `stripHTML` and `createIndex` use real DOM APIs (`document.createElement`). Deployment is automatic: pushing to `main` triggers `.github/workflows/` to build and publish `dist/` to GitHub Pages.

## Architecture

The code is layered bottom-up. Each layer only knows about the one below it.

1. **Persistence seam — `src/functions/sessions.ts`.** A single `SessionRepository` over an injectable `KeyValueStore` (localforage in production, an in-memory map in tests). **All storage keys are defined here and nowhere else** — components and other functions go through this repo, never localforage directly. Key namespaces: `sessions` (the registry of accounts + active pointer), `store:<instanceUrl>:<accountId>` (one account's toots), `index:<...>` (that account's serialized search index), `oauth-app:<instanceUrl>` and `oauth-pending`. `accountId` is only unique within an instance, so keys must carry the instance — see `storeKey`. There's a one-time migration from a pre-multi-account single `store` blob in `loadRegistry`.

2. **Data fetching — `src/functions/fetchStatuses.ts`.** Mutates a `StatusStore` in place and persists it once per category. The three categories (`fetchPosts`/`fetchFavourites`/`fetchBookmarks`) are fetched independently so the UI isn't blocked on a huge favourites list. Two different paging strategies, because the API forces it: own posts resume by status id (`statusMinId`); favourites/bookmarks have no resumable status-id cursor, so they walk newest-first and stop at the first page that's entirely already-seen toots. Favourites/bookmarks are private endpoints — they bail without an OAuth token.

3. **Search index — a hand-rolled flat inverted index (`src/functions/flatIndex.ts` + `searchFlat.ts` + `createIndex.ts` + `tokenize.ts`), run inside a worker.** It replaced MiniSearch: same ranking, but a **reconstruction-free** persisted format. `tokenize` runs for **both** indexing and querying so the two can't drift; `searchFlat` reproduces what MiniSearch did under our old options — `combineWith: 'AND'`, BM25+ (`k=1.2,b=0.7,d=0.5`), fuzzy only for non-CJK terms (ratio 0.35, capped at `maxFuzzy 4`) — pinned by `tests/functions/flatIndexParity.spec.ts` against a real MiniSearch (same hit set, same order, same matched terms). The index is a **derived, throwaway cache**: `cacheMatches` cheaply gates a cached blob (version + document count), and a mismatch — or an inconsistent/truncated blob the worker fails to wrap — rebuilds from toots; `indexDocs` grows it incrementally after a fetch.

   **The whole reason for the rewrite: cold-start restore was the freeze.** MiniSearch's `loadJSON` was multi-second on a ~4000-toot CJK corpus (≈2.6 s desktop, ~10 s mobile) — almost all `SearchableMap` radix-tree reconstruction, not `JSON.parse` — and shrinking term count would have wrecked CJK quality. The flat format sidesteps it: the index serializes to plain **`ArrayBuffer`s** (sorted UTF-8 term dictionary + `Int32Array` postings + doc table; see `models/PersistedIndex.ts`), which IndexedDB structured-clones as-is, so **restore is wrapping the buffers in typed-array views (~0.2 ms), not rebuilding a tree**. Two internal shapes share one search algorithm via the `IndexView` interface: `FlatIndexBuilder` (mutable — build/grow; term→postings `Map`s) and `FlatIndexView` (read-only — restore; binary-searches the term dict, fuzzy-scans only the small non-CJK term subset). Search still runs in the worker (keeps the page responsive, single owner of the live index), so it's async — even though restore is now cheap. The seam is the **`IndexEngine`** interface (`indexEngine.ts`): production uses `createWorkerEngine` (`indexWorkerEngine.ts`), an RPC client over one persistent worker (`indexWorker.ts`) reused across account switches; tests inject `createInProcessEngine`. Both wrap the same stateful **`IndexHolder`** (`indexHolder.ts`), which does restore/build/grow/search/clear synchronously and DOM-free. The split is forced by the DOM: `extractDocs` strips HTML on the **main thread** (a worker has no `document`) and hands the worker plain `IndexDoc[]`; everything crossing the boundary is plain serializable data (docs in; the serialized buffer bundle for caching, or `SearchHit[]` = `{id,score,terms}`, out). A `grow` after a cache hit rebuilds the view back into a builder once (`FlatIndexBuilder.fromData`) — off the cold-start path.

4. **OAuth — `src/functions/oauth.ts`.** Pure front-end OAuth via Mastodon dynamic app registration (works on static hosting). `beginLogin` registers/reuses an app and redirects away to the instance's consent screen; `completeLoginFromRedirect` runs on every page load and finishes the exchange when the URL carries `?code=&state=`. The `redirect_uri` is `location.origin + location.pathname` and must be byte-identical across register/authorize/token.

5. **Composables — `src/composables/`.** Reactive orchestration sitting between functions and components. `useSessions` is a **module-level singleton** (shared app-wide session state — `activeStore`, `accounts`, `busy`) so `Main` and `AccountSwitcher` mutate the same state with no event seam. `useSearchIndex` owns the index lifecycle (restore/build/grow/clear) and exposes `ready` (is there a usable index for the active account?), a `building` flag, and an async `search`. Every engine call is async, so it uses a **generation guard** so a load/grow that finishes after the active account changed can't republish a stale index; it also mirrors which uris are indexed so a `grow` strips and ships only the new toots. The **`IndexEngine` is injected** (default = `createWorkerEngine`) so tests run the index in-process. `useSearch` owns the search box, debounce, committed query, type filter, and sort order (relevance — the engine's own BM25 score order, the default — or newest/oldest by `createdAt`); since `search` round-trips to the worker it's async, guarded by a **run token** so a superseded run (later keystroke or account switch via `reset`) can't publish stale results. Filter and sort are viewing preferences that survive `reset` (they persist across accounts); only the query/results clear.

6. **Components — `src/components/`.** `App.vue` wraps `Main` in `<Suspense>`, whose fallback covers only the **session bootstrap** (Main's `setup` awaits `bootstrap()` before first paint — fast storage I/O). The index build is deliberately *not* awaited in setup: the shell paints, the worker builds, and `Main` shows a `building` indicator in place of the search box meanwhile. `Main.vue` is mostly wiring: it composes the three composables and reacts to the active account changing (clear search + index first, then rebuild). `Loader.vue` only fetches and emits `loadComplete`; it never touches the index — that's the parent's job via `useSearchIndex.grow`.

## Cross-cutting contracts (easy to break)

- **Bump `INDEX_VERSION` in `createIndex.ts`** whenever you change tokenization, the search semantics / BM25 (`searchFlat.ts`), the serialized buffer format (`flatIndex.ts` / `models/PersistedIndex.ts`), or which text feeds the index (body / CW / alt text). Stale caches tagged with an old version are discarded and rebuilt; skipping the bump serves results from a mismatched index. (Currently `2`; `1` was the MiniSearch-blob format.)
- **`docs/sessions.md` and `docs/tokenization.md` are authoritative specs** (written in Chinese) enforced by `tests/functions/sessions.spec.ts` and `tests/functions/tokenize.spec.ts` et al. If you change session semantics or tokenization behavior, update the spec and its tests together.
- **Switching accounts is non-destructive.** `setActive`/`switchTo` only move the active pointer; only `removeSession`/`remove` deletes data (and it also drops the derived `index:` cache so it can't outlive its toots).
- **Read newer `StatusStore` fields defensively** (`url`, `spoilerText`, `media`, `authors`) — they're absent on stores written by older builds (`?? ''` / `?? []` / fall back to bare `acct`).
- **Tokenization pipeline** (`tokenize.ts`): NFKC-normalize → insert spaces at CJK↔non-CJK boundaries → split on whitespace/punctuation → all-CJK segments get per-char traditional→simplified (`normalizeChinese`, a ~2800-entry single-char table) then unigrams + bigrams; everything else is one token. Case folding is intentionally left to MiniSearch's default `processTerm`. `highlight.ts` reuses the same normalization so highlights align across traditional/simplified and full/half-width.

## Conventions

`models/` holds plain TS interfaces only. `functions/` holds pure-ish logic (DOM-touching but framework-free), unit-tested under `tests/functions/`. `composables/` holds Vue-reactive orchestration, tested under `tests/composables/` using the `withSetup` helper (mounts a headless component so lifecycle hooks like `onBeforeUnmount` actually register). TypeScript is `strict` with `noUnusedLocals`/`noUnusedParameters` on — unused symbols fail the build.
