// netlify/functions/webhook.js
exports.config = { body: 'raw' };
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // 1) Get the exact raw body Stripe signed (decode if Netlify set base64)
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

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;

        // (Optional) Only proceed when actually paid (defensive for async methods)
        if (session.payment_status && session.payment_status !== 'paid') {
          console.log('[webhook] session completed but not paid, skipping:', session.id, session.payment_status);
          break;
        }

        // 2) Fetch the line items -> get Price IDs
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
        const purchasedPriceIds = (lineItems.data || [])
          .map(li => li.price?.id)
          .filter(Boolean);

        if (!purchasedPriceIds.length) {
          console.warn('[webhook] no price ids found for session:', session.id);
          break;
        }

        // 3) Write to the SAME store/key your reader uses
        const store = getStore({ name: 'inventory' });
        const key = 'sold.json';

        const current = (await store.get(key, { type: 'json' })) || {};
        for (const pid of purchasedPriceIds) current[pid] = true;

        await store.setJSON(key, current);
        console.log('[webhook] sold updated:', { sessionId: session.id, purchasedPriceIds });
        break;
      }
      default:
        // ignore other events to keep logs quiet
        break;
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error('[webhook] handler failed:', err);
    return { statusCode: 500, body: 'Webhook handler failed.' };
  }
};
