# AutoBudget — Design Spec

**Date:** 2026-04-26  
**Owner:** Ro  
**Status:** Approved

---

## Overview

A personal automated budget tracking system that monitors every financial transaction in real time, categorizes it using Claude AI, surfaces spending patterns and credit health, and generates narrative reports to Notion on a biweekly/monthly/yearly cadence. Zero manual input after initial setup.

**This is personal tooling, not a product.**

---

## Stack

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript | Existing project familiarity |
| Framework | Fastify | Lightweight, strong TS support |
| Hosting | Railway (paid) | Already paid, always-on, reliable webhook delivery |
| Database | Supabase PostgreSQL | Already paid, great table browser for debugging |
| Bank data | Plaid API | Webhooks for real-time transactions, broad account support |
| Categorization | Claude API (claude-sonnet-4-6) | Context-aware categorization + narrative insights |
| Reports | Notion API | Already used, dashboard-friendly |
| Alerts | Gmail (nodemailer) | Push notifications to ro.rakhit@gmail.com |

---

## Architecture

```
Plaid ──webhook──▶ Railway App (Fastify)
                        │
              ┌─────────┼──────────┐
              ▼         ▼          ▼
         Plaid API  Claude API  node-cron
         (fetch tx) (categorize) (reports)
              │         │          │
              └────┬────┘          │
                   ▼               ▼
             Supabase DB ──────▶ Notion
                   │
                   ▼
              Gmail alerts
```

**Four modules inside the app:**

- `src/plaid/` — webhook receiver, Plaid API client, one-time Link setup page
- `src/categorize/` — Claude API calls for per-transaction categorization and confidence scoring
- `src/reports/` — Supabase queries, Claude narrative generation, Notion page writer
- `src/alerts/` — rule-based trigger checks, Claude-enriched Gmail sender

---

## Key Flows

### Flow 1 — Real-time transaction (webhook triggered)

```
Plaid detects transaction
  → POST /webhook to Railway app
  → Verify Plaid JWT signature (drop + 401 if invalid)
  → Fetch full transaction details from Plaid API
  → Send to Claude with last 90 days of same-merchant history
  → Claude returns: category, confidence (0–100), is_recurring flag
  → Store in Supabase transactions table
  → If is_recurring: upsert recurring_charges table
  → If confidence < 80: set flagged_for_review = true
  → Check alert triggers → send Gmail if triggered
```

### Flow 2 — One-time account setup (Plaid Link)

```
Visit https://<railway-url>/link?token=<setup-secret> in browser
  → App serves minimal HTML page with Plaid Link SDK
  → Authenticate with each bank / credit card / PayPal / Venmo / Cash App
  → App exchanges public_token → access_token
  → Store in plaid_items + sync last 90 days of existing transactions
  → Manually enter APR for each credit card via /setup page
  → Set savings goal (fixed amount or % of paycheck) via /setup page
```

### Flow 3 — Scheduled reports (node-cron)

```
Cron fires (monthly: 1st of month | yearly: Jan 1)
  → Query Supabase for all transactions in period
  → Calculate: totals, category breakdown, credit utilization, savings delta
  → Send full dataset to Claude for narrative analysis
  → Claude returns: insights, patterns, anomalies, credit assessment, savings recommendation
  → Store in insights table
  → Write formatted report page to Notion (Reports section)
  → Rewrite Overview, Credit Health, Savings Plan pages (monthly)
  → Rewrite Historical page (monthly + yearly)
  → Send yearly report Gmail highlights on Jan 1
```

### Flow 4 — Paycheck-triggered biweekly report + savings analysis (webhook triggered)

Biweekly reports are triggered by paycheck detection rather than a fixed calendar interval. This ensures the report and savings recommendation arrive together as a single financial briefing at the most actionable moment — right when money lands.

