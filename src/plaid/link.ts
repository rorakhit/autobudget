import type { FastifyRequest, FastifyReply } from 'fastify'

export async function linkHandler(_req: FastifyRequest, reply: FastifyReply) {
  await reply.send('link')
}
export async function linkExchangeHandler(_req: FastifyRequest, reply: FastifyReply) {
  await reply.send({ ok: true })
}
export async function setupGetHandler(_req: FastifyRequest, reply: FastifyReply) {
  await reply.send('setup')
}
export async function setupPostHandler(_req: FastifyRequest, reply: FastifyReply) {
  await reply.send({ ok: true })
}
