import { describe, it, expect } from 'vitest'
import createIndex from './createIndex'
import { StatusStore, StatusDocument } from '../models/StatusStore'

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
