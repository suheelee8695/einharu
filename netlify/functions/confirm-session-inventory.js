const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  try {
    // CHANGE 1: accept both ?id= and ?session_id=
    const qs = event.queryStringParameters || {};
    const id = qs.id || qs.session_id;
    if (!id) return { statusCode: 400, body: 'Missing session id' };

    console.log('[confirm] starting', { sessionId: id, keyPrefix: (process.env.STRIPE_SECRET_KEY || '').slice(0,7) + '…' });

    const session = await stripe.checkout.sessions.retrieve(id);
    console.log('[confirm] payment_status:', session.payment_status);

    if ((session.payment_status || '').toLowerCase() !== 'paid') {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ ok: true, skipped: 'not_paid' }),
      };
    }

    const li = await stripe.checkout.sessions.listLineItems(id, { limit: 100 });
    const purchasedPriceIds = (li.data || []).map(x => x.price?.id).filter(Boolean);
    console.log('[confirm] purchasedPriceIds:', purchasedPriceIds);

    if (!purchasedPriceIds.length) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ ok: true, skipped: 'no_line_items' }),
      };
    }

    // CHANGE 2: unify blobs call
    const store = getStore('inventory');
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
    console.error('[confirm] error', {
      message: e && e.message,
      type: e && e.type,
      code: e && e.code,
      statusCode: e && e.statusCode,
    });
    return { statusCode: 500, body: 'Failed to confirm inventory' };
  }
};
