// netlify/functions/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Flat €5 shipping; free over €100 (like your server.js)
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }
    const { items, title, price, email, customer_email } = JSON.parse(event.body || '{}');

    // Build line_items & subtotal (cents)
    let line_items = [];
    let subtotal = 0;

    if (Array.isArray(items) && items.length) {
      const normalized = items.map(i => ({
        price: i.price || i.stripePriceId,
        quantity: Math.max(1, Math.min(9, Number(i.quantity ?? i.qty ?? 1)))
      }));
      if (normalized.some(n => !n.price)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing Stripe Price ID in items.' }) };
      }
      const unique = [...new Set(normalized.map(n => n.price))];
      const priceMap = new Map();
      for (const pid of unique) {
        const p = await stripe.prices.retrieve(pid);
        if (!p || typeof p.unit_amount !== 'number') {
          return { statusCode: 400, body: JSON.stringify({ error: `Invalid Stripe Price: ${pid}` }) };
        }
        priceMap.set(pid, p.unit_amount);
      }
      subtotal = normalized.reduce((sum, n) => sum + priceMap.get(n.price) * n.quantity, 0);
      line_items = normalized;
    } else {
      if (!title || typeof price !== 'number') {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid payload for single-item checkout' }) };
      }
      const unitAmount = Math.round(price * 100);
      subtotal = unitAmount;
      line_items = [{
        price_data: {
          currency: 'eur',
          product_data: { name: title },
          unit_amount: unitAmount
        },
        quantity: 1
      }];
    }

    const showFree = subtotal >= 10000;
    const shipping_options = [
      {
        shipping_rate_data: {
          display_name: 'Standard Shipping',
          type: 'fixed_amount',
          fixed_amount: { amount: 500, currency: 'eur' },
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 2 },
            maximum: { unit: 'business_day', value: 7 }
          }
        }
      }
    ];
    if (showFree) {
      shipping_options.push({
        shipping_rate_data: {
          display_name: 'Free Shipping (orders over €100)',
          type: 'fixed_amount',
          fixed_amount: { amount: 0, currency: 'eur' },
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 2 },
            maximum: { unit: 'business_day', value: 7 }
          }
        }
      });
    }

    const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'https://einharu.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customer_email || email || undefined,
      line_items,
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: {
        allowed_countries: [
          'DE','FR','NL','BE','LU','AT','IT','ES','PT','IE','FI','SE','DK','PL','CZ','HU','SK','SI','HR','RO','BG','EE','LV','LT','MT','CY'
        ]
      },
      shipping_options,
      success_url: `${CLIENT_ORIGIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_ORIGIN}/cancel.html`
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url, id: session.id, _debug: { subtotal, showFree } })
    };
  } catch (e) {
    console.error('create-checkout-session error', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Failed to create session' }) };
  }
};
