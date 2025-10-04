// netlify/functions/checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  try {
    const id = event.queryStringParameters?.id;
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };

    const session = await stripe.checkout.sessions.retrieve(id, {
      expand: ['line_items.data.price.product']
    });

    const body = {
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
    };

    return { statusCode: 200, body: JSON.stringify(body) };
  } catch (e) {
    console.error('checkout-session error', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to retrieve checkout session' }) };
  }
};
