import type { FastifyRequest, FastifyReply } from 'fastify'

const COOKIE_NAME = 'ab_auth'

function getCookie(req: FastifyRequest, name: string): string | undefined {
  const header = req.headers.cookie ?? ''
  const pair = header.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : undefined
}

function isAuthenticated(req: FastifyRequest): boolean {
  const cookie = getCookie(req, COOKIE_NAME)
  return cookie === process.env.SETUP_SECRET
}

export function checkAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!isAuthenticated(req)) {
    reply.code(403).send({ error: 'Forbidden' })
    return false
  }
  return true
}

export function checkAuthPage(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!isAuthenticated(req)) {
    reply.redirect('/')
    return false
  }
  return true
}

export async function authHandler(req: FastifyRequest, reply: FastifyReply) {
  const { secret } = ((req.body as any)._parsed ?? req.body) as { secret: string }
  if (!secret || secret !== process.env.SETUP_SECRET) {
    return reply.code(403).send({ error: 'Invalid secret' })
  }
  reply.header(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(secret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 60 * 60}`
  )
  await reply.send({ ok: true })
}

export async function logoutHandler(_req: FastifyRequest, reply: FastifyReply) {
  reply.header('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)
  await reply.redirect('/')
}
