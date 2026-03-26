# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**einHaru** is a Korean minimalist fashion e-commerce boutique (Berlin-based). It's a static site with serverless backend functions, deployed on Netlify. No frontend framework — vanilla JS, HTML, CSS only.

## Deployment

```bash
# Draft preview (does not go live)
netlify deploy --dir=.

# Production deploy
netlify deploy --dir=. --prod
```

Pushes to `main` auto-deploy via Netlify. Add `[skip netlify]` to commit messages to suppress a build (e.g. for markdown-only changes).

Files that do NOT trigger a Netlify build: `*.md`, `.gitignore`, `.DS_Store`, `deno.lock`, `scripts/`, `.github/`

## No Tests

There are no automated tests. The `npm test` script exits with an error. QA is done manually via Netlify preview deploys.

## Architecture

**Static frontend + Netlify Functions (serverless Node.js)**

- `index.html` / `product.html` / etc. — HTML pages served statically
- `script.js` — Core app logic (product grid, detail pages, checkout, i18n, shipping calc)
- `cart.js` — Cart state management via `localStorage` (key: `eh_cart_v1`)
- `styles.css` — All styles
- `netlify/functions/` — Serverless backend functions
- `products.json` — Product catalog (static; source of truth for product definitions)
- `scripts/sync-inventory.js` — Nightly Notion→Stripe inventory sync (runs via GitHub Actions, not in browser)

**Internationalization:** `/de/` mirrors the English site. Language is detected via `document.documentElement.lang`. German pages are separate HTML files under `/de/`.

## Key Data Flows

### Inventory
- Product definitions live in `products.json`
- Live stock is stored in Stripe Product metadata (`.metadata.stock`)
  - `-1` = unlimited, `0` = sold out, `> 0` = available quantity
- Stock is reserved when checkout session is created, restored if session expires (via Stripe webhook)
- Nightly GitHub Action syncs Notion database → Stripe stock

### Checkout Flow
1. Cart stored in `localStorage`
2. `POST /.netlify/functions/create-checkout-session` → reserves stock, returns Stripe session URL
3. User completes payment on Stripe hosted checkout
4. `POST /.netlify/functions/webhook` → handles `checkout.session.completed` or `checkout.session.expired`

### Shipping Tiers
- **DE**: €4.90 (free over €80)
- **EU**: €9.90 (free over €150)
- **INTL**: €18.90 (fixed)
- Country detected via Netlify geo header (`/.netlify/functions/get-country`)

## Netlify Functions

All in `netlify/functions/`:

| Function | Purpose |
|---|---|
| `create-checkout-session.js` | POST: Creates Stripe session, reserves stock |
| `webhook.js` | POST: Handles Stripe payment/expiry events |
| `get-products.js` | GET: Returns products with live stock from Stripe |
| `get-inventory.js` | GET `?priceId=`: Stock for one product |
| `get-country.js` | GET: Visitor country via Netlify geo header |
| `checkout-session.js` | GET `?id=`: Retrieves Stripe session details |
| `product-feed.js` | GET: Google Merchant Center XML feed |
| `confirm-session-inventory.js` | Confirms inventory post-payment |
| `admin-update-stock.js` | POST: Manual stock updates (requires `ADMIN_KEY`) |

## Environment Variables

Required in `.env` (never committed):
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `CLIENT_ORIGIN`
- `ADMIN_KEY`
- `PROCESSED_LEDGER_PATH`
- `NOTION_API_KEY`, `NOTION_DATABASE_ID` (for sync script)
