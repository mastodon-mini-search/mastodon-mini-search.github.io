import isCJKWord, { CJK } from "./isCJKWord"
import normalizeChinese from "./normalizeChinese"

// A latin/alphanumeric run is a maximal stretch that is neither whitespace,
// punctuation, nor CJK — mirroring how `tokenize` segments non-CJK text.
const LATIN_RUN = new RegExp(`[^\\s\\p{P}\\p{Z}${CJK}]+`, 'gu')

interface MatchedTerms {
  cjkUnigrams: Set<string>
  cjkBigrams: Set<string>
  latin: Set<string>
}

// `matchedTerms` are MiniSearch result terms: already simplified + NFKC-folded +
// lowercased by the shared tokenizer / processTerm, i.e. in normalized space.
function classifyTerms(matchedTerms: string[]): MatchedTerms {
  const cjkUnigrams = new Set<string>()
  const cjkBigrams = new Set<string>()
  const latin = new Set<string>()
  for (const term of matchedTerms) {
    if (isCJKWord(term)) {
      const len = Array.from(term).length
      if (len === 1) cjkUnigrams.add(term)
      else if (len === 2) cjkBigrams.add(term)
      // Longer CJK terms can't be produced by our tokenizer; ignore.
    } else if (term.length > 0) {
      latin.add(term)
    }
  }
  return { cjkUnigrams, cjkBigrams, latin }
}

// Per UTF-16 index, decide which characters of `text` to highlight. The CJK
// ranges are all in the BMP, so each CJK char is exactly one UTF-16 unit.
function markChars(text: string, terms: MatchedTerms): boolean[] {
  const mark = new Array<boolean>(text.length).fill(false)

  for (let i = 0; i < text.length; i++) {
    if (!isCJKWord(text[i])) continue
    const n = normalizeChinese(text[i])
    if (terms.cjkUnigrams.has(n)) {
      mark[i] = true
    }
    if (i + 1 < text.length && isCJKWord(text[i + 1])) {
      if (terms.cjkBigrams.has(n + normalizeChinese(text[i + 1]))) {
        mark[i] = true
        mark[i + 1] = true
      }
    }
  }

  if (terms.latin.size > 0) {
    let m: RegExpExecArray | null
    LATIN_RUN.lastIndex = 0
    while ((m = LATIN_RUN.exec(text)) !== null) {
      if (terms.latin.has(m[0].normalize('NFKC').toLowerCase())) {
        for (let k = 0; k < m[0].length; k++) {
          mark[m.index + k] = true
        }
      }
    }
  }

  return mark
}

// Rebuild a text node as text + <mark> spans; null if nothing is highlighted.
function buildFragment(text: string, mark: boolean[]): DocumentFragment | null {
  if (!mark.includes(true)) {
    return null
  }
  const fragment = document.createDocumentFragment()
  let i = 0
  while (i < text.length) {
    const start = i
    const on = mark[i]
    while (i < text.length && mark[i] === on) {
      i++
    }
    const chunk = text.slice(start, i)
    if (on) {
      const el = document.createElement('mark')
      el.textContent = chunk
      fragment.appendChild(el)
    } else {
      fragment.appendChild(document.createTextNode(chunk))
    }
  }
  return fragment
}

/**
 * Wrap matched terms in `<mark>` within the status HTML.
 *
 * Walks text nodes only (never tags or attributes, so it can't break markup or
 * inject anything), and decides matches using the same normalization as the
 * index — so highlights line up with search hits across 繁/简, full-width, and
 * bigram matches. See docs/tokenization.md.
 */
export default function highlight(html: string, matchedTerms: string[]): string {
  const terms = classifyTerms(matchedTerms)
  if (terms.cjkUnigrams.size === 0 && terms.cjkBigrams.size === 0 && terms.latin.size === 0) {
    return html
  }

  const container = document.createElement('div')
  container.innerHTML = html

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    textNodes.push(node as Text)
  }

  for (const textNode of textNodes) {
    const text = textNode.nodeValue || ''
    const fragment = buildFragment(text, markChars(text, terms))
    if (fragment) {
      textNode.replaceWith(fragment)
    }
  }

  return container.innerHTML
}
