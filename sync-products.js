// HOW TO RUN:
// 1. npm install stripe dotenv (if not already installed)
// 2. node sync-products.js
// 3. Check summary table in console
// 4. Verify products in Stripe dashboard
// 5. Frontend price IDs are updated automatically by this script

require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fs = require('fs');
const path = require('path');

const PRODUCTS_JSON_PATH = path.join(__dirname, 'products.json');

// ── Product definitions ────────────────────────────────────────────────────────

// PART A: Update existing Londonflat products already in Stripe
// Korean → English name mapping based on products.json codebase convention
const LONDONFLAT_UPDATES = [
  {
    stripeName: 'Beaker Pants',      // 26ss-비커PT/차콜
    amount:     15900,               // 159.00 EUR
    stock:      5,
    jsonId:     'item-cs-02'
  },
  {
    stripeName: 'Bijo Shirt',        // 26ss-버튼업비조SH/아이
    amount:     10900,               // 109.00 EUR
    stock:      3,
    jsonId:     'item-cs-03'
  },
  {
    stripeName: 'Shearling Wrap Shirt', // 26ss-시어링랩SH/그레이
    amount:     12900,               // 129.00 EUR
    stock:      3,
    jsonId:     'item-cs-04'
  }
];

// PART B: Create new HELDER products (not yet in Stripe)
// English names match HELDER brand convention: "Descriptive Title – Color"
const HELDER_CREATES = [
  {
    stripeName: 'High-Neck Sleeveless Top \u2013 Black', // 홀하이넥슬리브리스Y/검
    amount:     10500,               // 105.00 EUR
    stock:      3,
    jsonId:     'item-29',
    slug:       'high-neck-sleeveless-top-black',
    productType: 'tops'
  },
  {
    stripeName: 'High-Neck Sleeveless Top \u2013 Ivory', // 홀하이넥슬리브리스Y/아
    amount:     10500,               // 105.00 EUR
    stock:      2,
    jsonId:     'item-30',
    slug:       'high-neck-sleeveless-top-ivory',
    productType: 'tops'
  },
  {
    stripeName: 'Textured Pleated Wide Slacks \u2013 Black', // 텍주름와이드SL/검
    amount:     13500,               // 135.00 EUR
    stock:      3,
    jsonId:     'item-31',
    slug:       'textured-pleated-wide-slacks-black',
    productType: 'pants'
  }
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function findProductByName(name) {
  let params = { limit: 100 };
  while (true) {
    const page = await stripe.products.list(params);
    const found = page.data.find(p => p.name === name);
    if (found) return found;
    if (!page.has_more) break;
    params.starting_after = page.data[page.data.length - 1].id;
  }
  // Also search inactive products
  params = { limit: 100, active: false };
  while (true) {
    const page = await stripe.products.list(params);
    const found = page.data.find(p => p.name === name);
    if (found) return found;
    if (!page.has_more) break;
    params.starting_after = page.data[page.data.length - 1].id;
  }
  return null;
}

async function getActivePriceForProduct(productId) {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 10 });
  return prices.data[0] || null;
}

function fmtEUR(cents) {
  return (cents / 100).toFixed(2) + ' EUR';
}

// ── PART A: Update existing Londonflat products ───────────────────────────────

async function updateLondonflatProduct(def) {
  const { stripeName, amount, stock, jsonId } = def;
  let productId, oldPriceId, newPriceId;

  try {
    // 1. Find product in Stripe by name
    const product = await findProductByName(stripeName);
    if (!product) {
      throw new Error(`Product not found in Stripe: "${stripeName}"`);
    }
    productId = product.id;

    // 2. Update metadata.stock on the product
    await stripe.products.update(productId, {
      metadata: { stock: String(stock) }
    });

    // 3. Find and archive current active price
    const oldPrice = await getActivePriceForProduct(productId);
    if (oldPrice) {
      oldPriceId = oldPrice.id;
      await stripe.prices.update(oldPriceId, { active: false });
    } else {
      oldPriceId = '(none)';
    }

    // 4. Create new price
    const newPrice = await stripe.prices.create({
      product: productId,
      unit_amount: amount,
      currency: 'eur'
    });
    newPriceId = newPrice.id;

    // 5. Update products.json
    updateProductsJson(jsonId, {
      price: amount / 100,
      stock,
      stripePriceId: newPriceId,
      releaseStatus: 'available'
    });

    return {
      action:    'UPDATED',
      name:      stripeName,
      productId,
      oldPriceId,
      newPriceId,
      amount:    fmtEUR(amount),
      error:     null
    };
  } catch (err) {
    console.error(`[ERROR] Failed to update "${stripeName}":`, err.message);
    return {
      action:    'FAILED',
      name:      stripeName,
      productId: productId || '—',
      oldPriceId: oldPriceId || '—',
      newPriceId: '—',
      amount:    fmtEUR(amount),
      error:     err.message
    };
  }
}

// ── PART B: Create new HELDER products ────────────────────────────────────────

