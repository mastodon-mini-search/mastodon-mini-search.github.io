// Human-friendly post timestamps, Mastodon-style: a relative phrase for recent
// toots ("3 分鐘前") and an absolute date once they're more than a week old.
const rtf = new Intl.RelativeTimeFormat('zh-Hant', { numeric: 'auto' })

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export default function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) {
    return ''
  }
  // Negative = in the past, which is the usual case.
  const diffSec = Math.round((then.getTime() - now.getTime()) / 1000)
  const absSec = Math.abs(diffSec)

  if (absSec < MINUTE) {
    return '剛剛'
  }
  if (absSec < HOUR) {
    return rtf.format(Math.round(diffSec / MINUTE), 'minute')
  }
  if (absSec < DAY) {
    return rtf.format(Math.round(diffSec / HOUR), 'hour')
  }
  if (absSec < 7 * DAY) {
    return rtf.format(Math.round(diffSec / DAY), 'day')
  }

  const sameYear = then.getFullYear() === now.getFullYear()
  return then.toLocaleDateString(
    'zh-Hant',
    sameYear
      ? { month: 'long', day: 'numeric' }
      : { year: 'numeric', month: 'long', day: 'numeric' },
  )
}
