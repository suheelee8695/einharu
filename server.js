// server.js — einHaru (CommonJS)
// Stock is now managed in Stripe Product metadata, not products.json

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app  = express();
const PORT = process.env.PORT || 4242;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5500';
const PRODUCTS_JSON_PATH    = process.env.PRODUCTS_JSON_PATH || path.resolve(__dirname, 'products.json');
const PROCESSED_LEDGER_PATH = process.env.PROCESSED_LEDGER_PATH || path.resolve(__dirname, 'processed_sessions.json');
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// NEW — Email alerts via nodemailer (optional, set ALERT_EMAIL + SMTP vars in .env)
const ALERT_EMAIL = process.env.ALERT_EMAIL || '';

console.log('[einHaru] Using products:', PRODUCTS_JSON_PATH);

app.use(cors({
  origin: [CLIENT_ORIGIN, 'http://localhost:5500', 'http://127.0.0.1:5500',
           'http://localhost:5501', 'http://127.0.0.1:5501'],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.static('.'));
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') return next();
  return express.json()(req, res, next);
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function loadLedger() { return readJSON(PROCESSED_LEDGER_PATH) || { processed: [] }; }
function isProcessed(id) { return loadLedger().processed.includes(id); }
function markProcessed(id) {
  const l = loadLedger();
  if (!l.processed.includes(id)) { l.processed.push(id); writeJSON(PROCESSED_LEDGER_PATH, l); }
}

// NEW — Get stock from Stripe Product metadata
async function getStripeStock(priceId) {
  const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
  const stock = parseInt(price.product?.metadata?.stock ?? '-1', 10);
  return { stock, productId: price.product?.id, productName: price.product?.name };
}

// NEW — Set stock in Stripe Product metadata
async function setStripeStock(productId, newStock) {
  await stripe.products.update(productId, {
    metadata: { stock: String(Math.max(0, newStock)) }
  });
  console.log(`[stock] Stripe product ${productId} stock → ${newStock}`);
}

// NEW — Decrement stock in Stripe, returns false if out of stock
async function reserveStock(priceId) {
  const { stock, productId, productName } = await getStripeStock(priceId);
  if (stock < 0) {
    // -1 means no stock tracking set up for this product — allow purchase
    console.warn(`[stock] No metadata.stock on product for price ${priceId} — skipping check`);
    return { ok: true, productId, productName, newStock: -1 };
  }
  if (stock <= 0) {
    return { ok: false, productId, productName, newStock: 0 };
  }
  const newStock = stock - 1;
  await setStripeStock(productId, newStock);
  return { ok: true, productId, productName, newStock };
}

// NEW — Restore stock in Stripe (called on session expiry)
async function restoreStock(priceId) {
  const { stock, productId, productName } = await getStripeStock(priceId);
  if (stock < 0) return; // no tracking
  const newStock = stock + 1;
  await setStripeStock(productId, newStock);
  console.log(`[stock] Restored: ${productName} → ${newStock}`);
}

// NEW — Mirror Stripe stock back to products.json (keeps frontend in sync)
async function syncStockToJson(priceId, newStock) {
  try {
    const products = readJSON(PRODUCTS_JSON_PATH);
    if (!Array.isArray(products)) return;
    const p = products.find(p => p.stripePriceId === priceId);
    if (!p) return;
    p.stock = newStock;
    writeJSON(PRODUCTS_JSON_PATH, products);
    console.log(`[stock] Synced products.json: ${p.title} → stock: ${newStock}`);
  } catch (e) {
    console.error('[stock] Failed to sync products.json:', e.message);
  }
}

// NEW — Optional email alert when item sells out
async function maybeSendSoldOutAlert(productName, priceId) {
  if (!ALERT_EMAIL) return;
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: ALERT_EMAIL,
      subject: `[einHaru] Sold out: ${productName}`,
      text: `"${productName}" (Price ID: ${priceId}) just sold its last unit.\n\nLog in to Stripe to update stock if you restock.`
    });
    console.log(`[alert] Sold-out email sent for ${productName}`);
  } catch (e) {
    console.error('[alert] Email failed:', e.message);
  }
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// NEW — Expose current stock from Stripe for the frontend
app.get('/stock/:priceId', async (req, res) => {
  try {
    const { stock, productName } = await getStripeStock(req.params.priceId);
    res.json({ priceId: req.params.priceId, stock, productName });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CHANGED — Now checks and reserves Stripe stock before creating session
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { title, price, email, customer_email, items } = req.body || {};

    let line_items = [];
    let subtotal = 0;
    const reservations = []; // track what we reserved so we can restore on error

    if (Array.isArray(items) && items.length) {
      const normalized = items.map(i => ({
        price: i.price || i.stripePriceId,
        quantity: Math.max(1, Math.min(9, Number(i.quantity ?? i.qty ?? 1)))
      }));
      if (normalized.some(n => !n.price)) {
        return res.status(400).json({ error: 'Missing Stripe Price ID in items.' });
      }

      // CHANGED — Check and reserve stock in Stripe BEFORE creating session
      for (const item of normalized) {
        for (let i = 0; i < item.quantity; i++) {
          const result = await reserveStock(item.price);
          if (!result.ok) {
            // Restore anything already reserved in this loop
            for (const r of reservations) await restoreStock(r);
            return res.status(400).json({
              error: `"${result.productName}" is sold out.`,
              soldOut: true,
              priceId: item.price
            });
          }
          reservations.push(item.price);
        }
      }

      // Fetch prices for subtotal
      const uniquePrices = [...new Set(normalized.map(n => n.price))];
      const priceMap = new Map();
      for (const pid of uniquePrices) {
        const p = await stripe.prices.retrieve(pid);
        priceMap.set(pid, p.unit_amount);
      }
      subtotal = normalized.reduce((sum, n) => sum + priceMap.get(n.price) * n.quantity, 0);
      line_items = normalized;

    } else {
      // Single product Buy Now fallback
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

    // CHANGED — Add metadata so webhook can restore stock if session expires
    const priceIds = (Array.isArray(items) && items.length)
      ? items.map(i => i.price || i.stripePriceId).filter(Boolean).join(',')
      : '';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customer_email || email || undefined,
      line_items,
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: {
        allowed_countries: [
          'DE','FR','NL','BE','LU','AT','IT','ES','PT','IE','FI','SE','DK',
          'PL','CZ','HU','SK','SI','HR','RO','BG','EE','LV','LT','MT','CY'
        ]
      },
      shipping_options,
      // NEW — session expires in 30 minutes so stock isn't held indefinitely
      expires_at: Math.floor(Date.now() / 1000) + (30 * 60),
      // NEW — store price IDs in metadata so expired webhook can restore stock
      metadata: { reserved_price_ids: priceIds },
      success_url: `${CLIENT_ORIGIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_ORIGIN}/cancel.html`
    });

    res.json({ url: session.url, id: session.id });
  } catch (e) {
    console.error('Create session error:', e);
    res.status(500).json({ error: e.message || 'Failed to create session' });
  }
});