```
Plaid detects direct deposit (paycheck)
  → Identify as income transaction
  → Snapshot current credit card balances → balance_snapshots
  → Run biweekly report for period since last paycheck:
      → Query all transactions in period
      → Calculate: totals, category breakdown, credit utilization delta, savings delta
      → Send full dataset to Claude for narrative analysis
      → Claude returns: insights, patterns, anomalies, credit assessment
  → Store in insights table (period_type: biweekly)
  → Write biweekly report page to Notion (Reports section)
  → Rewrite Overview, Credit Health, Savings Plan pages
  → Run savings recommendation:
      → Send paycheck amount, credit balances, upcoming recurring charges, avg daily spend to Claude
      → Claude returns: recommended savings transfer + rationale
  → Store in savings_events (recommended_amount)
  → Send single combined Gmail:
      - Paycheck received: $X
      - Period summary highlights (top spend categories, credit utilization)
      - Recommended savings transfer: $Y — Claude's rationale
      - Link to full Notion biweekly report
  → When savings transfer detected later: update savings_events.actual_amount
```

---

## Data Model

### `plaid_items`
```sql
id              uuid primary key
access_token    text not null  -- encrypted at rest
institution_id  text not null
institution_name text not null
created_at      timestamptz default now()
```

### `accounts`
```sql
id                uuid primary key
plaid_item_id     uuid references plaid_items(id)
plaid_account_id  text not null unique
name              text not null
type              text not null  -- checking, savings, credit, depository
subtype           text
mask              text           -- last 4 digits
```

### `transactions`
```sql
id                    uuid primary key
plaid_transaction_id  text not null unique
account_id            uuid references accounts(id)
amount                numeric(10,2) not null
merchant_name         text
date                  date not null
category              text
category_confidence   int            -- 0–100
is_recurring          boolean default false
is_income             boolean default false
flagged_for_review    boolean default false
raw_plaid_data        jsonb
created_at            timestamptz default now()
```

### `recurring_charges`
```sql
id              uuid primary key
merchant_name   text not null
average_amount  numeric(10,2)
frequency       text           -- monthly, weekly, annual
last_seen       date
first_seen      date
is_active       boolean default true
```

### `credit_accounts`
```sql
id               uuid primary key
account_id       uuid references accounts(id) unique
apr              numeric(5,2) not null  -- e.g. 24.99
credit_limit     numeric(10,2) not null
is_variable_rate boolean default true
updated_at       timestamptz default now()
```

### `insights`
```sql
id              uuid primary key
period_start    date not null
period_end      date not null
period_type     text not null   -- biweekly, monthly, yearly
raw_analysis    text            -- Claude's full narrative
key_findings    jsonb           -- structured: {patterns, anomalies, credit, savings}
generated_at    timestamptz default now()
```

### `balance_snapshots`
```sql
id          uuid primary key
account_id  uuid references accounts(id)
balance     numeric(10,2) not null
snapshot_at timestamptz default now()  -- taken on every biweekly run
```
Plaid only provides current balances on demand, not historical. This table snapshots credit card balances at each biweekly report run, enabling the "balance grew two periods in a row" trend detection alert.

### `savings_goals`
```sql
id              uuid primary key
target_type     text not null   -- fixed, percentage
target_value    numeric(10,2)   -- dollar amount or percentage (e.g. 10 for 10%)
created_at      timestamptz default now()
```

### `savings_events`
```sql
id                  uuid primary key
paycheck_amount     numeric(10,2) not null
recommended_amount  numeric(10,2)
actual_amount       numeric(10,2)   -- populated when savings transfer detected
period_start        date
period_end          date
notes               text            -- Claude's rationale
created_at          timestamptz default now()
```

---

## Claude Usage

### Per-transaction categorization
Sends: merchant name, amount, date, time of day, last 90 days of same-merchant transactions.  
Returns: `{ category, confidence, is_recurring, reasoning }`.  
**Never sends:** account numbers, access tokens, raw Plaid response.

**Categories:** Groceries, Dining, Food Delivery, Transport, Entertainment, Shopping, Subscriptions, Utilities, Rent/Housing, Healthcare, Travel, Income, Savings Transfer, Credit Payment, Other.

### Per-report narrative analysis
Sends: period transaction totals by category, credit balances + APRs, savings events, prior period for comparison.  
Returns: plain-English narrative covering spending patterns, credit health assessment, subscription audit, behavioral anomalies, savings performance, and 3–5 actionable recommendations.  
Stored in `insights.raw_analysis` and written directly to Notion report page.