async function createHelderProduct(def) {
  const { stripeName, amount, stock, jsonId, slug, productType } = def;
  let productId, newPriceId;

  try {
    // 1. Create Stripe product with stock metadata
    const product = await stripe.products.create({
      name: stripeName,
      metadata: { stock: String(stock) }
    });
    productId = product.id;

    // 2. Create price
    const price = await stripe.prices.create({
      product: productId,
      unit_amount: amount,
      currency: 'eur'
    });
    newPriceId = price.id;

    // 3. Add to products.json
    addProductToJson({
      id:          jsonId,
      title:       stripeName,
      price:       amount / 100,
      stock,
      category:    'collection',
      brand:       'HELDER',
      currency:    'EUR',
      defaultSize: 'One Size',
      cover:       '',
      images:      [],
      description: '',
      materials:   [],
      care:        [],
      stripePriceId: newPriceId,
      productType,
      releaseStatus: 'available',
      slug
    });

    return {
      action:    'CREATED',
      name:      stripeName,
      productId,
      oldPriceId: '—',
      newPriceId,
      amount:    fmtEUR(amount),
      error:     null
    };
  } catch (err) {
    console.error(`[ERROR] Failed to create "${stripeName}":`, err.message);
    return {
      action:    'FAILED',
      name:      stripeName,
      productId: productId || '—',
      oldPriceId: '—',
      newPriceId: '—',
      amount:    fmtEUR(amount),
      error:     err.message
    };
  }
}

// ── products.json helpers ─────────────────────────────────────────────────────

function loadProductsJson() {
  const raw = fs.readFileSync(PRODUCTS_JSON_PATH, 'utf8');
  return JSON.parse(raw);
}

function saveProductsJson(products) {
  fs.writeFileSync(PRODUCTS_JSON_PATH, JSON.stringify(products, null, 2) + '\n', 'utf8');
}

function updateProductsJson(jsonId, updates) {
  const products = loadProductsJson();
  const idx = products.findIndex(p => p.id === jsonId);
  if (idx === -1) {
    console.warn(`[products.json] Product with id "${jsonId}" not found — skipping JSON update.`);
    return;
  }
  products[idx] = { ...products[idx], ...updates };
  saveProductsJson(products);
}

function addProductToJson(newProduct) {
  const products = loadProductsJson();
  // Avoid duplicates
  if (products.find(p => p.id === newProduct.id)) {
    console.warn(`[products.json] Product "${newProduct.id}" already exists — updating instead.`);
    updateProductsJson(newProduct.id, newProduct);
    return;
  }
  products.push(newProduct);
  saveProductsJson(products);
}

// ── Summary table ─────────────────────────────────────────────────────────────

function printSummary(results) {
  const COL = {
    action:     8,
    name:       40,
    productId:  20,
    priceId:    24,
    amount:     12
  };
  const pad = (s, n) => String(s).padEnd(n);
  const line = () => console.log('-'.repeat(COL.action + COL.name + COL.productId + COL.priceId + COL.amount + 8));

  console.log('\n');
  line();
  console.log(
    pad('ACTION', COL.action) + ' | ' +
    pad('ENGLISH NAME', COL.name) + ' | ' +
    pad('PRODUCT ID', COL.productId) + ' | ' +
    pad('PRICE ID', COL.priceId) + ' | ' +
    pad('AMOUNT', COL.amount)
  );
  line();

  for (const r of results) {
    if (r.error) {
      console.log(
        pad('FAILED', COL.action) + ' | ' +
        pad(r.name, COL.name) + ' | ' +
        pad('ERROR: ' + r.error, COL.productId + COL.priceId + COL.amount + 5)
      );
    } else {
      console.log(
        pad(r.action, COL.action) + ' | ' +
        pad(r.name, COL.name) + ' | ' +
        pad(r.productId, COL.productId) + ' | ' +
        pad(r.newPriceId, COL.priceId) + ' | ' +
        pad(r.amount, COL.amount)
      );
      if (r.oldPriceId && r.oldPriceId !== '—' && r.oldPriceId !== '(none)') {
        console.log(
          pad('', COL.action) + '   ' +
          pad('  old price archived: ' + r.oldPriceId, COL.name + COL.productId + COL.priceId + COL.amount + 8)
        );
      }
    }
  }
  line();
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('ERROR: STRIPE_SECRET_KEY is not set in .env');
    process.exit(1);
  }

  console.log('Starting Stripe product sync...\n');
  const results = [];

  // PART A — Update 3 existing Londonflat products
  console.log('PART A: Updating Londonflat products...');
  for (const def of LONDONFLAT_UPDATES) {
    const result = await updateLondonflatProduct(def);
    results.push(result);
    console.log(`  ${result.action}: ${result.name}`);
  }

  // PART B — Create 3 new HELDER products
  console.log('\nPART B: Creating HELDER products...');
  for (const def of HELDER_CREATES) {
    const result = await createHelderProduct(def);
    results.push(result);
    console.log(`  ${result.action}: ${result.name}`);
  }

  printSummary(results);

  const failed = results.filter(r => r.error);
  if (failed.length) {
    console.log(`${failed.length} product(s) failed. Check errors above.`);
  } else {
    console.log('All products synced successfully. products.json has been updated.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
