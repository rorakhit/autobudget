import type { FastifyRequest, FastifyReply } from 'fastify'
import { plaidClient } from './client.js'
import { db } from '../db/client.js'
import { syncTransactions } from './sync.js'
import { CountryCode, Products } from 'plaid'
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

export async function linkHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkSetupToken(req, reply)) return

  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: 'ro' },
    client_name: 'AutoBudget',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
    webhook: process.env.PLAID_WEBHOOK_URL!,
  })

  const html = readFileSync(join(__dirname, '../../public/link.html'), 'utf8')
    .replace('__LINK_TOKEN__', response.data.link_token)

  await reply.type('text/html').send(html)
}

export async function linkExchangeHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkSetupToken(req, reply)) return

  const { public_token, institution_id, institution_name, accounts } =
    req.body as {
      public_token: string
      institution_id: string
      institution_name: string
      accounts: Array<{ id: string; name: string; type: string; subtype: string; mask: string }>
    }

  const exchangeResponse = await plaidClient.itemPublicTokenExchange({ public_token })
  const { access_token, item_id } = exchangeResponse.data

  const { data: item, error } = await db
    .from('plaid_items')
    .insert({ plaid_item_id: item_id, access_token, institution_id, institution_name })
    .select()
    .single()

  if (error) return reply.code(500).send({ error: error.message })

  for (const acct of accounts) {
    await db.from('accounts').upsert({
      plaid_item_id: item.id,
      plaid_account_id: acct.id,
      name: acct.name,
      type: acct.type,
      subtype: acct.subtype,
      mask: acct.mask,
    }, { onConflict: 'plaid_account_id' })
  }

  setImmediate(() => syncTransactions(item.id).catch(console.error))

  await reply.send({ ok: true, institution: institution_name, accounts: accounts.length })
}

export async function setupGetHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkSetupToken(req, reply)) return

  const { data: creditAccounts } = await db
    .from('accounts')
    .select('id, name, mask')
    .eq('type', 'credit')

  const html = readFileSync(join(__dirname, '../../public/setup.html'), 'utf8')
    .replace('__ACCOUNTS_JSON__', JSON.stringify(creditAccounts ?? []))

  await reply.type('text/html').send(html)
}

export async function setupPostHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkSetupToken(req, reply)) return

  const body = req.body as Record<string, string>

  const creditAccounts = Object.keys(body)
    .filter(k => k.startsWith('apr_'))
    .map(k => {
      const accountId = k.replace('apr_', '')
      return {
        account_id: accountId,
        apr: parseFloat(body[k]),
        credit_limit: parseFloat(body[`limit_${accountId}`] ?? '0'),
      }
    })
    .filter(ca => !isNaN(ca.apr) && ca.apr > 0)

  for (const ca of creditAccounts) {
    await db.from('credit_accounts').upsert(ca, { onConflict: 'account_id' })
  }

  if (body['target_type'] && body['target_value']) {
    await db.from('savings_goals').insert({
      target_type: body['target_type'],
      target_value: parseFloat(body['target_value']),
    })
  }

  await reply.send({ ok: true, message: 'Setup complete' })
}
