import { describe, it, expect } from 'vitest'
import tokenize from './tokenize'

describe('tokenize', () => {
  it('splits a CJK run into unigrams followed by bigrams', () => {
    expect(tokenize('计算机')).toEqual(['计', '算', '机', '计算', '算机'])
  })

  it('emits only a unigram for a single CJK char (no bigram)', () => {
    expect(tokenize('好')).toEqual(['好'])
  })

  it('folds traditional to simplified so 繁/简 produce identical tokens', () => {
    expect(tokenize('電腦')).toEqual(['电', '脑', '电脑'])
    expect(tokenize('電腦')).toEqual(tokenize('电脑'))
  })

  it('normalizes 繁体 variants of the same simplified char (裡/裏 -> 里)', () => {
    expect(tokenize('裡')).toEqual(tokenize('裏'))
    expect(tokenize('裡')).toEqual(['里'])
  })

  it('separates CJK and latin runs at the boundary', () => {
    // The CJK run "我用" still yields its unigrams + bigram; the latin run is split off.
    // latin case-folding is left to MiniSearch's processTerm, so "iPhone" stays as-is here.
    expect(tokenize('我用iPhone')).toEqual(['我', '用', '我用', 'iPhone'])
  })

  it('folds full-width latin and digits to half-width via NFKC', () => {
    expect(tokenize('２０２４')).toEqual(['2024'])
    expect(tokenize('ＡＰＰ')).toEqual(['APP'])
  })

  it('drops empty tokens produced by punctuation runs', () => {
    expect(tokenize('foo，，bar。')).toEqual(['foo', 'bar'])
    expect(tokenize('，。！')).toEqual([])
    expect(tokenize('   ')).toEqual([])
  })

  it('does not form bigrams across a punctuation boundary', () => {
    // "你好，世界": no "好世" bigram should be emitted.
    expect(tokenize('你好，世界')).toEqual(['你', '好', '你好', '世', '界', '世界'])
  })
})
