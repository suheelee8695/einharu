// netlify/functions/webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    // IMPORTANT: event.body must be the raw string (Netlify provides this by default)
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;

        // Get purchased line items so we know which Price IDs were bought
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
        const purchasedPriceIds = (lineItems.data || [])
          .map(li => li.price?.id)
          .filter(Boolean);

        // Persist: mark those Price IDs as sold in Netlify Blobs
        const store = getStore({ name: 'inventory' }); // creates a logical store called "inventory"
        const key = 'sold.json';

        // read current (if any)
        let current = {};
        try {
          current = await store.get(key, { type: 'json' }) || {};
        } catch (_) { current = {}; }

        // set sold flags
        for (const pid of purchasedPriceIds) current[pid] = true;

        await store.setJSON(key, current);
        console.log('[webhook] sold updated:', purchasedPriceIds);
        break;
      }
      default:
        // ignore other events
        break;
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('Webhook handler failed:', err);
    return { statusCode: 500, body: 'Webhook handler failed.' };
  }
};
