import { checkAuth } from '../auth.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db/client.js'
import { getAggregatesForPeriod } from '../reports/aggregate.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function reportsPageHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return
  const html = readFileSync(join(__dirname, '../../public/reports.html'), 'utf8')
  await reply.type('text/html').send(html)
}

export async function reportsDataHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { data: insights } = await db
    .from('insights')
    .select('*')
    .order('period_start', { ascending: false })
    .limit(50)

  // Attach category breakdown from transactions for each insight
  const enriched = await Promise.all((insights ?? []).map(async insight => {
    const { data: txs } = await db
      .from('transactions')
      .select('amount, category, is_income')
      .gte('date', insight.period_start)
      .lte('date', insight.period_end)

    const spendTx = (txs ?? []).filter(t => !t.is_income)
    const totalSpend = spendTx.reduce((s, t) => s + Number(t.amount), 0)
    const totalIncome = (txs ?? []).filter(t => t.is_income).reduce((s, t) => s + Number(t.amount), 0)

    const categoryBreakdown: Record<string, number> = {}
    for (const tx of spendTx) {
      const cat = tx.category ?? 'Other'
      categoryBreakdown[cat] = (categoryBreakdown[cat] ?? 0) + Number(tx.amount)
    }

    const savingsRate = totalIncome > 0
      ? Math.max(0, Math.round(((totalIncome - totalSpend) / totalIncome) * 100 * 100) / 100)
      : 0

    return {
      ...insight,
      total_spend: totalSpend,
      total_income: totalIncome,
      savings_rate: savingsRate,
      category_breakdown: categoryBreakdown,
    }
  }))

  await reply.send(enriched)
}

export async function spendingPageHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return
  const html = readFileSync(join(__dirname, '../../public/spending.html'), 'utf8')
  await reply.type('text/html').send(html)
}

export async function spendingDataHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { days: daysStr } = req.query as { days?: string }
  const days = Math.min(Math.max(parseInt(daysStr ?? '30', 10), 1), 365)
  const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const periodEnd = new Date().toISOString().split('T')[0]

  const agg = await getAggregatesForPeriod(periodStart, periodEnd, 'monthly')

  await reply.send({
    totalSpend: agg.totalSpend,
    totalIncome: agg.totalIncome,
    netSavings: agg.netSavings,
    savingsRate: agg.savingsRate,
    categoryBreakdown: agg.categoryBreakdown,
    largestPurchases: agg.largestPurchases,
    recurringCharges: agg.activeRecurringCharges,
  })
}

export async function creditPageHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return
  const html = readFileSync(join(__dirname, '../../public/credit.html'), 'utf8')
  await reply.type('text/html').send(html)
}

export async function creditDataHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const periodStart = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]
  const periodEnd = new Date().toISOString().split('T')[0]
  const agg = await getAggregatesForPeriod(periodStart, periodEnd, 'yearly')

  await reply.send({
    creditSummary: agg.creditSummary,
    loanSummary: agg.loanSummary,
  })
}
