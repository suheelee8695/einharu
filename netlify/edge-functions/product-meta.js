function esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildDesc(product) {
  const raw = Array.isArray(product.description)
    ? product.description[0]
    : product.description;
  const text = raw.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= 155) return text;
  const cut = text.slice(0, 155).lastIndexOf(' ');
  return text.slice(0, cut > 80 ? cut : 155) + '…';
}

export default async function handler(req, context) {
  const url = new URL(req.url);
  const { pathname } = url;

  // Skip static files and Netlify system paths
  if (pathname.includes('.') || pathname.startsWith('/.netlify/')) {
    return context.next();
  }

  // Only intercept single-segment paths (product slugs)
  const segments = pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  if (segments.length !== 1) return context.next();

  const slug = decodeURIComponent(segments[0]);

  // Fetch products catalog from CDN-cached static file
  const productsUrl = new URL('/products.json', req.url);
  const productsRes = await fetch(productsUrl);
  if (!productsRes.ok) return context.next();
  const products = await productsRes.json();

  const product = products.find((p) => p.slug === slug);
  if (!product) return context.next();

  const upstream = await context.next();
  const html = await upstream.text();

  const title = `${product.title} — einHaru`.slice(0, 60);
  const desc = buildDesc(product);
  const canonical = `https://www.einharu.com/${product.slug}`;
  const firstImage = product.images && product.images.length > 0
    ? product.images[0]
    : product.cover;
  const image = `https://www.einharu.com/${firstImage}`;
  const availability =
    product.releaseStatus === 'available'
      ? 'https://schema.org/InStock'
      : 'https://schema.org/PreOrder';
  const rawDesc = Array.isArray(product.description)
    ? product.description.join(' ')
    : product.description;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: product.title,
    image: product.images.map((img) => `https://www.einharu.com/${img}`),
    description: rawDesc,
    brand: { '@type': 'Brand', name: product.brand },
    offers: {
      '@type': 'Offer',
      url: canonical,
      priceCurrency: product.currency || 'EUR',
      price: String(product.price),
      availability,
      seller: { '@type': 'Organization', name: 'einHaru Collective' },
    },
  });

  let modified = html
    // Fix robots: noindex → index, follow (handles both attribute orders)
    .replace(
      /(<meta\s+name="robots"[^>]*\scontent=")noindex("[^>]*>)/,
      `$1index, follow$2`
    )
    .replace(
      /(<meta\s+content=")noindex("\s+name="robots"[^>]*>)/,
      `$1index, follow$2`
    )
    .replace(/(<title[^>]*>)[^<]*(<\/title>)/, `$1${esc(title)}$2`)
    .replace(
      /(<meta\s+name="description"[^>]*\scontent=")[^"]*(")/,
      `$1${esc(desc)}$2`
    )
    .replace(
      /(<meta\s+property="og:title"[^>]*\scontent=")[^"]*(")/,
      `$1${esc(title)}$2`
    )
    .replace(
      /(<meta\s+property="og:description"[^>]*\scontent=")[^"]*(")/,
      `$1${esc(desc)}$2`
    )
    .replace(
      /(<meta\s+property="og:url"[^>]*\scontent=")[^"]*(")/,
      `$1${canonical}$2`
    )
    .replace(
      /(<meta\s+property="og:image"[^>]*\scontent=")[^"]*(")/,
      `$1${image}$2`
    )
    .replace(
      /(<meta\s+property="og:type"[^>]*\scontent=")[^"]*(")/,
      `$1product$2`
    )
    .replace(
      /<link rel="canonical"([^>]*)>/,
      `<link rel="canonical"$1 href="${canonical}">`
    )
    .replace(
      '</head>',
      `<script type="application/ld+json">${jsonLd}</script>\n</head>`
    );

  const headers = new Headers(upstream.headers);
  headers.set('content-type', 'text/html; charset=utf-8');

  return new Response(modified, { status: upstream.status, headers });
}
