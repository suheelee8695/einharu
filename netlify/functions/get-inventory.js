// netlify/functions/get-inventory.js
// Returns live stock from Stripe Product metadata for a given priceId
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  try {
    const priceId = (event.queryStringParameters || {}).priceId;
    if (!priceId) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Missing priceId' })
      };
    }

    const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
    const stock = parseInt(price.product?.metadata?.stock ?? '-1', 10);
    const productName = price.product?.name || '';

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store, must-revalidate'
      },
      body: JSON.stringify({ priceId, stock, productName })
    };
  } catch (e) {
    console.error('[get-inventory] error:', e.message);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
