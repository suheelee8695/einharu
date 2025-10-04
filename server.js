// server.js — einHaru (CommonJS)

// 1) deps & config
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);

// 2) app constants
const app  = express();
const PORT = process.env.PORT || 4242;

// Frontend origin (Local file server / Live site)
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5500';

// Local data files
const PRODUCTS_JSON_PATH       = process.env.PRODUCTS_JSON_PATH       || path.resolve(__dirname, 'products.json');
const PROCESSED_LEDGER_PATH    = process.env.PROCESSED_LEDGER_PATH    || path.resolve(__dirname, 'processed_sessions.json');
const STRIPE_WEBHOOK_SECRET    = process.env.STRIPE_WEBHOOK_SECRET || '';

// NOTE: Shipping rate environment variables are no longer used.
// We previously relied on pre‑configured Shipping Rate IDs (SHR_* vars) to
// determine shipping costs based on country and order total. The new
// implementation computes shipping options directly in the checkout route
// (see `/create-checkout-session`), so these variables are intentionally
// omitted.  Keeping unused environment reads here could lead to
// confusion about configuration.
//
// If you ever need to reintroduce dynamic Shipping Rates, you can add
// environment variables here and reference them in your route handler.

console.log('[einHaru] Using products:', PRODUCTS_JSON_PATH);
console.log('[einHaru] Webhook ledger:', PROCESSED_LEDGER_PATH);

// 3) middleware (order matters)
// - CORS first
// Allow local development origins on common ports (5500, 5501). You can
// adjust this list or set CLIENT_ORIGIN in your .env to match your local dev server.
app.use(cors({
  origin: [
    CLIENT_ORIGIN,
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:5501',
    'http://127.0.0.1:5501'
  ],
  methods: ['GET', 'POST'],
  credentials: true
}));

// - Serve static files from this folder (index.html, product.html, etc.)
app.use(express.static('.'));

// - JSON body for everything EXCEPT /webhook (Stripe needs raw body)
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') return next();
  return express.json()(req, res, next);
});

// 4) helpers (json i/o + stock updates)
function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function loadLedger() {
  return readJSON(PROCESSED_LEDGER_PATH) || { processed: [] };
}
function isProcessed(id) {
  return loadLedger().processed.includes(id);
}
function markProcessed(id) {
  const l = loadLedger();
  if (!l.processed.includes(id)) {
    l.processed.push(id);
    writeJSON(PROCESSED_LEDGER_PATH, l);
  }
}
function updateStockFromLineItems(items) {
  const products = readJSON(PRODUCTS_JSON_PATH);
  if (!Array.isArray(products)) throw new Error(`Cannot read products at ${PRODUCTS_JSON_PATH}`);

  const qtyByPrice = new Map();
  for (const li of items) {
    const priceId = li.price?.id || li.price || li.price_id;
    const qty = Number(li.quantity || 0);
    if (!priceId || !qty) continue;
    qtyByPrice.set(priceId, (qtyByPrice.get(priceId) || 0) + qty);
  }

  let changed = false;
  for (const p of products) {
    const dec = qtyByPrice.get(p.stripePriceId);
    if (!dec) continue;
    const cur = Number(p.stock ?? 0);
    const next = Math.max(0, cur - dec);
    if (next !== cur) { p.stock = next; changed = true; }
  }

  if (changed) {
    console.log('[stock] writing new stocks...');
    for (const p of products) console.log(`[stock] ${p.id} "${p.title}" => stock: ${p.stock}`);
    writeJSON(PRODUCTS_JSON_PATH, products);
  }
  return changed;
}

// -----------------------------------------------------------------------------
// NOTE: chooseRateId() has been removed
// The old chooseRateId() helper determined which Shipping Rate ID to use
// based on the customer's country and order subtotal. As of the current
// implementation, we compute shipping options directly when creating a
// Checkout Session (see `/create-checkout-session` route below). This means
// there is no need to select pre‑created Shipping Rate IDs. Removing
// chooseRateId() cleans up unused code and reduces cognitive overhead.

// 6) routes

