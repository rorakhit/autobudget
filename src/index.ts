import 'dotenv/config'
import Fastify from 'fastify'
import staticPlugin from '@fastify/static'
import formbody from '@fastify/formbody'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { webhookHandler } from './plaid/webhook.js'
import { linkHandler, linkExchangeHandler, setupGetHandler, setupPostHandler } from './plaid/link.js'
import { startCronJobs } from './reports/cron.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = Fastify({ logger: true })

// Capture raw body buffer before JSON parsing — needed for Plaid webhook verification
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (_req, body, done) => {
    try {
      const buf = body as Buffer
      done(null, { _raw: buf, _parsed: JSON.parse(buf.toString()) })
    } catch (err) {
      done(err as Error, undefined)
    }
  }
)

await app.register(formbody)
await app.register(staticPlugin, {
  root: join(__dirname, '../public'),
  prefix: '/public/',
})

app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))
app.post('/webhook', webhookHandler)
app.get('/link', linkHandler)
app.post('/link/exchange', linkExchangeHandler)
app.get('/setup', setupGetHandler)
app.post('/setup', setupPostHandler)

const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
startCronJobs()
