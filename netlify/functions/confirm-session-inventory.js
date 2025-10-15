// netlify/functions/confirm-session-inventory.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  try {
    // Accept both ?id= and ?session_id=
    const qs = event.queryStringParameters || {};
    const id = qs.id || qs.session_id;
    if (!id) return { statusCode: 400, body: 'Missing session id' };

    // Fetch session and ensure it's paid
    const session = await stripe.checkout.sessions.retrieve(id);
    if ((session.payment_status || '').toLowerCase() !== 'paid') {
      console.log('[confirm] skipped not_paid:', id, session.payment_status);
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ ok: true, skipped: 'not_paid' }),
      };
    }

    // Get line items -> Price IDs
    const li = await stripe.checkout.sessions.listLineItems(id, { limit: 100 });
    const purchasedPriceIds = (li.data || []).map(x => x.price?.id).filter(Boolean);
    if (!purchasedPriceIds.length) {
      console.log('[confirm] no_line_items:', id);
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ ok: true, skipped: 'no_line_items' }),
      };
    }

    // Debug log (keep during validation)
    console.log('[confirm] id:', id, 'purchasedPriceIds:', purchasedPriceIds);

    // Write to the SAME blob your frontend reads
    const store = getStore('inventory');         // <- unified form
    const key = 'sold.json';
    const current = (await store.get(key, { type: 'json' })) || {};
    for (const pid of purchasedPriceIds) current[pid] = true;
    await store.setJSON(key, current);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: true, marked: purchasedPriceIds }),
    };
  } catch (e) {
    console.error('confirm-session-inventory error', e);
    return { statusCode: 500, body: 'Failed to confirm inventory' };
  }
};
