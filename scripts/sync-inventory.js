// scripts/sync-inventory.js
// Fetches all products from the Netlify get-products endpoint and syncs
// In Stock, Last Synced, and Stripe Product ID into the Notion Product Pages database.
// Matching: Product URL first, then Name as fallback.

const { Client } = require('@notionhq/client');

async function fetchPages(notion, databaseId) {
  const pages = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return pages;
}

function getPageUrl(page) {
  const prop = page.properties['Product URL'] || page.properties['URL'];
  if (!prop) return null;
  if (prop.type === 'url') return prop.url;
  if (prop.type === 'rich_text') return prop.rich_text?.[0]?.plain_text || null;
  return null;
}

function getPageName(page) {
  for (const key of ['Name', 'Product Name', 'Title']) {
    const prop = page.properties[key];
    if (prop?.type === 'title') return prop.title?.[0]?.plain_text || null;
  }
  return null;
}

async function main() {
  const { NETLIFY_PRODUCTS_URL, NOTION_TOKEN, NOTION_DATABASE_ID } = process.env;

  if (!NETLIFY_PRODUCTS_URL || !NOTION_TOKEN || !NOTION_DATABASE_ID) {
    console.error('Missing required env vars: NETLIFY_PRODUCTS_URL, NOTION_TOKEN, NOTION_DATABASE_ID');
    process.exit(1);
  }

  // 1. Fetch products from Netlify endpoint
  const res = await fetch(NETLIFY_PRODUCTS_URL);
  if (!res.ok) throw new Error(`Failed to fetch products: ${res.status} ${res.statusText}`);
  const products = await res.json();
  console.log(`Fetched ${products.length} products from endpoint`);

  // 2. Fetch all Notion pages
  const notion = new Client({ auth: NOTION_TOKEN });
  const pages = await fetchPages(notion, NOTION_DATABASE_ID);
  console.log(`Fetched ${pages.length} pages from Notion`);

  // 3. Build lookup maps
  const byUrl = new Map();
  const byName = new Map();
  for (const page of pages) {
    const url = getPageUrl(page);
    const name = getPageName(page);
    if (url) byUrl.set(url.replace(/\/$/, ''), page);
    if (name) byName.set(name.trim().toLowerCase(), page);
  }

  // 4. Sync each product
  const now = new Date().toISOString();
  let updated = 0;
  let skipped = 0;

  for (const product of products) {
    const normalizedUrl = product.url.replace(/\/$/, '');
    const page = byUrl.get(normalizedUrl) || byName.get(product.name.trim().toLowerCase());

    if (!page) {
      console.warn(`[skip] No Notion page found for: ${product.name} (${product.url})`);
      skipped++;
      continue;
    }

    const properties = {
      'In Stock': { checkbox: product.inStock },
      'Last Synced': { date: { start: now } }
    };

    if (product.stripeProductId) {
      properties['Stripe Product ID'] = {
        rich_text: [{ text: { content: product.stripeProductId } }]
      };
    }

    await notion.pages.update({ page_id: page.id, properties });
    console.log(`[ok] ${product.name} → inStock=${product.inStock}`);
    updated++;
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
