// netlify/functions/get-inventory.js
const { getStore } = require('@netlify/blobs');

function getInventoryStoreStrict() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN;
  if (!siteID || !token) {
    throw new Error(`Missing Blobs config. Have NETLIFY_SITE_ID=${!!siteID} NETLIFY_BLOBS_TOKEN=${!!token}`);
  }
  return getStore({ name: 'inventory', siteID, token });
}

exports.handler = async () => {
  let sold = {};
  try {
    const store = getInventoryStoreStrict();
    sold = (await store.get('sold.json', { type: 'json' })) || {};
    console.log('[inventory] sold count:', Object.keys(sold).length);
  } catch (e) {
    console.error('[inventory] error:', e && e.message);
  }

  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, must-revalidate',
    },
    body: JSON.stringify({ sold }),
  };
};
