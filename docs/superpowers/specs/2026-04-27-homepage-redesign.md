# Homepage Redesign

**Date:** 2026-04-27  
**Status:** Approved

## Overview

Replace the sparse nav-card homepage with a polished dashboard that shows live financial stats and links to all tool sections. Two states: unauthenticated (blurred preview + login prompt) and authenticated (full stats + nav cards).

## Layout — Authenticated

Three vertical sections inside a single-column max-width container:

1. **Header row** — "AutoBudget" title (bold, tight tracking), "Personal Finance Automation" subtitle, authenticated pill (green dot + "authenticated · sign out") aligned right.
2. **Stats band** — Full-width gradient card (indigo → violet) with five stats in equal columns divided by subtle separators.
3. **Nav grid** — 3-column grid of nav cards, each with icon, title, description, and optional badge.

## Stats Band — Five Stats

| Stat | Label | Sub-label | Source |
|---|---|---|---|
| Net worth | Net worth | ↑/↓ $X this mo | depository balances − credit − loan balances (latest `balance_snapshots`) |
| CC balance | CC balance | across N cards | sum of latest `balance_snapshots` for credit-type accounts |
| Total debt | Total debt | mortgage + loans | CC balance + loan `balance_snapshots` |
| Savings / mo | Savings / mo | last 30 days | income transactions − expense transactions, last 30 days |
| Pending reviews | To review | transactions | count of `flagged_for_review = true` transactions |

"To review" value renders in red/alert color when > 0.  
Net worth delta shows ↑ green if positive, ↓ red if negative.

## Layout — Unauthenticated

Same header row. Stats band rendered at 30% opacity with `filter: blur(4px)` as a visual preview. Below it, an inline login card: "Enter your setup secret to continue", password input, and Unlock button. On successful auth, the blur lifts and the nav grid appears without a page reload.

## API Endpoint

`GET /home/stats` — cookie-authenticated, returns:

```json
{
  "netWorth": 48210.00,
  "netWorthDelta": 1240.00,
  "ccBalance": 2340.00,
  "ccCardCount": 3,
  "totalDebt": 187450.00,
  "savingsThisMonth": 340.00,
  "pendingReviews": 14
}
```

Calculations use the most recent `balance_snapshots` row per account. Savings is income minus expenses from `transactions` where `date >= now() - 30 days`.

## Nav Cards

Six cards in a 3-column grid. Cards with a non-zero actionable count show a badge:

| Card | Icon | Badge condition |
|---|---|---|
| Link Accounts | 🔗 | — |
| Review | 🔍 | pendingReviews > 0 → "N pending" (red) |
| Settings | ⚙️ | — |
| Paycheck | 💸 | — |
| Rules | 📋 | — |
| Apple Card | 🍎 | — |

## Auth Flow

1. Page loads → check `sessionStorage.ab_authed`
2. If set: fetch `/home/stats` with cookie. If 403: clear flag, show login. If ok: show full dashboard.
3. If not set: show blurred/login state immediately (skip the fetch).
4. On Unlock: POST `/auth` → on success set `sessionStorage.ab_authed = '1'`, fetch stats, animate dashboard in.
5. Sign out: GET `/auth/logout` → clears cookie, reloads page.

## Files Changed

- `public/index.html` — full rewrite
- `src/index.ts` — add `GET /home/stats` route
- `src/plaid/home.ts` — new file, `homeStatsHandler`
