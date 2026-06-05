import { bigram } from "n-gram"
import isCJKWord, { CJK } from "./isCJKWord"
import normalizeChinese from "./normalizeChinese"

// Split on line breaks, Unicode separators (\p{Z}) and punctuation (\p{P}).
const SPACE_OR_PUNCTUATION = /[\n\r\p{Z}\p{P}]+/u

// Reuse the same CJK ranges as isCJKWord to detect script boundaries.
const CJK_NCJK = new RegExp(`([${CJK}])([^${CJK}])`, 'g')
const NCJK_CJK = new RegExp(`([^${CJK}])([${CJK}])`, 'g')

// Insert a space at every CJK <-> non-CJK boundary so e.g. "我用iPhone"
// segments into "我用" and "iPhone" instead of one mixed token.
function addSpaceBetweenCJKandNonCJK(text: string): string {
  return text.replace(CJK_NCJK, '$1 $2').replace(NCJK_CJK, '$1 $2')
}

/**
 * Tokenizer shared by both indexing and querying (passed to MiniSearch as
 * `tokenize`, so the two stay in lockstep by construction).
 *
 * Pipeline:
 *   1. NFKC-normalize the whole string — folds full-width latin/digits to
 *      half-width ("２０２４" -> "2024", "ＡＰＰ" -> "APP") and canonicalizes
 *      compatibility forms.
 *   2. Insert spaces at CJK <-> non-CJK boundaries.
 *   3. Split on whitespace and punctuation, dropping empty segments.
 *   4. For an all-CJK segment: traditional->simplified per character, then emit
 *      both unigrams and bigrams (dictionary-free CJK indexing).
 *      For any other segment: emit it as a single token.
 *
 * Case folding is intentionally left to MiniSearch's default `processTerm`
 * (lowercasing), which runs on every token this function returns.
 *
 * See docs/tokenization.md for the full contract and known limitations.
 */
export default function tokenize(text: string): string[] {
  const tokens: string[] = []
  const segments = addSpaceBetweenCJKandNonCJK(text.normalize('NFKC')).split(SPACE_OR_PUNCTUATION)

  for (const segment of segments) {
    if (segment.length === 0) {
      continue
    }
    if (isCJKWord(segment)) {
      const normalized = Array.from(segment).map(char => normalizeChinese(char))
      for (const char of normalized) {
        tokens.push(char)
      }
      for (const pair of bigram(normalized) as unknown as string[][]) {
        tokens.push(pair.join(''))
      }
    } else {
      tokens.push(segment)
    }
  }

  return tokens
}