### Yearly report narrative
Sends: full year of monthly aggregates, prior year aggregates (if available), credit utilization arc, savings rate by month.  
Returns: honest retrospective that explicitly names wins (improvements vs prior year) and areas still needing work. Tone is encouraging but direct — acknowledges effort and progress, names what still needs attention, and sets 2–3 focus areas for the coming year. Delivered to Notion + emailed as highlights on Jan 1.

### Post-paycheck savings recommendation
Sends: paycheck amount, current credit balances + APRs, upcoming recurring charges, average daily spend this month.  
Returns: recommended savings transfer amount with plain-English rationale.

### Claude-enriched alert context
For **daily spend alerts** and **all credit triggers**, Claude generates a short contextual paragraph included in the Gmail body. This replaces generic threshold notifications with specific, actionable context — e.g. "Your Amex is at 52% utilization. Your dining and food delivery spend has been running higher than your April average over the last 3 weeks, which accounts for most of this increase. Cutting back to your March levels for the next two weeks would bring you back under 30%."

Sends: the triggered metric, last 30 days of relevant spend/balance data, current category trends.  
Returns: 2–4 sentences of specific, practical context.

Pure notifications (no Claude context): large purchases, duplicate charges, new subscriptions, payment confirmations.  
Paycheck alerts already include Claude's savings recommendation — no additional enrichment needed.

---

## Notion Dashboard Structure

```
📊 AutoBudget
├── 🏠 Overview              ← rewritten every biweekly run
├── 💳 Credit Health         ← rewritten every biweekly run
├── 💰 Savings Plan          ← rewritten every biweekly run
├── 📈 Historical            ← rewritten every monthly run
├── 📅 Reports
│   ├── 2026 Year in Review  ← created Jan 1 each year
│   ├── 2026-04 Monthly Report
│   ├── 2026-04-01 – 2026-04-14 (biweekly)
│   └── ... (one page per period, never overwritten)
└── 🚩 Flagged Transactions  ← rows appended as needed
```

### Overview page
- Current month spend vs last month
- Savings rate this month
- Top 5 spending categories
- Active subscriptions + monthly total
- Credit snapshot (total utilization, total balance, total interest accruing/month)

### Credit Health page
- Per-card: balance, limit, utilization %, APR, monthly interest cost, payoff timeline at current payment rate
- Total utilization across all cards with ✅ / ⚠️ / 🚨 indicator (< 30% / 30–50% / > 50%)
- Month-over-month credit balance trend (growing or shrinking)
- Highest APR card flagged for priority paydown (avalanche method)
- Claude's credit narrative for the period

### Savings Plan page
- Savings target (set during setup)
- Actual vs target per paycheck, tracked over time
- Running total saved since day one
- Claude's recommendation from most recent paycheck
- Month-over-month savings rate trend

### Historical page
- Monthly spend totals since day one
- Savings rate by month as trend
- Credit utilization by month
- Subscription count + cost over time
- Claude's longitudinal analysis (updated monthly): compares current month to full history

### Yearly report page (Jan 1)
- Full year totals: income detected, total spend, net savings, average savings rate
- Category breakdown for the year with delta vs prior year
- Credit arc: where utilization started vs where it ended, total interest paid
- Savings performance: did Ro hit the savings goal? By how much?
- Subscription audit: what was added and cancelled across the year
- Claude's year-end narrative:
  - Explicit wins called out (e.g. "Food delivery spend dropped 40% vs last year — that's real progress")
  - Honest assessments of what still needs work, without shame
  - 2–3 focus areas for the coming year, specific and actionable
  - Tone: a coach who has seen the full data, not a judge
- Sent as Gmail highlights on Jan 1 morning

### Report pages (biweekly + monthly)
- Period summary: income detected, total spend, savings rate, net
- Category breakdown with period-over-period delta
- Credit section: utilization changes, interest paid, APR impact on notable purchases
- Claude's narrative analysis
- Largest purchases with context
- Recurring charges audit

