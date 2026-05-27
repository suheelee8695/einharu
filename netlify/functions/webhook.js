// netlify/functions/webhook.js
exports.config = { body: 'raw' };
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore } = require('@netlify/blobs');

// ── Stripe stock helpers ─────────────────────────────────────────────────────

async function getStripeStock(priceId) {
  const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
  const stock = parseInt(price.product?.metadata?.stock ?? '-1', 10);
  return { stock, productId: price.product?.id, productName: price.product?.name };
}

async function setStripeStock(productId, newStock) {
  await stripe.products.update(productId, {
    metadata: { stock: String(Math.max(0, newStock)) }
  });
}

// ── Netlify Blobs helpers (auto-wire, manual fallback) ───────────────────────

function getBlobStore(name) {
  try {
    return getStore(name);
  } catch (e) {
    const siteID = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN;
    if (!siteID || !token) {
      throw new Error(`Netlify Blobs not configured for "${name}" (missing NETLIFY_SITE_ID / NETLIFY_BLOBS_TOKEN)`);
    }
    return getStore({ name, siteID, token });
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body || '', 'utf8');

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Idempotency: Stripe retries failed deliveries for up to 3 days.
  // Without dedup, retries of `checkout.session.expired` would restore stock
  // multiple times. We mark each event id in Netlify Blobs after success.
  let eventStore;
  try {
    eventStore = getBlobStore('webhook-events');
    const seen = await eventStore.get(stripeEvent.id);
    if (seen) {
      console.log('[webhook] duplicate event, skipping:', stripeEvent.id, stripeEvent.type);
      return { statusCode: 200, body: JSON.stringify({ ok: true, idempotent: true }) };
    }
  } catch (e) {
    // If Blobs is unavailable, fail-open: process the event. Better to occasionally
    // double-process than to drop events entirely.
    console.error('[webhook] idempotency store unavailable, processing anyway:', e.message);
    eventStore = null;
  }

  try {
    switch (stripeEvent.type) {

      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        if (session.payment_status && session.payment_status !== 'paid') {
          console.log('[webhook] not paid, skipping:', session.id);
          break;
        }
        // Stock was already decremented at reservation time — just log
        const reservedIds = (session.metadata?.reserved_price_ids || '').split(',').filter(Boolean);
        console.log('[webhook] Payment complete. Reserved IDs:', reservedIds);

        // Mark line items as sold in inventory/sold.json server-side.
        // (Previously done client-side from success.html via confirm-session-inventory,
        // which dropped writes if the customer closed the tab before the fetch landed.)
        try {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
          const priceIds = (lineItems.data || []).map(x => x.price?.id).filter(Boolean);
          if (priceIds.length) {
            const inventoryStore = getBlobStore('inventory');
            const current = (await inventoryStore.get('sold.json', { type: 'json' })) || {};
            for (const pid of priceIds) current[pid] = true;
            await inventoryStore.setJSON('sold.json', current);
            console.log('[webhook] Marked sold:', priceIds);
          }
        } catch (e) {
          console.error('[webhook] Failed to mark sold.json:', e.message);
        }
        break;
      }

      case 'checkout.session.expired': {
        const session = stripeEvent.data.object;
        const reservedIds = (session.metadata?.reserved_price_ids || '').split(',').filter(Boolean);
        console.log('[webhook] Session expired, restoring stock for:', reservedIds);
        for (const priceId of reservedIds) {
          const { stock, productId } = await getStripeStock(priceId);
          if (stock < 0) continue;
          await setStripeStock(productId, stock + 1);
          console.log(`[webhook] Restored: ${priceId} → ${stock + 1}`);
        }
        break;
      }

      case 'charge.refunded': {
        const charge = stripeEvent.data.object;
        // Only act on full refunds. Partial refunds (e.g., shipping-only) shouldn't
        // restore stock — handle those manually.
        if (!charge.refunded) {
          console.log('[webhook] Partial refund, not restoring stock:', charge.id, 'amount_refunded:', charge.amount_refunded);
          break;
        }
        if (!charge.payment_intent) {
          console.warn('[webhook] charge.refunded with no payment_intent:', charge.id);
          break;
        }
        const sessions = await stripe.checkout.sessions.list({
          payment_intent: charge.payment_intent,
          limit: 1
        });
        if (!sessions.data?.length) {
          console.warn('[webhook] no session found for refunded payment_intent:', charge.payment_intent);
          break;
        }
        const session = sessions.data[0];
        const reservedIds = (session.metadata?.reserved_price_ids || '').split(',').filter(Boolean);
        console.log('[webhook] Full refund: restoring stock for:', reservedIds);
        for (const priceId of reservedIds) {
          const { stock, productId, productName } = await getStripeStock(priceId);
          if (stock < 0) continue;
          await setStripeStock(productId, stock + 1);
          console.log(`[webhook] Refund restored: ${priceId} (${productName}) → ${stock + 1}`);
        }
        // Un-mark from sold.json so the items reappear in feeds / get-products.
        try {
          const inventoryStore = getBlobStore('inventory');
          const current = (await inventoryStore.get('sold.json', { type: 'json' })) || {};
          for (const pid of reservedIds) delete current[pid];
          await inventoryStore.setJSON('sold.json', current);
        } catch (e) {
          console.error('[webhook] Failed to un-mark sold.json:', e.message);
        }
        break;
      }

      default:
        break;
    }

    // Mark this event id as processed (only after the switch ran without throwing).
    if (eventStore) {
      try {
        await eventStore.setJSON(stripeEvent.id, { type: stripeEvent.type, ts: Date.now() });
      } catch (e) {
        console.error('[webhook] failed to mark event processed:', e.message);
      }
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    console.error('[webhook] handler failed:', err);
    return { statusCode: 500, body: 'Webhook handler failed.' };
  }
};
