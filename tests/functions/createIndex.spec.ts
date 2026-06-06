import { describe, it, expect } from 'vitest'
import createIndex, { toPersistedIndex, cacheMatches, indexDocs, extractDocs, INDEX_VERSION } from '../../src/functions/createIndex'
import { StatusStore, StatusDocument } from '../../src/models/StatusStore'

function storeWith(contents: Record<string, string>): StatusStore {
  const statuses: Record<string, StatusDocument> = {}
  for (const [uri, content] of Object.entries(contents)) {
    statuses[uri] = { content, createdAt: '', types: ['post'], acct: 'tester', id: uri }
  }
  return { account: {} as never, position: {} as never, statuses }
}

function ids(store: StatusStore, query: string): string[] {
  return createIndex(store).search(query).map(r => String(r.id))
}

describe('createIndex (end-to-end search)', () => {
  it('matches across traditional/simplified in both directions', () => {
    const store = storeWith({ a: '<p>我的電腦壞了</p>' })
    expect(ids(store, '电脑')).toContain('a')
    expect(ids(store, '電腦')).toContain('a')
  })

  it('does not glue words across paragraph boundaries', () => {
    const store = storeWith({ a: '<p>foo</p><p>bar</p>' })
    expect(ids(store, 'foo')).toContain('a')
    expect(ids(store, 'bar')).toContain('a')
    // The merged token must not exist.
    expect(ids(store, 'foobar')).not.toContain('a')
  })

  it('matches full-width numerals against a half-width query', () => {
    const store = storeWith({ a: '<p>年份２０２４</p>' })
    expect(ids(store, '2024')).toContain('a')
  })

  it('requires all CJK components (AND semantics)', () => {
    const store = storeWith({
      a: '<p>计算机科学</p>',
      b: '<p>我会计算</p>',
    })
    // "计算机" needs the 算机 bigram, which only doc a has.
    expect(ids(store, '计算机')).toEqual(['a'])
  })

  it('indexes the content warning and media alt text', () => {
    const store: StatusStore = {
      account: {} as never,
      position: {} as never,
      statuses: {
        a: {
          content: '<p>普通正文</p>', createdAt: '', types: ['post'], acct: 't', id: 'a',
          spoilerText: '剧透警告',
          media: [{ type: 'image', url: '', previewUrl: '', description: '一只橘猫' }]
        }
      }
    }
    expect(ids(store, '剧透')).toContain('a')   // found via the CW
    expect(ids(store, '橘猫')).toContain('a')   // found via the image alt text
  })
})

describe('cache validity gate (cacheMatches)', () => {
  it('accepts a cache with the current version and a matching document count', () => {
    const store = storeWith({ a: '<p>hello</p>', b: '<p>world</p>' })
    expect(cacheMatches(store, toPersistedIndex(store, createIndex(store)))).toBe(true)
  })

  it('rejects a cache tagged with a different index version', () => {
    const store = storeWith({ a: '<p>hello</p>' })
    const persisted = toPersistedIndex(store, createIndex(store))
    persisted.version = INDEX_VERSION + 1
    expect(cacheMatches(store, persisted)).toBe(false)
  })

  it('rejects a cache whose document count no longer matches the store', () => {
    const store = storeWith({ a: '<p>hello</p>' })
    const persisted = toPersistedIndex(store, createIndex(store))
    // A toot was appended after the index was cached.
    store.statuses['b'] = { content: '<p>world</p>', createdAt: '', types: ['post'], acct: 't', id: 'b' }
    expect(cacheMatches(store, persisted)).toBe(false)
  })
})

describe('incremental indexing (indexDocs)', () => {
  it('adds only the docs not already indexed and reports the count', () => {
    const store = storeWith({ a: '<p>alpha</p>', b: '<p>beta</p>' })
    const index = createIndex(store)
    // Two more toots arrive after the initial build.
    store.statuses['c'] = { content: '<p>gamma</p>', createdAt: '', types: ['post'], acct: 't', id: 'c' }
    store.statuses['d'] = { content: '<p>delta</p>', createdAt: '', types: ['post'], acct: 't', id: 'd' }

    expect(indexDocs(index, extractDocs(store))).toBe(2) // a, b already present
    expect(index.search('gamma').map(r => String(r.id))).toContain('c')
    expect(index.search('delta').map(r => String(r.id))).toContain('d')
  })

  it('is idempotent: re-running adds nothing and does not throw on duplicates', () => {
    const store = storeWith({ a: '<p>alpha</p>' })
    const index = createIndex(store)
    expect(indexDocs(index, extractDocs(store))).toBe(0)
    expect(index.search('alpha').map(r => String(r.id))).toContain('a')
  })

  it('grows an index that searches identically to a full rebuild', () => {
    const store = storeWith({ a: '<p>计算机科学</p>' })
    const index = createIndex(store)
    store.statuses['b'] = { content: '<p>我会计算</p>', createdAt: '', types: ['post'], acct: 't', id: 'b' }
    indexDocs(index, extractDocs(store))

    const rebuilt = createIndex(store)
    // "计算机" needs the 算机 bigram, which only doc a has — both indexes agree.
    expect(index.search('计算机').map(r => String(r.id)).sort())
      .toEqual(rebuilt.search('计算机').map(r => String(r.id)).sort())
    expect(index.search('计算机').map(r => String(r.id))).toEqual(['a'])
  })
})
