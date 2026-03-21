// netlify/functions/get-country.js
// Returns the visitor's country code using Netlify's geo header.
// Falls back to 'DE' if the header is not present (e.g. local dev).

exports.handler = async (event) => {
  const country = (event.headers['x-nf-geo-country'] || 'DE').toUpperCase();
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    },
    body: JSON.stringify({ country })
  };
};
