// netlify/functions/get-inventory.js
const { getStore } = require('@netlify/blobs');

exports.handler = async () => {
  let sold = {}; // default so we never crash

  try {
    // Use the named store exactly like the other functions
    const store = getStore('inventory'); // <- not { name: 'inventory' }
    const json = await store.get('sold.json', { type: 'json' });
    sold = json || {};

    // Log only AFTER sold is assigned
    console.log('[inventory] sold count:', Object.keys(sold).length);
  } catch (e) {
    console.error('[inventory] error:', e && e.message);
    // fall through returning empty map
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
