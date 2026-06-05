// Regexp from https://github.com/vinta/pangu.js/blob/master/src/shared/core.js
export const CJK = '\u2e80-\u2eff\u2f00-\u2fdf\u3040-\u309f\u30a0-\u30fa\u30fc-\u30ff\u3100-\u312f\u3200-\u32ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff'
const CJK_WORD = new RegExp(`^[${CJK}]+$`)

export default function(word: string) {
  return !!word.match(CJK_WORD)
}