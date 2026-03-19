// netlify/functions/get-products.js
// Returns all products with name, slug, url, category, inStock, and stripeProductId.
// inStock logic mirrors get-inventory.js: stock < 0 = unlimited (true), 0 = sold out (false), > 0 = in stock (true).
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const path = require('path');
const fs = require('fs');

exports.handler = async () => {
  try {
    const products = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'products.json'), 'utf8')
    );

    const available = products.filter(p => p.stripePriceId);
    const comingSoon = products.filter(p => !p.stripePriceId);

    // Fetch live stock for all available products in parallel
    const stockResults = await Promise.all(
      available.map(p =>
        stripe.prices.retrieve(p.stripePriceId, { expand: ['product'] })
          .then(price => {
            const stock = parseInt(price.product?.metadata?.stock ?? '-1', 10);
            return {
              priceId: p.stripePriceId,
              stripeProductId: price.product?.id || null,
              inStock: stock !== 0  // -1 = unlimited → true, 0 = sold out → false, >0 = has stock → true
            };
          })
      )
    );

    const stockMap = new Map(stockResults.map(r => [r.priceId, r]));

    const result = [
      ...available.map(p => {
        const s = stockMap.get(p.stripePriceId);
        return {
          name: p.title,
          slug: p.slug,
          url: `https://einharu.com/${p.slug}`,
          category: p.category,
          inStock: s ? s.inStock : false,
          stripeProductId: s?.stripeProductId || null
        };
      }),
      ...comingSoon.map(p => ({
        name: p.title,
        slug: p.slug,
        url: `https://einharu.com/${p.slug}`,
        category: p.category,
        inStock: false,
        stripeProductId: null
      }))
    ];

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store, must-revalidate'
      },
      body: JSON.stringify(result)
    };
  } catch (e) {
    console.error('[get-products] error:', e.message);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
