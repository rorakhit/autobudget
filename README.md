<h1><img src="public/icon.svg" height="32" alt="" /> AutoBudget</h1>

Fully automated personal finance system. Ingests real-time bank transactions via Plaid webhooks, categorizes them with Claude, and surfaces spending insights through Gmail alerts and a live Notion dashboard.

## How It Works

```
Bank transaction
      │
      ▼
Plaid webhook ──► JWT signature verification
      │
      ▼
Claude API categorizes transaction
(with 90-day merchant history context)
      │
      ├──► Supabase (PostgreSQL)
      │
      ├──► Real-time alerts (Gmail)
      │         • Large purchase > $200
      │         • Duplicate charge detected
      │         • New subscription
      │         • Daily spend > $300
      │         • Credit utilization ≥ 30% / 50%
      │
      └──► Paycheck detected?
                │
                ▼
          Biweekly report + AI savings recommendation
          → Combined Gmail briefing
          → Notion dashboard update

Monthly/yearly cron → Notion historical reports
```

## Notion Dashboard

Seven pages updated automatically:

| Page | Updated |
|------|---------|
| **Overview** | Every paycheck |
| **Credit Health** | Every paycheck (sorted by APR, avalanche payoff plan) |
| **Savings Plan** | Every paycheck |
| **Historical** | Monthly + yearly |
| **Reports** | Every paycheck, monthly, yearly |
| **Flagged Transactions** | Every sync (confidence < 80%) |
| **Recent Transactions** | Every sync (last 100, for pipeline monitoring) |

## Stack

- **Runtime:** TypeScript + Fastify 5, deployed on Railway
- **Database:** Supabase (PostgreSQL) with Row Level Security
- **Bank data:** Plaid API (webhook-driven, cursor-based sync)
- **AI:** Claude API (`claude-haiku-4-5-20251001`) — categorization, narratives, alert enrichment
- **Dashboard:** Notion API
- **Alerts:** Gmail via nodemailer

## Setup

### 1. Prerequisites

- [Railway](https://railway.app) account (for hosting)
- [Supabase](https://supabase.com) project
- [Plaid](https://plaid.com) account (Transactions product)
- [Anthropic](https://console.anthropic.com) API key
- [Notion](https://notion.so) integration with a root page
- Gmail account with an [app password](https://myaccount.google.com/apppasswords)

### 2. Database

Run the migrations in order in the Supabase SQL editor:

```
src/db/migrations/001_initial.sql
src/db/migrations/002_rls.sql
src/db/migrations/003_categorization_rules.sql
```

### 3. Environment Variables

Set these in Railway (or a local `.env` for development):

```env
# Plaid
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=production          # or sandbox

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=    # service role, not anon key

# Anthropic
ANTHROPIC_API_KEY=

# Notion
NOTION_TOKEN=                 # integration access token
NOTION_ROOT_PAGE_ID=          # ID from your root Notion page URL

# Gmail
GMAIL_USER=your@gmail.com
GMAIL_APP_PASSWORD=

# Security
SETUP_SECRET=                 # random string — protects /link and /setup routes
```

### 4. Deploy to Railway

```bash
git push origin main
```

Railway auto-deploys via nixpacks. The server starts on the `PORT` env var Railway injects (8080).

### 5. Register Plaid Webhook

In the Plaid dashboard, set your webhook URL to:

```
https://<your-railway-url>/plaid/webhook
```

### 6. Connect Bank Accounts

Visit `/link?token=<SETUP_SECRET>` to connect your accounts via Plaid Link.

### 7. Enter Card Details

Visit `/setup?token=<SETUP_SECRET>` to enter APRs and your savings goal. This also writes the Notion homepage with navigation links to all dashboard sections.

### 8. Register Webhook on Existing Items (first-time only)

If accounts were linked before `PLAID_WEBHOOK_URL` was set, register the webhook URL on all existing Plaid items:

```bash
curl -X POST "https://<your-railway-url>/link/repair-webhooks?token=<SETUP_SECRET>"
```

Then trigger an initial sync:

```bash
curl -X POST "https://<your-railway-url>/link/sync-all?token=<SETUP_SECRET>"
```

## Setup & Admin Pages

All pages require `?token=<SETUP_SECRET>`.

| Page | Purpose |
|------|---------|
| `/link` | Connect bank accounts via Plaid Link |
| `/setup` | Enter credit card APRs and savings goal |
| `/review` | Review and correct transaction categories; confirm correctly-guessed ones |
| `/rules` | Manage categorization rules (run before Claude) |

## Debugging Endpoints

All require `?token=<SETUP_SECRET>`.

| Endpoint | Purpose |
|----------|---------|
| `POST /link/repair-webhooks` | Register webhook URL on all Plaid items |
| `POST /link/sync-all` | Manually trigger a full transaction sync for all items |
| `POST /link/refresh-notion` | Rewrite Flagged + Recent Transactions Notion pages from DB |
| `GET /link/accounts` | List all linked institutions and accounts (JSON) |
| `GET /health` | Health check — returns `{ status: "ok" }` |

## Development

```bash
npm install
cp .env.example .env   # fill in your values
npm run dev            # tsx watch, hot reload
npm test               # vitest (25 unit tests)
```

## Project Structure

```
src/
├── index.ts              # Fastify server, route registration, cron startup
├── types.ts              # Shared TypeScript types
├── plaid/
│   ├── client.ts         # Plaid API singleton
│   ├── webhook.ts        # JWT verification, webhook routing
│   ├── sync.ts           # Cursor-based transaction sync
│   ├── link.ts           # Plaid Link flow + setup UI
│   ├── review.ts         # Category review endpoints
│   └── rules.ts          # Categorization rules endpoints
├── categorize/
│   ├── claude.ts         # Anthropic client singleton
│   └── categorize.ts     # Transaction categorization with merchant history
├── alerts/
│   ├── rules.ts          # Alert logic (large purchase, duplicate, utilization…)
│   ├── enrich.ts         # Claude-generated context for alerts
│   └── gmail.ts          # Email delivery
├── reports/
│   ├── aggregate.ts      # Spend/savings/credit aggregation
│   ├── generate.ts       # Narrative generation, paycheck + cron handlers
│   ├── notion.ts         # Notion page writers
│   └── cron.ts           # Monthly + yearly cron schedules
└── db/
    ├── client.ts         # Supabase client
    └── migrations/
        ├── 001_initial.sql
        ├── 002_rls.sql
        └── 003_categorization_rules.sql
tests/
├── categorize.test.ts
├── rules.test.ts
└── aggregate.test.ts
public/
├── link.html             # Plaid Link UI
├── setup.html            # APR / savings goal form
├── review.html           # Category review UI
├── rules.html            # Categorization rules UI
├── oauth-return.html     # Plaid OAuth redirect handler
└── icon.svg
```

## Security

- Plaid webhooks verified via JWT signature before any processing
- `/link` and `/setup` routes gated by `SETUP_SECRET`
- Supabase service role key used server-side only; RLS blocks all anon access
- All credentials live in Railway environment variables — nothing in source
