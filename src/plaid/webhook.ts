import type { FastifyRequest, FastifyReply } from 'fastify'

export async function webhookHandler(_req: FastifyRequest, reply: FastifyReply) {
  await reply.send({ ok: true })
}
