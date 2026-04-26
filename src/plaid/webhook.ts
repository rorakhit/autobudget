import type { FastifyRequest, FastifyReply } from 'fastify'
import * as jose from 'jose'
import { createHash } from 'crypto'
import { plaidClient } from './client.js'

interface RawBody {
  _raw: Buffer
  _parsed: Record<string, unknown>
}

async function verifyPlaidSignature(token: string, rawBody: Buffer): Promise<boolean> {
  try {
    const header = jose.decodeProtectedHeader(token)
    if (!header.kid) return false

    const keyResponse = await plaidClient.webhookVerificationKeyGet({ key_id: header.kid })
    const jwk = await jose.importJWK(keyResponse.data.key as jose.JWK)

    const { payload } = await jose.compactVerify(token, jwk)
    const claims = JSON.parse(new TextDecoder().decode(payload)) as { request_body_sha256: string }

    const bodyHash = createHash('sha256').update(rawBody).digest('hex')
    return claims.request_body_sha256 === bodyHash
  } catch {
    return false
  }
}

export async function webhookHandler(req: FastifyRequest, reply: FastifyReply) {
  const token = req.headers['plaid-verification-token'] as string | undefined
  const body = req.body as RawBody

  if (!token) {
    return reply.code(401).send({ error: 'Missing verification token' })
  }

  const valid = await verifyPlaidSignature(token, body._raw)
  if (!valid) {
    return reply.code(401).send({ error: 'Invalid webhook signature' })
  }

  const event = body._parsed
  req.log.info({ webhook_type: event['webhook_type'], webhook_code: event['webhook_code'] }, 'Webhook received')

  await reply.send({ ok: true })
}
