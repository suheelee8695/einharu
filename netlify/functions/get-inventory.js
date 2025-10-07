// netlify/functions/get-inventory.js
const { getStore } = require('@netlify/blobs');

exports.handler = async () => {
  try {
    const store = getStore({ name: 'inventory' });
    const sold = (await store.get('sold.json', { type: 'json' })) || {};
    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store, must-revalidate',
      },
      body: JSON.stringify({ sold }),
    };
  } catch (e) {
    console.error('get-inventory error', e);
    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store, must-revalidate',
      },
      body: JSON.stringify({ sold: {} }),
    };
  }
};
