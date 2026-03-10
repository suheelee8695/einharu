// netlify/functions/admin-update-stock.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { priceId, stock, adminKey } = JSON.parse(event.body || '{}');

    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
      return {
        statusCode: 401,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    if (!priceId || typeof stock !== 'number' || stock < 0) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid priceId or stock value' })
      };
    }

    const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
    const productId = price.product?.id;
    if (!productId) {
      return {
        statusCode: 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Product not found' })
      };
    }

    await stripe.products.update(productId, {
      metadata: { stock: String(Math.max(0, Math.round(stock))) }
    });

    console.log(`[admin] Stock updated: ${price.product?.name} → ${stock}`);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, priceId, stock, productName: price.product?.name })
    };

  } catch (e) {
    console.error('[admin-update-stock] error:', e.message);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
