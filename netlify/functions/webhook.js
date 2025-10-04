// netlify/functions/webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  // Netlify passes the raw string body; use it directly for signature verification
  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed':
        // NOTE: No persistent storage available on Netlify’s ephemeral FS.
        // If you need stock sync, plug an external DB here.
        console.log('[webhook] checkout.session.completed received:', stripeEvent.data.object.id);
        break;
      default:
        break;
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('Webhook handler failed:', err);
    return { statusCode: 500, body: 'Webhook handler failed.' };
  }
};
