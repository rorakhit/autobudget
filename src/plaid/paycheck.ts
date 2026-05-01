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

export async function paycheckDataHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const [{ data: patterns }, { data: recurring }] = await Promise.all([
    db.from('paycheck_patterns').select('id, pattern').order('created_at'),
    db.from('recurring_charges')
      .select('id, merchant_name, average_amount, frequency, last_seen, account_id, accounts(name, mask)')
      .eq('is_active', true)
      .order('average_amount', { ascending: false }),
  ])

  await reply.send({ patterns: patterns ?? [], recurring: recurring ?? [] })
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

