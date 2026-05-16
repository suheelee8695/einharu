// netlify/functions/product-feed.js
// Generates a Google Merchant Center product feed in RSS 2.0 / Google Base XML format.
// Stock is read from Stripe Product metadata.stock (same logic as get-inventory.js).

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const products = require('../../products.json');

const SITE = 'https://www.einharu.com';

// GMC-optimized titles — used only in the feed, not on the website
const GMC_TITLES = {
  'stand-collar-hem-tie-top-black':          "einHaru Women's Stand Collar Tie Hem Crop Top – Black",
  'beaker-pants':                             "einHaru Women's Beaker Wide Leg Tailored Pants – Charcoal",
  'shearling-wrap-shirt':                     "einHaru Women's Shearling Wrap Oversized Shirt – Light Grey",
  'bijo-shirt':                               "einHaru Women's Bijo Layered Minimal Shirt – White",
  'pin-tuck-wide-leg-trouser-black':          "einHaru Women's Pin Tuck Wide Leg Trousers – Black",
  'stand-collar-hem-tie-top-ivory':           "einHaru Women's Stand Collar Tie Hem Crop Top – Ivory Cotton",
  'compact-leather-tote':                     "einHaru Women's Compact Leather Tote Bag – Brown",
  'sleeveless-shirt-dress-with-tulle-overlay':"einHaru Sleeveless Shirt Dress with Tulle Overlay – Black",
  'mesh-sheer-long-sleeve':                   "einHaru Women's Sheer Mesh Long Sleeve Top – Black",
  'crinkled-tiered-long-skirt-black':         "einHaru Crinkled Tiered Maxi Skirt – Black",
  'vegan-leather-v-neck-sleeveless-dress':    "einHaru Vegan Leather V-Neck Sleeveless Midi Dress – Black",
  'double-layer-sheer-mesh-long-sleeve-black':"einHaru Double-Layer Sheer Mesh Long Sleeve Top – Black",
  'draped-layered-top':                       "einHaru Women's Draped Layered Blouse Top – Black",
  'mesh-cropped-tank-wine':                   "einHaru Women's Cropped Mesh Tank Top – Wine Red",
  'fluid-wide-leg-pants-dark-blue':           "einHaru Fluid Wide-Leg Trousers – Dark Blue",
  'soft-volume-gathered-dress-black':         "einHaru Soft Volume Gathered Midi Dress – Black",
  'textured-leather-tote-bag':                "einHaru Textured Genuine Leather Tote Bag – Black",
  'vegan-leather-glossy-trench-coat-black':   "einHaru Women's Glossy Vegan Leather Trench Coat – Black",
  'washed-grey-raw-edge-denim-trousers':      "einHaru Women's Washed Grey Raw-Edge Denim Trousers",
  'zip-front-detachable-dungaree-dress':      "einHaru Women's Zip-Front Detachable Dungaree Dress – Black",
  'mesh-cropped-tank-white':                  "einHaru Women's Cropped Mesh Tank Top – White",
};

// Google Product Taxonomy numeric IDs — avoids Pinterest Warning 126 from separator-counting
// Reference: https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt
const GMC_CATEGORY = {
  dresses:    '2271',  // Apparel & Accessories > Clothing > Dresses
  tops:       '212',   // Apparel & Accessories > Clothing > Tops & Shirts
  pants:      '207',   // Apparel & Accessories > Clothing > Pants
  skirts:     '5598',  // Apparel & Accessories > Clothing > Skirts
  outerwear:  '5441',  // Apparel & Accessories > Clothing > Outerwear
  accessories:'2563',  // Apparel & Accessories > Handbags, Wallets & Cases > Handbags
};
const DEFAULT_CATEGORY = '212'; // Apparel & Accessories > Clothing > Tops & Shirts

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
      p => p.stripePriceId && p.releaseStatus === 'available' && !p.googleMerchantExclude
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

      // Extract color: explicit field first, then "Title - Color" suffix, then known color words
      const COLORS = ['Dark Blue', 'Dark Green', 'Dark Red', 'Black', 'White', 'Blue', 'Brown',
        'Grey', 'Gray', 'Ivory', 'Wine', 'Red', 'Green', 'Pink', 'Beige', 'Cream', 'Navy', 'Stripe'];
      const dashMatch = p.title.match(/\s[-–]\s*([^-–]+)$/);
      const colorFromDash = dashMatch ? dashMatch[1].trim() : null;
      const colorFromTitle = COLORS.find(c => new RegExp(`\\b${c}\\b`, 'i').test(p.title));
      const color = p.color || colorFromDash || colorFromTitle || null;

      const gmcTitle = GMC_TITLES[p.slug] || p.title;
      return `    <item>
      <g:id>${esc(p.slug)}</g:id>
      <g:title>${esc(gmcTitle)}</g:title>
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
      <g:shipping>
        <g:country>FI</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>SE</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>DK</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>PT</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>IE</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>GR</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>CZ</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>HU</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>RO</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>SK</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>SI</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>EE</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>LT</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>LV</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>HR</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      <g:shipping>
        <g:country>LU</g:country>
        <g:service>Standard Shipping</g:service>
        <g:price>9.90 EUR</g:price>
      </g:shipping>
      ${p.item_group_id ? `<g:item_group_id>${esc(p.item_group_id)}</g:item_group_id>` : ''}
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
