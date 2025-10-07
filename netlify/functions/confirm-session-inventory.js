// netlify/functions/confirm-session-inventory.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  try {
    const id = event.queryStringParameters?.id;
    if (!id) return { statusCode: 400, body: 'Missing session id' };

    // Fetch session and ensure it’s actually paid (works in TEST or LIVE)
    const session = await stripe.checkout.sessions.retrieve(id);
    if ((session.payment_status || '').toLowerCase() !== 'paid') {
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'not_paid' }) };
    }

    // Get line items -> Price IDs
    const li = await stripe.checkout.sessions.listLineItems(id, { limit: 100 });
    const purchasedPriceIds = (li.data || []).map(x => x.price?.id).filter(Boolean);
    if (!purchasedPriceIds.length) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'no_line_items' }) };
    }

    // Write to the SAME blob your frontend reads: inventory/sold.json
    const store = getStore({ name: 'inventory' });
    const key = 'sold.json';
    const current = (await store.get(key, { type: 'json' })) || {};
    for (const pid of purchasedPriceIds) current[pid] = true;
    await store.setJSON(key, current);

    return { statusCode: 200, body: JSON.stringify({ ok: true, marked: purchasedPriceIds }) };
  } catch (e) {
    console.error('confirm-session-inventory error', e);
    return { statusCode: 500, body: 'Failed to confirm inventory' };
  }
};