// Retrieve session summary (unchanged)
app.get('/checkout-session/:id', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.id, {
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
    res.status(500).json({ error: 'Failed to retrieve checkout session' });
  }
});

// CHANGED — Webhook now handles session expiry (stock restore) in addition to completion
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {

      // CHANGED — On completed payment: sync stock to products.json + send alerts
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (isProcessed(session.id)) { console.log('[webhook] already processed:', session.id); break; }

        const resp = await stripe.checkout.sessions.listLineItems(session.id, {
          expand: ['data.price.product'], limit: 100
        });
        const lineItems = resp.data || [];

        for (const li of lineItems) {
          const priceId = li.price?.id;
          if (!priceId) continue;
          const { stock, productName } = await getStripeStock(priceId);
          // Sync to products.json
          await syncStockToJson(priceId, stock);
          // Alert if sold out
          if (stock === 0) await maybeSendSoldOutAlert(productName, priceId);
        }

        markProcessed(session.id);
        console.log('[webhook] Processed completed session:', session.id);
        break;
      }

      // NEW — On session expired: restore reserved stock back to Stripe
      case 'checkout.session.expired': {
        const session = event.data.object;
        const reservedIds = (session.metadata?.reserved_price_ids || '').split(',').filter(Boolean);
        console.log('[webhook] Session expired, restoring stock for:', reservedIds);
        for (const priceId of reservedIds) {
          await restoreStock(priceId);
          const { stock } = await getStripeStock(priceId);
          await syncStockToJson(priceId, stock);
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

// Product slug routing (unchanged)
const RESERVED_SLUGS = new Set([
  'health', 'create-checkout-session', 'checkout-session', 'webhook', 'stock',
  'netlify', 'images', 'events', 'de',
  'index', 'index.html', 'about', 'about.html', 'faq', 'faq.html',
  'returns', 'returns.html', 'privacy', 'privacy.html', 'editorial', 'editorial.html',
  'coming-soon', 'coming-soon.html', 'cancel', 'cancel.html', 'success', 'success.html',
  'product', 'product.html', 'korean-fashion-berlin', 'korean-fashion-berlin.html',
  'minimalist-fashion-berlin', 'minimalist-fashion-berlin.html',
  'seoul-berlin-minimalist-style-guide', 'seoul-berlin-minimalist-style-guide.html',
  'buy-korean-fashion-europe', 'buy-korean-fashion-europe.html',
  'robots.txt', 'sitemap.xml', 'site.webmanifest', 'favicon.ico'
]);
const isLikelyProductSlug = (slug) => {
  const s = String(slug || '').toLowerCase().trim();
  if (!s || s.includes('.') || s.includes('/')) return false;
  return !RESERVED_SLUGS.has(s);
};

app.get('/products/:slug', (req, res) => res.redirect(301, `/${encodeURIComponent(req.params.slug)}`));
app.get('/de/products/:slug', (req, res) => res.redirect(301, `/de/${encodeURIComponent(req.params.slug)}`));
app.get('/de/:slug', (req, res, next) => {
  if (!isLikelyProductSlug(req.params.slug)) return next();
  return res.sendFile(path.resolve(__dirname, 'de', 'product.html'));
});
app.get('/:slug', (req, res, next) => {
  if (!isLikelyProductSlug(req.params.slug)) return next();
  return res.sendFile(path.resolve(__dirname, 'product.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
