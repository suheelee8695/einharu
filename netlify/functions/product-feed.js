// netlify/functions/product-feed.js
// Generates a Google Merchant Center product feed in RSS 2.0 / Google Base XML format.
// Stock is read from Stripe Product metadata.stock (same logic as get-inventory.js).

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const products = require('../../products.json');

const SITE = 'https://www.einharu.com';

// Google product category taxonomy paths by productType
const GMC_CATEGORY = {
  dresses:    'Apparel & Accessories > Clothing > Dresses',
  tops:       'Apparel & Accessories > Clothing > Tops',
  pants:      'Apparel & Accessories > Clothing > Pants',
  skirts:     'Apparel & Accessories > Clothing > Skirts',
  outerwear:  'Apparel & Accessories > Clothing > Outerwear',
  accessories:'Apparel & Accessories > Handbags, Wallets & Cases',
};
const DEFAULT_CATEGORY = 'Apparel & Accessories > Clothing';

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmtPrice(amount) {
  return `${Number(amount).toFixed(2)} EUR`;
}

exports.handler = async () => {
  try {
    const available = products.filter(
      p => p.stripePriceId && p.releaseStatus === 'available'
    );

    // Fetch live stock for all products in parallel
    const stockResults = await Promise.all(
      available.map(p =>
        stripe.prices.retrieve(p.stripePriceId, { expand: ['product'] })
          .then(price => {
            const stock = parseInt(price.product?.metadata?.stock ?? '-1', 10);
            return {
              slug: p.slug,
              stripeProductId: price.product?.id || '',
              inStock: stock !== 0
            };
          })
          .catch(() => ({ slug: p.slug, stripeProductId: '', inStock: false }))
      )
    );

    const stockMap = new Map(stockResults.map(r => [r.slug, r]));

    const items = available.map(p => {
      const s = stockMap.get(p.slug) || {};
      const imageUrl = `${SITE}/${(p.cover || (p.images && p.images[0]) || '')}`;
      const additionalImages = (p.images || [])
        .slice(1, 4)
        .map(img => `<g:additional_image_link>${esc(`${SITE}/${img}`)}</g:additional_image_link>`)
        .join('\n      ');
      const category = GMC_CATEGORY[p.productType] || DEFAULT_CATEGORY;
      const availability = s.inStock ? 'in_stock' : 'out_of_stock';
      const gender = p.productType === 'accessories' ? 'unisex' : 'female';
      const rawSize = p.defaultSize || 'One Size';
      const size = /best eu/i.test(rawSize) ? 'One Size' : rawSize;

      // Extract color: try "Title - Color" suffix first, then known color words in title
      const COLORS = ['Dark Blue', 'Dark Green', 'Dark Red', 'Black', 'White', 'Blue', 'Brown',
        'Grey', 'Gray', 'Ivory', 'Wine', 'Red', 'Green', 'Pink', 'Beige', 'Cream', 'Navy', 'Stripe'];
      const dashMatch = p.title.match(/\s[-–]\s*([^-–]+)$/);
      const colorFromDash = dashMatch ? dashMatch[1].trim() : null;
      const colorFromTitle = COLORS.find(c => new RegExp(`\\b${c}\\b`, 'i').test(p.title));
      const color = colorFromDash || colorFromTitle || null;

      return `    <item>
      <g:id>${esc(p.slug)}</g:id>
      <g:title>${esc(p.title)}</g:title>
      <g:description>${esc(p.description || p.title)}</g:description>
      <g:link>${esc(`${SITE}/${p.slug}`)}</g:link>
      <g:image_link>${esc(imageUrl)}</g:image_link>
      ${additionalImages}
      <g:price>${fmtPrice(p.price)}</g:price>
      <g:availability>${availability}</g:availability>
      <g:condition>new</g:condition>
      <g:brand>${esc(p.brand || 'einHaru')}</g:brand>
      <g:google_product_category>${esc(category)}</g:google_product_category>
      <g:product_type>${esc(p.productType || 'clothing')}</g:product_type>
      <g:gender>${gender}</g:gender>
      <g:size>${esc(size)}</g:size>
      <g:age_group>adult</g:age_group>
      ${color ? `<g:color>${esc(color)}</g:color>` : ''}
      <g:shipping>
        <g:country>DE</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>4.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>FR</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>AT</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>NL</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>BE</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>IT</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>ES</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>PL</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:identifier_exists>no</g:identifier_exists>
    </item>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>einHaru Collective</title>
    <link>${SITE}</link>
    <description>Curated minimalist fashion from Berlin</description>
${items}
  </channel>
</rss>`;

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=3600'
      },
      body: xml
    };
  } catch (e) {
    console.error('[product-feed] error:', e.message);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/xml; charset=utf-8' },
      body: `<?xml version="1.0" encoding="UTF-8"?><error>${esc(e.message)}</error>`
    };
  }
};
