import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Window } from '../types'

const windows = atom({ plugin: 'usage-band', key: 'windows' } as const, [] as Window[])

const pct = (w?: Window) => (w ? `${Math.round(w.percentUsed)}%` : '--')

const resetIn = (w?: Window) => {
  if (!w?.resetsAt) return ''
  const ms = Date.parse(w.resetsAt) - Date.now()
  if (ms <= 0) return ''
  const m = Math.round(ms / 60000)
  if (m < 60) return ` (reset ${m}min)`
  const h = Math.floor(m / 60)
  return h < 48 ? ` (reset ${h}h${String(m % 60).padStart(2, '0')})` : ` (reset ${Math.round(h / 24)}j)`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const u = await $.session.usage()
      await update($, windows, () => u.rateLimits)
    } catch {}
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, windows, () => e.rateLimits)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ws = await read($, windows)
    if (e.props.hasSurvey || ws.length === 0) return next(e)

    const five = ws.find(w => w.kind === 'five_hour')
    const week = ws.find(w => w.kind === 'seven_day')
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor>
          5h : {pct(five)}{resetIn(five)}  │  Semaine : {pct(week)}{resetIn(week)}
        </Text>
      </Box>
    )
  })
}
