import { describe, it, expect } from 'vitest'
import MiniSearch, { Options } from 'minisearch'
import { FlatIndexBuilder } from '../../src/functions/flatIndex'
import { loadFlatIndex } from '../../src/functions/flatIndex'
import tokenize from '../../src/functions/tokenize'
import isCJKWord from '../../src/functions/isCJKWord'
import type { IndexDoc } from '../../src/functions/createIndex'

// The flat engine replaced MiniSearch but must rank identically under the
// options the app used. This pins it against a real MiniSearch configured the
// same way: same docs in, same hit set out, and the same relevance order.
//
// The options here mirror createIndex.ts's *old* MiniSearch options exactly —
// they're the spec the flat engine reproduces, so they live with the parity test.
const miniOptions: Options = {
  fields: ['content'],
  idField: 'uri',
  tokenize,
  searchOptions: {
    combineWith: 'AND',
    fuzzy(term) {
      return isCJKWord(term) ? false : 0.35
    },
    maxFuzzy: 4,
  },
}

function buildMini(docs: IndexDoc[]): MiniSearch {
  const mini = new MiniSearch(miniOptions)
  mini.addAll(docs)
  return mini
}

function buildFlat(docs: IndexDoc[]): FlatIndexBuilder {
  const flat = new FlatIndexBuilder()
  for (const doc of docs) {
    flat.add(doc)
  }
  return flat
}

// Canonical relevance order: score descending, uri ascending as a stable
// tiebreak. Ties (identical scores) are arbitrary in either engine, so breaking
// them the same way on both sides makes the comparison about real ranking, not
// incidental float / iteration order. With distinct content, scores differ and
// the tiebreak never engages.
function order(results: { id: string | number; score: number }[]): string[] {
  return [...results]
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)))
    .map(r => String(r.id))
}

function ids(results: { id: string | number }[]): string[] {
  return results.map(r => String(r.id)).sort()
}

// A varied corpus: CJK (trad + simp), latin words (some near-duplicates for
// fuzzy), mixed CJK/latin, repeated terms (term-frequency), and varied lengths.
const corpus: IndexDoc[] = [
  { uri: 'd1', content: '我的電腦壞了，需要修理電腦' },
  { uri: 'd2', content: '计算机科学与电脑工程' },
  { uri: 'd3', content: '我会计算这道数学题' },
  { uri: 'd4', content: 'the quick brown fox jumps' },
  { uri: 'd5', content: 'quack quick quirk quark' },
  { uri: 'd6', content: 'machine learning and deep learning' },
  { uri: 'd7', content: '使用 iPhone 拍照 photography' },
  { uri: 'd8', content: 'photograph photography photographer' },
  { uri: 'd9', content: '猫咪 cat 小猫 kitten 猫' },
  { uri: 'd10', content: '２０２４年的新年快樂 happy 2024' },
  { uri: 'd11', content: 'colour color colorful coloring' },
  { uri: 'd12', content: '深度學習與機器學習的研究' },
]

const queries = [
  '電腦', '电脑', '计算机', '計算', '数学',
  'quick', 'quik', 'quack', 'fox',
  'learning', 'learnin', 'machine',
  'photography', 'photograpy', 'photo',
  'iphone', 'cat', '猫咪', '猫', '機器學習',
  '2024', 'happy', 'color', 'colour', 'colorful',
  'nonexistent', '不存在的詞', 'quick brown',
]

describe('flat index parity with MiniSearch', () => {
  const mini = buildMini(corpus)
  const flat = buildFlat(corpus)
  const restored = loadFlatIndex(flat.serialize())

  for (const query of queries) {
    it(`matches the same documents for "${query}"`, () => {
      const expected = ids(mini.search(query))
      expect(ids(flat.search(query))).toEqual(expected)
      // The restored read-only view must agree with the builder too.
      expect(ids(restored.search(query))).toEqual(expected)
    })

    it(`ranks documents the same for "${query}"`, () => {
      const expected = order(mini.search(query))
      expect(order(flat.search(query))).toEqual(expected)
      expect(order(restored.search(query))).toEqual(expected)
    })
  }

  it('produces the same matched terms (for highlighting) as MiniSearch', () => {
    for (const query of queries) {
      const miniByDoc = new Map<string, string[]>()
      for (const r of mini.search(query)) {
        miniByDoc.set(String(r.id), [...r.terms].sort())
      }
      for (const r of flat.search(query)) {
        expect([...r.terms].sort()).toEqual(miniByDoc.get(String(r.id)))
      }
    }
  })
})