### Flagged Transactions page
- Table: date, merchant, amount, Claude's best-guess category, confidence score
- Correct the category inline; corrections feed back into future categorization context

---

## Gmail Alerts

| Trigger | Claude enriched? | Message |
|---|---|---|
| Single purchase > $200 | No | "Large purchase: $X at [Merchant]" |
| Duplicate charge (same merchant + amount within 24hrs) | No | "Possible duplicate: $X at [Merchant] — check your card" |
| New recurring charge detected | No | "New subscription detected: [Merchant] $X/[frequency]" |
| Daily spend > $300 | **Yes** | Amount + Claude's contextual paragraph |
| Credit card crosses 30% utilization | **Yes** | Utilization % + Claude's contextual paragraph |
| Credit card crosses 50% utilization | **Yes** | Utilization % + Claude's contextual paragraph (more urgent) |
| Credit balance grew two periods in a row | **Yes** | Trend note + Claude's contextual paragraph |
| Payment posted to credit card | No | "✅ Payment of $X posted to [Card]" |
| Paycheck detected | Claude savings rec + biweekly report | Paycheck amount + period summary highlights + recommended savings transfer + link to Notion report |
| Yearly report (Jan 1) | **Yes** | Year highlights + link to Notion report |

---

## Security

**Secrets:** All credentials (Plaid client ID + secret, Claude API key, Supabase URL + service role key, Gmail app password, Notion token, Link setup token) live exclusively in Railway environment variables. Never committed to git. `.env.example` with placeholder values is the only thing committed.

**Webhook verification:** Every incoming Plaid webhook is verified against Plaid's JWT signature before processing. Unverified requests return 401 and are dropped immediately.

**Link page protection:** `/link` and `/setup` pages require a `?token=<setup-secret>` query param. Used once during initial setup.

**Supabase RLS:** Row Level Security enabled on all tables. App connects via service role key stored in Railway env vars only — never exposed client-side.

**Minimal data to Claude:** Categorization sends only merchant name, amount, date, and merchant history. Report generation sends aggregated totals and merchant names. No account numbers, no access tokens, no raw Plaid API responses.

**No sensitive logging:** App logs events (webhook received, transaction stored, report generated) but never logs transaction amounts, merchant names, or any financial content to Railway's log stream.

**Data in transit + at rest:** Supabase encrypts data at rest by default. All communication is HTTPS — Railway enforces TLS on the public endpoint, all outbound API calls use HTTPS.

---

## Project Structure

```
autobudget/
├── src/
│   ├── index.ts              -- Fastify app entry point
│   ├── plaid/
│   │   ├── client.ts         -- Plaid API client
│   │   ├── webhook.ts        -- POST /webhook handler
│   │   ├── link.ts           -- GET /link handler (setup page)
│   │   └── sync.ts           -- Initial 90-day transaction sync
│   ├── categorize/
│   │   ├── claude.ts         -- Claude API client
│   │   └── categorize.ts     -- Categorization logic + prompt
│   ├── reports/
│   │   ├── generate.ts       -- Aggregate + call Claude for narrative
│   │   ├── notion.ts         -- Notion API client + page writers
│   │   └── cron.ts           -- node-cron schedule setup
│   ├── alerts/
│   │   ├── rules.ts          -- Alert trigger definitions
│   │   ├── enrich.ts         -- Claude enrichment for alerts
│   │   └── gmail.ts          -- Nodemailer Gmail sender
│   ├── db/
│   │   ├── client.ts         -- Supabase client
│   │   └── migrations/       -- SQL migration files
│   └── types.ts              -- Shared TypeScript types
├── public/
│   ├── link.html             -- Plaid Link setup page
│   └── setup.html            -- APR + savings goal setup form
├── docs/
│   └── superpowers/specs/
│       └── 2026-04-26-autobudget-design.md
├── .env.example
├── package.json
├── tsconfig.json
└── railway.toml
```

---

## Out of Scope (v1)

- Mobile app or native UI
- Multi-user support
- Automated savings transfers (system recommends, you act manually)
- Direct credit score tracking (Plaid doesn't expose this)
- Investment account tracking
- Tax categorization
