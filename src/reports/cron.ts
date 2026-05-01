import cron from 'node-cron'
import { runMonthlyReport, runYearlyReport } from './generate.js'
import { db } from '../db/client.js'
import { handlePaycheckDetected } from './generate.js'

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

  // Daily catch-up: fire paycheck report if a deposit landed in the last 7 days
  // with no savings_event within ±2 days of it (catches missed webhook windows)
  cron.schedule('0 9 * * *', async () => {
    console.log('Running daily paycheck catch-up check')
    try {
      const { data: paycheckAccounts } = await db
        .from('accounts')
        .select('id')
        .eq('is_paycheck_account', true)

      if (!paycheckAccounts?.length) return

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const { data: candidates } = await db
        .from('transactions')
        .select('*')
        .in('account_id', paycheckAccounts.map(a => a.id))
        .eq('is_income', true)
        .gte('amount', 500)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })

      for (const tx of candidates ?? []) {
        const txDate = new Date(tx.date as string)
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
          console.log(`Catch-up: firing paycheck report for missed deposit ${tx.id}`)
          await handlePaycheckDetected(tx).catch(err =>
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
