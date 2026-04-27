import type { FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db/client.js'
import { CATEGORIES } from '../types.js'
import { getAllCategories } from '../db/categories.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function checkSetupToken(req: FastifyRequest, reply: FastifyReply): boolean {
  const token = (req.query as Record<string, string>)['token']
  if (token !== process.env.SETUP_SECRET) {
    reply.code(403).send({ error: 'Forbidden' })
    return false
  }
  return true
}

export async function settingsPageHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkSetupToken(req, reply)) return
  const html = readFileSync(join(__dirname, '../../public/settings.html'), 'utf8')
  await reply.type('text/html').send(html)
}

export async function settingsDataHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkSetupToken(req, reply)) return

  const [{ data: accounts }, allCategories, { data: custom }, { data: creditAccounts }] = await Promise.all([
    db.from('accounts')
      .select('id, name, display_name, mask, type, subtype, plaid_items(institution_name)')
      .order('name'),
    getAllCategories(),
    db.from('custom_categories').select('name').order('name'),
    db.from('credit_accounts').select('account_id, apr, credit_limit'),
  ])

  const aprMap = Object.fromEntries((creditAccounts ?? []).map(r => [r.account_id, r]))

  await reply.send({
    accounts: accounts ?? [],
    categories: allCategories,
    systemCategories: CATEGORIES,
    customCategories: (custom ?? []).map(r => r.name),
    aprMap,
  })
}

export async function renameAccountHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkSetupToken(req, reply)) return

  const { account_id, display_name } =
    ((req.body as any)._parsed ?? req.body) as { account_id: string; display_name: string }

  if (!account_id || !display_name?.trim()) {
    return reply.code(400).send({ error: 'account_id and display_name required' })
  }

  const { error } = await db
    .from('accounts')
    .update({ display_name: display_name.trim(), name: display_name.trim() })
    .eq('id', account_id)

  if (error) return reply.code(500).send({ error: error.message })
  await reply.send({ ok: true })
}

export async function addCategoryHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkSetupToken(req, reply)) return

  const { name } = ((req.body as any)._parsed ?? req.body) as { name: string }

  if (!name?.trim()) return reply.code(400).send({ error: 'name required' })

  const trimmed = name.trim()
  if ((CATEGORIES as readonly string[]).includes(trimmed)) {
    return reply.code(400).send({ error: 'Category already exists as a system category' })
  }

  const { error } = await db.from('custom_categories').insert({ name: trimmed })
  if (error) return reply.code(500).send({ error: error.message })
  await reply.send({ ok: true, name: trimmed })
}

export async function deleteCategoryHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkSetupToken(req, reply)) return

  const { name } = req.params as { name: string }

  if ((CATEGORIES as readonly string[]).includes(name)) {
    return reply.code(400).send({ error: 'Cannot delete a system category' })
  }

  const { error } = await db.from('custom_categories').delete().eq('name', name)
  if (error) return reply.code(500).send({ error: error.message })
  await reply.send({ ok: true })
}

export async function updateAprHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkSetupToken(req, reply)) return

  const { account_id, apr, credit_limit } =
    ((req.body as any)._parsed ?? req.body) as { account_id: string; apr: number; credit_limit: number }

  if (!account_id || isNaN(Number(apr)) || isNaN(Number(credit_limit))) {
    return reply.code(400).send({ error: 'account_id, apr, and credit_limit required' })
  }

  const { error } = await db.from('credit_accounts').upsert(
    { account_id, apr: Number(apr), credit_limit: Number(credit_limit) },
    { onConflict: 'account_id' }
  )

  if (error) return reply.code(500).send({ error: error.message })
  await reply.send({ ok: true })
}
