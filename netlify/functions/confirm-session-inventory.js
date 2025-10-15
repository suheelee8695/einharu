// netlify/functions/confirm-session-inventory.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore } = require('@netlify/blobs');

// Prefer Netlify's auto-wiring; fall back to manual env if needed
function getInventoryStore() {
  try {
    return getStore('inventory'); // auto (works when the runtime injects site + token)
  } catch (e) {
    const siteID = process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_BLOBS_TOKEN;
    if (!siteID || !token) {
      const err = new Error('Netlify Blobs not configured (missing NETLIFY_SITE_ID / NETLIFY_BLOBS_TOKEN)');
      err.details = { hasSiteID: !!siteID, hasToken: !!token };
      throw err;
    }
    return getStore({ name: 'inventory', siteID, token }); // manual
  }
}

exports.handler = async (event) => {
  try {
    // accept both ?id= and ?session_id=
    const qs = event.queryStringParameters || {};
    const id = qs.id || qs.session_id;
    if (!id) return { statusCode: 400, body: 'Missing session id' };

    console.log('[confirm] start', {
      sessionId: id,
      keyPrefix: (process.env.STRIPE_SECRET_KEY || '').slice(0, 7) + '…',
    });

    // 1) Retrieve session (must be sk_live_* for cs_live_*)
    const session = await stripe.checkout.sessions.retrieve(id);
    console.log('[confirm] payment_status:', session.payment_status);

    if ((session.payment_status || '').toLowerCase() !== 'paid') {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ ok: true, skipped: 'not_paid' }),
      };
    }

    // 2) Collect purchased Price IDs
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

    // 3) Read/merge/write inventory/sold.json with auto→manual fallback
    const store = getInventoryStore();
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
    const payload = {
      message: e && e.message,
      type: e && e.type,
      code: e && e.code,
      statusCode: e && e.statusCode,
      details: e && e.details,
      hint: 'If this mentions Netlify Blobs config, set NETLIFY_SITE_ID and NETLIFY_BLOBS_TOKEN in Netlify Prod env.',
    };
    console.error('[confirm] error', payload);
    // Return JSON while debugging so you can read it in the browser
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: false, error: payload }),
    };
  }
};
