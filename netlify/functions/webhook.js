// netlify/functions/webhook.js
exports.config = { body: 'raw' };
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body || '', 'utf8');

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  try {
    switch (stripeEvent.type) {

      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        if (session.payment_status && session.payment_status !== 'paid') {
          console.log('[webhook] not paid, skipping:', session.id);
          break;
        }
        // Stock was already decremented at reservation time — just log
        const reservedIds = (session.metadata?.reserved_price_ids || '').split(',').filter(Boolean);
        console.log('[webhook] Payment complete. Reserved IDs:', reservedIds);
        break;
      }

      case 'checkout.session.expired': {
        const session = stripeEvent.data.object;
        const reservedIds = (session.metadata?.reserved_price_ids || '').split(',').filter(Boolean);
        console.log('[webhook] Session expired, restoring stock for:', reservedIds);
        for (const priceId of reservedIds) {
          const { stock, productId } = await getStripeStock(priceId);
          if (stock < 0) continue;
          await setStripeStock(productId, stock + 1);
          console.log(`[webhook] Restored: ${priceId} → ${stock + 1}`);
        }
        break;
      }

      default:
        break;
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    console.error('[webhook] handler failed:', err);
    return { statusCode: 500, body: 'Webhook handler failed.' };
  }
};
