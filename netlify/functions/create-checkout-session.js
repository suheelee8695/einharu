// netlify/functions/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ── Stripe stock helpers ──────────────────────────────────────────────────────

async function getStripeStock(priceId) {
  const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
  const stock = parseInt(price.product?.metadata?.stock ?? '-1', 10);
  return { stock, productId: price.product?.id, productName: price.product?.name };
}

async function setStripeStock(productId, newStock) {
  await stripe.products.update(productId, {
    metadata: { stock: String(Math.max(0, newStock)) }
  });
}

async function reserveStock(priceId) {
  const { stock, productId, productName } = await getStripeStock(priceId);
  if (stock < 0) {
    console.warn(`[stock] No metadata.stock for ${priceId} — skipping check`);
    return { ok: true, productId, productName, newStock: -1 };
  }
  if (stock <= 0) return { ok: false, productId, productName, newStock: 0 };
  await setStripeStock(productId, stock - 1);
  return { ok: true, productId, productName, newStock: stock - 1 };
}

async function restoreStock(priceId) {
  const { stock, productId } = await getStripeStock(priceId);
  if (stock < 0) return;
  await setStripeStock(productId, stock + 1);
  console.log(`[stock] Restored stock for ${priceId} → ${stock + 1}`);
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const {
      items, title, price, email, customer_email,
      promo_code = '',
      shipping_country = 'DE'
    } = JSON.parse(event.body || '{}');

    let line_items = [];
    let subtotal = 0;
    const reservations = [];

    if (Array.isArray(items) && items.length) {
      const normalized = items.map(i => ({
        price: i.price || i.stripePriceId,
        quantity: Math.max(1, Math.min(9, Number(i.quantity ?? i.qty ?? 1)))
      }));
      if (normalized.some(n => !n.price)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing Stripe Price ID in items.' }) };
      }

      // Check and reserve stock before creating session
      for (const item of normalized) {
        for (let i = 0; i < item.quantity; i++) {
          const result = await reserveStock(item.price);
          if (!result.ok) {
            // Restore anything already reserved
            for (const r of reservations) await restoreStock(r);
            return {
              statusCode: 400,
              body: JSON.stringify({
                error: `"${result.productName}" is sold out.`,
                soldOut: true,
                priceId: item.price
              })
            };
          }
          reservations.push(item.price);
        }
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

    const EU_COUNTRIES = new Set([
      'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
      'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'
    ]);
    const INTERNATIONAL_COUNTRIES = new Set([
      'AU','CA','CH','GB','HK','JP','NO','NZ','SG','US','AE'
    ]);
    const ALLOWED_COUNTRIES = [...new Set(['DE', ...EU_COUNTRIES, ...INTERNATIONAL_COUNTRIES])];

    const VALID_COUPONS = (process.env.COUPON_CODES || '')
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const code = (typeof promo_code === 'string' ? promo_code : '').trim().toUpperCase();
    const couponValid = !!code && VALID_COUPONS.includes(code);
    const shipCountry = (shipping_country || 'DE').toUpperCase();

    const shippingTier = shipCountry === 'DE'
      ? 'DE'
      : (EU_COUNTRIES.has(shipCountry) ? 'EU' : 'INTL');

    const shippingConfig = {
      DE: {
        label: 'Germany shipping',
        amount: subtotal >= 8000 ? 0 : 490,
        freeLabel: 'Free Germany shipping (orders over €80)'
      },
      EU: {
        label: 'EU shipping',
        amount: subtotal >= 15000 ? 0 : 990,
        freeLabel: 'Free EU shipping (orders over €150)'
      },
      INTL: {
        label: 'International shipping',
        amount: 1890
      }
    }[shippingTier];

    const shipping_options = [{
      shipping_rate_data: {
        display_name: couponValid && shippingTier !== 'INTL'
          ? 'Free shipping (coupon)'
          : (shippingConfig.amount === 0 ? shippingConfig.freeLabel : shippingConfig.label),
        type: 'fixed_amount',
        fixed_amount: {
          amount: couponValid && shippingTier !== 'INTL' ? 0 : shippingConfig.amount,
          currency: 'eur'
        },
        delivery_estimate: {
          minimum: { unit: 'business_day', value: 2 },
          maximum: { unit: 'business_day', value: shippingTier === 'INTL' ? 10 : 7 }
        }
      }
    }];

    const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'https://einharu.com';
    const priceIds = reservations.join(',');

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customer_email || email || undefined,
      line_items,
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: {
        allowed_countries: ALLOWED_COUNTRIES
      },
      shipping_options,
      expires_at: Math.floor(Date.now() / 1000) + (30 * 60),
      metadata: { reserved_price_ids: priceIds },
      success_url: `${CLIENT_ORIGIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_ORIGIN}/cancel.html`
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url, id: session.id })
    };
  } catch (e) {
    console.error('create-checkout-session error', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Failed to create session' }) };
  }
};
