import cron from 'node-cron'
import { runMonthlyReport, runYearlyReport, handlePaycheckDetected } from './generate.js'
import { db } from '../db/client.js'

export function startCronJobs(): void {
  cron.schedule('0 8 1 * *', async () => {
    const now = new Date()
    const month = now.getMonth()
    const year = now.getFullYear()
    const reportMonth = month === 0 ? 12 : month
    const reportYear = month === 0 ? year - 1 : year
    console.log(`Running monthly report for ${reportYear}-${reportMonth}`)
    await runMonthlyReport(reportYear, reportMonth).catch(console.error)
  })

  cron.schedule('0 8 1 1 *', async () => {
    const year = new Date().getFullYear() - 1
    console.log(`Running yearly report for ${year}`)
    await runYearlyReport(year).catch(console.error)
  })

  // Daily catch-up: fire paycheck report if a pattern-matching deposit landed in the last 7 days
  // with no savings_event within ±2 days of it (catches missed webhook windows)
  cron.schedule('0 9 * * *', async () => {
    console.log('Running daily paycheck catch-up check')
    try {
      const { data: patterns } = await db.from('paycheck_patterns').select('pattern')
      if (!patterns?.length) return

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const { data: incomeTxs } = await db
        .from('transactions')
        .select('*')
        .eq('is_income', true)
        .gte('created_at', sevenDaysAgo)
        .order('date', { ascending: false })

      const matching = (incomeTxs ?? []).filter(tx => {
        const name = (tx.merchant_name ?? '').toLowerCase()
        return patterns.some(p => name.includes(p.pattern.toLowerCase()))
      })

      // Group by date, check each date for a missing savings_event
      const byDate: Record<string, typeof matching> = {}
      for (const tx of matching) {
        if (!byDate[tx.date]) byDate[tx.date] = []
        byDate[tx.date].push(tx)
      }

      for (const date of Object.keys(byDate).sort().reverse()) {
        const txDate = new Date(date)
        const windowStart = new Date(txDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
        const windowEnd = new Date(txDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString()

        const { data: existing } = await db
          .from('savings_events')
          .select('id')
          .gte('created_at', windowStart)
          .lte('created_at', windowEnd)
          .limit(1)
          .single()

        if (!existing) {
          const group = byDate[date]
          const totalAmount = group.reduce((s, tx) => s + Number(tx.amount), 0)
          const combined = { ...group[0], amount: totalAmount, date }
          console.log(`Catch-up: firing paycheck report for ${date}, combined amount ${totalAmount}`)
          await handlePaycheckDetected(combined).catch(err =>
            console.error('Catch-up paycheck report failed:', err)
          )
          break // one report per day max
        }
      }
    } catch (err) {
      console.error('Daily paycheck catch-up error:', err)
    }
  })

  console.log('Cron jobs started: monthly (1st @ 8am), yearly (Jan 1 @ 8am), paycheck catch-up (daily @ 9am)')
}
