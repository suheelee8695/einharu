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

  // Intercept single-segment (English) and /de/<slug> (German) product paths
  const segments = pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  let lang, slug;
  if (segments.length === 1) {
    lang = 'en';
    slug = decodeURIComponent(segments[0]);
  } else if (segments.length === 2 && segments[0] === 'de') {
    lang = 'de';
    slug = decodeURIComponent(segments[1]);
  } else {
    return context.next();
  }

  // Fetch products catalog from CDN-cached static file
  const productsUrl = new URL('/products.json', req.url);
  const productsRes = await fetch(productsUrl);
  if (!productsRes.ok) return context.next();
  const products = await productsRes.json();

  const product = products.find((p) => p.slug === slug);
  if (!product) return context.next();

  const upstream = await context.next();
  const html = await upstream.text();

  const title = (product.seoTitle || `${product.title} — einHaru`).slice(0, 60);
  const desc = product.seoDescription || buildDesc(product);
  // DE product pages have no German copy yet — point canonical to EN to avoid
  // Google clustering noindex'd DE pages as duplicates of each other.
  const canonicalPath = lang === 'de' ? `/${product.slug}` : `/${product.slug}`;
  const canonical = `https://www.einharu.com${canonicalPath}`;
  const enUrl = `https://www.einharu.com/${product.slug}`;
  const deUrl = `https://www.einharu.com/de/${product.slug}`;
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

  const priceValidUntil = new Date(new Date().getFullYear() + 1, 11, 31).toISOString().split('T')[0];

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: product.title,
    image: product.images.map((img) => `https://www.einharu.com/${img}`),
    description: rawDesc,
    brand: { '@type': 'Brand', name: product.brand },
    sku: product.id,
    offers: {
      '@type': 'Offer',
      url: canonical,
      priceCurrency: product.currency || 'EUR',
      price: String(product.price),
      priceValidUntil,
      availability,
      seller: { '@type': 'Organization', name: 'einHaru Collective' },
    },
  });

  // DE product pages serve English content from products.json (no localized
  // fields yet). Noindex them until German copy is added, so Google stops
  // clustering /de/<slug> as a duplicate of /<slug>.
  const robotsContent = lang === 'de' ? 'noindex, follow' : 'index, follow';

  let modified = html
    // Force robots to the lang-appropriate value (overrides whatever is in the file)
    .replace(
      /(<meta\s+name="robots"[^>]*\scontent=")[^"]*("[^>]*>)/,
      `$1${robotsContent}$2`
    )
    .replace(
      /(<meta\s+content=")[^"]*("\s+name="robots"[^>]*>)/,
      `$1${robotsContent}$2`
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
      /<link rel="canonical"[^>]*>/,
      `<link rel="canonical" id="canonical-link" href="${canonical}">`
    )
    .replace(
      /<link rel="alternate" hreflang="en"[^>]*>/,
      `<link rel="alternate" hreflang="en" href="${enUrl}" id="hreflang-en">`
    )
    // hreflang="de" intentionally omitted: DE product pages are noindex'd
    // until German copy is added (see robotsContent above). Pointing en→de
    // to a noindex page is wasted markup. Restore once /de/<slug> has real
    // localized content.
    .replace(
      /<link rel="alternate" hreflang="de"[^>]*>/,
      ''
    )
    .replace(
      /<link rel="alternate" hreflang="x-default"[^>]*>/,
      `<link rel="alternate" hreflang="x-default" href="${enUrl}" id="hreflang-xd">`
    )
    // Fill in main product image so the raw HTML response has real src + alt.
    // Without this Googlebot's first pass sees <img src="" alt=""> and the
    // image is invisible to Google Images. JS still re-renders client-side.
    .replace(
      /<img\s+id="main-image"[^>]*>/,
      `<img id="main-image" src="${image}" alt="${esc(product.title + ' | einHaru Collective')}" loading="eager" fetchpriority="high">`
    )
    // Inject product title into H1 so non-JS crawlers see a populated heading.
    .replace(
      /<h1\s+id="product-title"[^>]*><\/h1>/,
      `<h1 id="product-title">${esc(product.title)}</h1>`
    )
    .replace(
      '</head>',
      `<script type="application/ld+json">${jsonLd}</script>\n</head>`
    );

  const headers = new Headers(upstream.headers);
  headers.set('content-type', 'text/html; charset=utf-8');

  return new Response(modified, { status: upstream.status, headers });
}
