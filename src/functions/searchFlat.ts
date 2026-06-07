import isCJKWord from './isCJKWord'
import tokenize from './tokenize'
import { SearchHit } from '../models/SearchHit'

// The flat index's search algorithm, written against an abstract IndexView so
// the same code runs over the mutable builder (build/grow) and the read-only
// buffer view (cache restore) — see flatIndex.ts.
//
// It reproduces, byte for byte in behaviour, what MiniSearch did under our
// options (combineWith: 'AND'; fuzzy only for non-CJK terms, ratio 0.35, capped
// at maxFuzzy 4; BM25+). Keeping parity matters: the index format changed, the
// ranking must not. tests/functions/flatIndexParity.spec.ts pins it against a
// real MiniSearch.

// Postings for one term: parallel docId / frequency arrays (ArrayLike so a
// builder can hand plain arrays and a view can hand typed-array subarrays), and
// the document frequency df = number of docs holding the term.
export interface Postings {
  docs: ArrayLike<number>
  freqs: ArrayLike<number>
  df: number
}

// What the search algorithm needs from an index, regardless of representation.
export interface IndexView {
  documentCount: number
  avgFieldLength: number
  fieldLength(doc: number): number
  uri(doc: number): string
  // Exact term lookup, or undefined if the term isn't indexed.
  getPostings(term: string): Postings | undefined
  // Index terms within `maxDistance` edits of `term` (incl. the exact term at
  // distance 0, which the caller skips). Only non-CJK terms need be considered.
  fuzzyMatches(term: string, maxDistance: number): FuzzyMatch[]
}

export interface FuzzyMatch {
  term: string
  distance: number
  postings: Postings
}

// MiniSearch's BM25+ defaults and our fuzzy settings (createIndex's options).
const K = 1.2
const B = 0.7
const D = 0.5
const FUZZY_RATIO = 0.35
const MAX_FUZZY = 4
const FUZZY_WEIGHT = 0.45 // MiniSearch's default weights.fuzzy

// MiniSearch's calcBM25Score: BM25+ with idf = ln(1 + (N - df + 0.5)/(df + 0.5)).
function bm25(termFreq: number, df: number, n: number, fieldLength: number, avgFieldLength: number): number {
  const invDocFreq = Math.log(1 + (n - df + 0.5) / (df + 0.5))
  return invDocFreq * (D + termFreq * (K + 1) / (termFreq + K * (1 - B + B * fieldLength / avgFieldLength)))
}

// Levenshtein edit distance (substitution / insertion / deletion, no
// transposition — matching MiniSearch's fuzzySearch) over UTF-16 code units,
// bounded: returns the distance if it is <= max, else -1. Early-exits a row once
// its minimum exceeds max, since distance never decreases down the matrix.
export function boundedEditDistance(a: string, b: string, max: number): number {
  const al = a.length
  const bl = b.length
  if (Math.abs(al - bl) > max) {
    return -1
  }
  // Two rolling rows of the DP matrix.
  let prev = new Array<number>(bl + 1)
  let curr = new Array<number>(bl + 1)
  for (let j = 0; j <= bl; j++) {
    prev[j] = j
  }
  for (let i = 1; i <= al; i++) {
    curr[0] = i
    let rowMin = curr[0]
    const ai = a.charCodeAt(i - 1)
    for (let j = 1; j <= bl; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1
      const d = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      curr[j] = d
      if (d < rowMin) {
        rowMin = d
      }
    }
    if (rowMin > max) {
      return -1
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  const distance = prev[bl]
  return distance <= max ? distance : -1
}

// Per-doc accumulator while a query term's matches are gathered: running score
// and the set of *index* terms (exact + fuzzy variants) that hit the doc.
interface DocScore {
  score: number
  terms: Set<string>
}

// Add one (derived) term's postings into a per-term result map, weighted.
// Mirrors MiniSearch.termResults: score += weight * bm25, accumulating the
// derived term for highlighting.
function addPostings(result: Map<number, DocScore>, view: IndexView, derivedTerm: string, postings: Postings, weight: number): void {
  const { docs, freqs, df } = postings
  const n = view.documentCount
  const avg = view.avgFieldLength
  for (let i = 0; i < df; i++) {
    const doc = docs[i]
    const score = weight * bm25(freqs[i], df, n, view.fieldLength(doc), avg)
    const existing = result.get(doc)
    if (existing) {
      existing.score += score
      existing.terms.add(derivedTerm)
    } else {
      result.set(doc, { score, terms: new Set([derivedTerm]) })
    }
  }
}

// All matches for one query term: the exact term, plus (for a non-CJK term)
// every index term within the edit budget. Mirrors MiniSearch.executeQuerySpec.
function execTerm(view: IndexView, term: string): Map<number, DocScore> {
  const result = new Map<number, DocScore>()

  const exact = view.getPostings(term)
  if (exact) {
    addPostings(result, view, term, exact, 1)
  }

  if (!isCJKWord(term)) {
    const maxDistance = Math.min(MAX_FUZZY, Math.round(term.length * FUZZY_RATIO))
    if (maxDistance > 0) {
      for (const match of view.fuzzyMatches(term, maxDistance)) {
        if (match.distance === 0) {
          continue // the exact term, already counted above
        }
        const weight = FUZZY_WEIGHT * match.term.length / (match.term.length + match.distance)
        addPostings(result, view, match.term, match.postings, weight)
      }
    }
  }

  return result
}

// Intersect two per-term result maps (AND): keep only docs in both, summing
// scores and unioning matched terms. Mirrors MiniSearch's AND combinator
// (iterate b, keep what's in a), so iteration order follows the later term.
function andCombine(a: Map<number, DocScore>, b: Map<number, DocScore>): Map<number, DocScore> {
  const combined = new Map<number, DocScore>()
  for (const [doc, eb] of b) {
    const ea = a.get(doc)
    if (!ea) {
      continue
    }
    for (const t of eb.terms) {
      ea.terms.add(t)
    }
    combined.set(doc, { score: ea.score + eb.score, terms: ea.terms })
  }
  return combined
}

// Run a query: tokenize (shared tokenizer) + lowercase (MiniSearch's default
// processTerm), match each token, AND-combine, then score and order. Returns
// hits sorted by score descending — the relevance order the UI shows as-is.
export function searchFlat(view: IndexView, query: string): SearchHit[] {
  const tokens = tokenize(query).map(t => t.toLowerCase()).filter(t => t.length > 0)
  if (tokens.length === 0 || view.documentCount === 0) {
    return []
  }

  // MiniSearch multiplies each doc's score by the count of *distinct* matched
  // query terms (its `quality`). Under AND every surviving doc matched them all,
  // so this is constant across results — it doesn't reorder, but we keep it for
  // score parity.
  const quality = new Set(tokens).size || 1

  let acc: Map<number, DocScore> | undefined
  for (const term of tokens) {
    const termResult = execTerm(view, term)
    acc = acc === undefined ? termResult : andCombine(acc, termResult)
    if (acc.size === 0) {
      return []
    }
  }
  if (!acc) {
    return []
  }

  const hits: SearchHit[] = []
  for (const [doc, e] of acc) {
    hits.push({ id: view.uri(doc), score: e.score * quality, terms: [...e.terms] })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits
}
