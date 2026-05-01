import { checkAuth, checkAuthPage } from '../auth.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db/client.js'
import { handlePaycheckDetected } from '../reports/generate.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function paycheckPageHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuthPage(req, reply)) return
  const html = readFileSync(join(__dirname, '../../public/paycheck.html'), 'utf8')
  await reply.type('text/html').send(html)
}

async function getRecurringByMerchant() {
  const { data: txs } = await db
    .from('transactions')
    .select('merchant_name, amount, date')
    .eq('is_recurring', true)
    .eq('is_income', false)
    .order('date', { ascending: false })

  const map = new Map<string, { merchant_name: string; total: number; count: number; last_seen: string; amounts: number[] }>()
  for (const tx of txs ?? []) {
    const key = tx.merchant_name ?? 'Unknown'
    const existing = map.get(key)
    if (!existing) {
      map.set(key, { merchant_name: key, total: Number(tx.amount), count: 1, last_seen: tx.date, amounts: [Number(tx.amount)] })
    } else {
      existing.total += Number(tx.amount)
      existing.count++
      existing.amounts.push(Number(tx.amount))
      if (tx.date > existing.last_seen) existing.last_seen = tx.date
    }
  }

  return Array.from(map.values())
    .map(r => ({ merchant_name: r.merchant_name, average_amount: r.total / r.count, last_seen: r.last_seen, count: r.count }))
    .sort((a, b) => b.average_amount - a.average_amount)
}

export async function paycheckDataHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const [{ data: patterns }, recurring] = await Promise.all([
    db.from('paycheck_patterns').select('id, pattern').order('created_at'),
    getRecurringByMerchant(),
  ])

  await reply.send({ patterns: patterns ?? [], recurring })
}

export async function recurringExportHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const recurring = await getRecurringByMerchant()
  const lines = ['Merchant,Average Amount,Last Seen,Occurrences']
  for (const r of recurring) {
    lines.push(`"${r.merchant_name.replace(/"/g, '""')}",${r.average_amount.toFixed(2)},${r.last_seen},${r.count}`)
  }

  await reply
    .header('Content-Type', 'text/csv')
    .header('Content-Disposition', 'attachment; filename="recurring-charges.csv"')
    .send(lines.join('\n'))
}

export async function addPaycheckPatternHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { pattern } = ((req.body as any)._parsed ?? req.body) as { pattern: string }
  if (!pattern?.trim()) return reply.code(400).send({ error: 'pattern required' })

  const { data, error } = await db
    .from('paycheck_patterns')
    .insert({ pattern: pattern.trim().toUpperCase() })
    .select('id, pattern')
    .single()

  if (error) return reply.code(500).send({ error: error.message })
  await reply.send(data)
}

export async function removePaycheckPatternHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { id } = req.params as { id: string }
  const { error } = await db.from('paycheck_patterns').delete().eq('id', id)
  if (error) return reply.code(500).send({ error: error.message })
  await reply.send({ ok: true })
}

export async function removeRecurringHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return
  const { id } = req.params as { id: string }
  const { error } = await db.from('recurring_charges').update({ is_active: false }).eq('id', id)
  if (error) return reply.code(500).send({ error: error.message })
  await reply.send({ ok: true })
}

export async function triggerPaycheckReportHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const isRegen = (req.query as Record<string, string>).regen === '1'

  if (isRegen) {
    const { data: lastEvent } = await db
      .from('savings_events')
      .select('period_start, period_end, paycheck_amount')
      .order('created_at', { ascending: false })
      .limit(1)

    if (!lastEvent?.length) return reply.code(404).send({ error: 'No previous paycheck report found to regenerate' })

    const { period_start, period_end, paycheck_amount } = lastEvent[0]
    await reply.send({ ok: true, regen: true, transaction: { amount: paycheck_amount, date: period_end } })

    setImmediate(async () => {
      const { getAggregatesForPeriod } = await import('../reports/aggregate.js')
      const { generateNarrativeForRegen, getSavingsRecommendationForRegen, getPaycheckAllocationForRegen } = await import('../reports/generate.js')
      const agg = await getAggregatesForPeriod(period_start, period_end, 'biweekly')
      const [narrative, savingsRec, allocation] = await Promise.all([
        generateNarrativeForRegen(agg),
        getSavingsRecommendationForRegen(Number(paycheck_amount), agg),
        getPaycheckAllocationForRegen(Number(paycheck_amount), agg),
      ])
      const label = `Regen ${new Date().toISOString().replace('T', ' ').slice(0, 16)}`
      await db.from('insights').insert({
        period_start,
        period_end,
        period_type: 'biweekly',
        raw_analysis: narrative,
        key_findings: { savings_recommendation: savingsRec, paycheck_allocation: allocation, label },
      })
    })
    return
  }

  const { data: patterns } = await db.from('paycheck_patterns').select('pattern')
  if (!patterns?.length) return reply.code(400).send({ error: 'No paycheck patterns configured' })

  const { data: incomeTxs } = await db
    .from('transactions')
    .select('*')
    .eq('is_income', true)
    .order('date', { ascending: false })
    .limit(200)

  const matching = (incomeTxs ?? []).filter(tx => {
    const name = (tx.merchant_name ?? '').toLowerCase()
    return patterns.some((p: { pattern: string }) => name.includes(p.pattern.toLowerCase()))
  })

  if (!matching.length) return reply.code(404).send({ error: 'No matching paycheck deposits found' })

  // Take the most recent date and sum all same-day matches
  const latestDate = matching[0].date
  const group = matching.filter(tx => tx.date === latestDate)
  const totalAmount = group.reduce((s, tx) => s + Number(tx.amount), 0)
  const combined = { ...group[0], amount: totalAmount, date: latestDate }

  await reply.send({ ok: true, transaction: { amount: totalAmount, date: latestDate } })

  setImmediate(async () => {
    await handlePaycheckDetected(combined)
  })
}