// Health check (optional)
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Create Checkout Session (flat €5 shipping; free over €100)
app.post('/create-checkout-session', async (req, res) => {
  try {
    const {
      title,
      price,
      email,
      customer_email,
      items
    } = req.body || {};

    console.log('[create-checkout-session] incoming:', {
      itemsCount: Array.isArray(items) ? items.length : 0,
      title,
      price
    });

    // 1) Build line_items and compute subtotal (in cents) on the server
    let line_items = [];
    let subtotal = 0; // in cents

    if (Array.isArray(items) && items.length) {
      // Cart flow: items with { price: 'price_...', quantity }
      // Normalize and validate
      const normalized = items.map(i => ({
        price: i.price || i.stripePriceId,
        quantity: Math.max(1, Math.min(9, Number(i.quantity ?? i.qty ?? 1)))
      }));
      if (normalized.some(n => !n.price)) {
        return res.status(400).json({ error: 'Missing Stripe Price ID in items.' });
      }
      // Fetch each unique price once to determine unit_amount
      const uniquePrices = [...new Set(normalized.map(n => n.price))];
      const priceMap = new Map();
      for (const pid of uniquePrices) {
        const p = await stripe.prices.retrieve(pid);
        if (!p || typeof p.unit_amount !== 'number') {
          return res.status(400).json({ error: `Invalid Stripe Price: ${pid}` });
        }
        priceMap.set(pid, p.unit_amount);
      }
      // Compute subtotal and prepare line_items (Stripe expects { price, quantity })
      subtotal = normalized.reduce((sum, n) => sum + priceMap.get(n.price) * n.quantity, 0);
      line_items = normalized;
    } else {
      // Single product “Buy Now” fallback: create ad-hoc price_data
      if (!title || typeof price !== 'number') {
        return res.status(400).json({ error: 'Invalid payload for single-item checkout' });
      }
      const unitAmount = Math.round(price * 100);
      subtotal = unitAmount;
      line_items = [{
        price_data: {
          currency: 'eur',
          product_data: { name: title },
          unit_amount: unitAmount
        },
        quantity: 1
      }];
    }

    // 2) Decide on shipping options: €5 standard; free if subtotal ≥ €100
    const showFree = subtotal >= 10000;
    const shipping_options = [
      {
        shipping_rate_data: {
          display_name: 'Standard Shipping',
          type: 'fixed_amount',
          fixed_amount: { amount: 500, currency: 'eur' },
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 2 },
            maximum: { unit: 'business_day', value: 7 }
          }
        }
      }
    ];
    if (showFree) {
      shipping_options.push({
        shipping_rate_data: {
          display_name: 'Free Shipping (orders over €100)',
          type: 'fixed_amount',
          fixed_amount: { amount: 0, currency: 'eur' },
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 2 },
            maximum: { unit: 'business_day', value: 7 }
          }
        }
      });
    }

    // 3) Create the checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customer_email || email || undefined,
      line_items,
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: {
        allowed_countries: [
          'DE','FR','NL','BE','LU','AT','IT','ES','PT','IE','FI','SE','DK','PL','CZ','HU','SK','SI','HR','RO','BG','EE','LV','LT','MT','CY'
        ]
      },
      shipping_options,
      success_url: `${CLIENT_ORIGIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_ORIGIN}/cancel.html`
    });

    res.json({ url: session.url, id: session.id, _debug: { subtotal, showFree } });
  } catch (e) {
    console.error('Create session error:', e);
    res.status(500).json({ error: e.message || 'Failed to create session' });
  }
});

// Retrieve a Checkout Session summary
app.get('/checkout-session/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const session = await stripe.checkout.sessions.retrieve(id, {
      expand: ['line_items.data.price.product']
    });
    res.json({
      id: session.id,
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      currency: session.currency,
      customer_details: session.customer_details || null,
      line_items: (session.line_items?.data || []).map(li => ({
        quantity: li.quantity,
        amount_subtotal: li.amount_subtotal,
        amount_total: li.amount_total,
        currency: li.currency,
        description: li.description || li.price?.product?.name || li.price?.id || 'Item',
        unit_amount: li.price?.unit_amount ?? null
      }))
    });
  } catch (e) {
    console.error('GET /checkout-session/:id error:', e);
    res.status(500).json({ error: 'Failed to retrieve checkout session' });
  }
});

// Stripe webhook (raw body required)
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const sessionId = session.id;
        if (isProcessed(sessionId)) { console.log('[webhook] already processed:', sessionId); break; }

        let lineItems = [];
        try {
          const resp = await stripe.checkout.sessions.listLineItems(sessionId, { expand: ['data.price'], limit: 100 });
          lineItems = resp.data || [];
          console.log('[webhook] line items:', lineItems.map(li => ({
            price: li.price?.id || li.price,
            qty: li.quantity
          })));
        } catch (e) {
          console.error('[webhook] listLineItems failed:', e);
          throw e;
        }

        try {
          const changed = updateStockFromLineItems(lineItems);
          console.log(changed ? '[webhook] stock updated for session:' : '[webhook] no matching products for session:', sessionId);
          markProcessed(sessionId);
        } catch (e) {
          console.error('[webhook] stock update failed:', e);
          throw e;
        }
        break;
      }
      default: break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).send('Webhook handler failed.');
  }
});

// 7) start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
