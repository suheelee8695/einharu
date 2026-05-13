/* script.js — einHaru site core (no size selector)
   - Homepage grid (from products.json)
   - Product detail by clean /:slug or ?slug= or ?id=
   - Single-size display only (no selector)
   - Gallery + keyboard nav
   - Meta/OG + Schema injection
   - Vinted CTA OR Stripe checkout
   - Banner dismiss + current year
*/
(() => {
  'use strict';

  /*** CONFIG ***/
  const PRODUCTS_JSON = '/products.json';
  const CACHE_BUST = 'no-store'; // dev cache behaviour
  const LANG = (document.documentElement.lang || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
  const I18N = {
    en: {
      bagEmpty: 'Your bag is empty.',
      outOfStock: 'This item is out of stock.',
      promoEnter: 'Enter a promo code.',
      productNotFound: 'Product not found.',
      productNotFoundDesc: 'The URL may be outdated or the product is no longer available.',
      backToShop: 'Back to shop',
      badgeComingSoon: 'COMING SOON',
      badgeSoldOut: 'SOLD OUT',
      shippingNudgeDe: (remaining) => `Shipping: €4.90 to Germany · Add ${remaining} more for free delivery.`,
      shippingNudgeEu: (remaining) => `Shipping: €9.90 to EU · Add ${remaining} more for free delivery.`,
      shippingQualifiedDe: 'Free shipping to Germany.',
      shippingQualifiedEu: 'Free shipping across the EU.',
      shippingIntl: 'Shipping: €18.90 internationally · Free shipping is available for Germany and EU orders.',
      stockComing: 'Coming Soon',
      stockSoldOut: 'Sold Out',
      stockIn: 'In Stock',
      availableSoon: 'Available Soon',
      soldOut: 'Sold Out',
      alertAvailableSoon: 'This item will be available soon.',
      alertSoldOut: 'This item is sold out.',
      alertCartUnavailable: 'Cart unavailable.',
      alertMissingStripe: 'This item cannot be checked out yet (missing Stripe Price).',
      banner: 'Germany: €4.90 or free over €80. EU: €9.90 or free over €150. International: €18.90.'
    },
    de: {
      bagEmpty: 'Dein Warenkorb ist leer.',
      outOfStock: 'Dieser Artikel ist ausverkauft.',
      promoEnter: 'Bitte gib einen Rabattcode ein.',
      productNotFound: 'Produkt nicht gefunden.',
      productNotFoundDesc: 'Die URL ist eventuell veraltet oder das Produkt ist nicht mehr verfügbar.',
      backToShop: 'Zurück zum Shop',
      badgeComingSoon: 'BALD VERFUEGBAR',
      badgeSoldOut: 'AUSVERKAUFT',
      shippingNudgeDe: (remaining) => `Versand: 4,90 € nach Deutschland · Noch ${remaining} bis zum kostenlosen Versand.`,
      shippingNudgeEu: (remaining) => `Versand: 9,90 € in die EU · Noch ${remaining} bis zum kostenlosen Versand.`,
      shippingQualifiedDe: 'Kostenloser Versand nach Deutschland.',
      shippingQualifiedEu: 'Kostenloser Versand in die EU.',
      shippingIntl: 'Versand: 18,90 € international · Kostenloser Versand gilt für Deutschland und EU.',
      stockComing: 'Bald verfuegbar',
      stockSoldOut: 'Ausverkauft',
      stockIn: 'Auf Lager',
      availableSoon: 'Bald verfuegbar',
      soldOut: 'Ausverkauft',
      alertAvailableSoon: 'Dieser Artikel ist bald verfuegbar.',
      alertSoldOut: 'Dieser Artikel ist ausverkauft.',
      alertCartUnavailable: 'Warenkorb derzeit nicht verfuegbar.',
      alertMissingStripe: 'Dieser Artikel kann derzeit nicht zur Kasse gehen.',
      banner: 'Deutschland: 4,90 € oder kostenlos ab 80 €. EU: 9,90 € oder kostenlos ab 150 €. International: 18,90 €.'
    }
  };
  const t = (key, ...args) => {
    const val = I18N[LANG]?.[key] ?? I18N.en[key] ?? key;
    return typeof val === 'function' ? val(...args) : val;
  };
  const SHIPPING_REGIONS = {
    DE: { threshold: 80, price: 4.9, key: 'DE' },
    EU: { threshold: 150, price: 9.9, key: 'EU' },
    INTL: { threshold: null, price: 18.9, key: 'INTL' }
  };
  const SHIPPING_KEY = 'eh_shipping_country';
  const EU_COUNTRIES = new Set([
    'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
    'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'
  ]);
  const detectShippingRegion = (countryCode) => {
    const code = String(countryCode || 'DE').toUpperCase();
    if (code === 'DE') return 'DE';
    if (EU_COUNTRIES.has(code)) return 'EU';
    return 'INTL';
  };
  const getSelectedShippingCountry = () => {
    const inline = document.querySelector('[data-ship-country]')?.value;
    if (inline) return inline.toUpperCase();
    try { return (localStorage.getItem(SHIPPING_KEY) || 'DE').toUpperCase(); } catch (_) { return 'DE'; }
  };
  const getShippingMessage = (subtotal, currency = 'EUR') => {
    const region = detectShippingRegion(getSelectedShippingCountry());
    const config = SHIPPING_REGIONS[region];
    if (region === 'INTL') return t('shippingIntl');
    const remaining = Math.max(0, config.threshold - Number(subtotal || 0));
    if (remaining > 0) {
      return region === 'DE'
        ? t('shippingNudgeDe', fmtPrice(remaining, currency))
        : t('shippingNudgeEu', fmtPrice(remaining, currency));
    }
    return region === 'DE' ? t('shippingQualifiedDe') : t('shippingQualifiedEu');
  };

  /*** HELPERS ***/
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmtPrice = (n, currency = 'EUR') =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(Number(n || 0));
  const getQuery = (k) => new URLSearchParams(location.search).get(k);
  const RESERVED_SLUGS = new Set([
    '', 'de', 'products', 'events', 'images', 'netlify',
    'index', 'index.html', 'about', 'about.html', 'faq', 'faq.html',
    'returns', 'returns.html', 'privacy', 'privacy.html',
    'product', 'product.html', 'editorial', 'editorial.html',
    'coming-soon', 'coming-soon.html', 'cancel', 'cancel.html',
    'success', 'success.html', '404', '404.html',
    'minimalist-fashion-berlin', 'minimalist-fashion-berlin.html',
    'seoul-berlin-minimalist-style-guide', 'seoul-berlin-minimalist-style-guide.html',
    'korean-fashion-berlin', 'korean-fashion-berlin.html',
    'koreanische-mode-berlin', 'koreanische-mode-berlin.html',
    'robots.txt', 'sitemap.xml', 'site.webmanifest', 'favicon.ico'
  ]);
  const getSlugFromPathname = () => {
    const raw = String(location.pathname || '');
    const path = raw.toLowerCase().replace(/\/+$/, '');
    if (!path || path === '/') return '';
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) return '';
    const isDe = parts[0] === 'de';
    let candidate = '';
    if (isDe) {
      if (parts.length === 2) candidate = parts[1]; // /de/:slug
      else if (parts.length === 3 && parts[1] === 'products') candidate = parts[2]; // /de/products/:slug
    } else {
      if (parts.length === 1) candidate = parts[0]; // /:slug
      else if (parts.length === 2 && parts[0] === 'products') candidate = parts[1]; // /products/:slug
    }
    if (!candidate || candidate.includes('.') || RESERVED_SLUGS.has(candidate)) return '';
    return decodeURIComponent(candidate);
  };
  const getProductPath = (product) => {
    const slug = String(product?.slug || '').trim();
    if (!slug) return '/';
    const isDe = location.pathname.toLowerCase().startsWith('/de/');
    return isDe ? `/de/${encodeURIComponent(slug)}` : `/${encodeURIComponent(slug)}`;
  };
  const getAbsoluteProductUrl = (product) => {
    const urlSlug = String(getQuery('slug') || getSlugFromPathname() || '').trim();
    if (urlSlug) {
      const isDe = location.pathname.toLowerCase().startsWith('/de/');
      const cleanPath = isDe ? `/de/${encodeURIComponent(urlSlug)}` : `/${encodeURIComponent(urlSlug)}`;
      return new URL(cleanPath, location.origin).toString();
    }
    const path = getProductPath(product);
    if (!path) return location.href;
    return new URL(path, location.origin).toString();
  };
  const getProductState = (product) => {
    if ((product?.releaseStatus || '').toLowerCase() === 'coming_soon') return 'coming_soon';
    if (Number(product?.stock ?? 0) <= 0) return 'sold_out';
    return 'available';
  };
  const normalizeAssetPath = (val) => {
    if (typeof val !== 'string') return val;
    const s = val.trim();
    if (!s) return s;
    if (/^(https?:)?\/\//i.test(s) || s.startsWith('data:') || s.startsWith('blob:')) return s;
    if (s.startsWith('/')) return s;
    return `/${s.replace(/^\.?\//, '')}`;
  };
  const normalizeProductAssets = (product) => {
    if (!product || typeof product !== 'object') return product;
    const next = { ...product };
    if (typeof next.cover === 'string') next.cover = normalizeAssetPath(next.cover);
    if (Array.isArray(next.images)) next.images = next.images.map((img) => normalizeAssetPath(img));
    return next;
  };
  const ALT_STYLE_BY_TYPE = {
    en: {
      tops: 'Seoul minimalist tailoring',
      outerwear: 'oversized clean silhouette',
      dresses: 'structured drape',
      pants: 'wide-leg trousers minimal',
      skirts: 'refined proportions',
      accessories: 'small-run designer pieces',
      vintage: 'quiet luxury minimal'
    },
    de: {
      tops: 'minimalistische Seoul-Aesthetik',
      outerwear: 'oversized Silhouette clean',
      dresses: 'strukturierter Fall',
      pants: 'Wide-Leg Hose minimalistisch',
      skirts: 'praezise Proportionen',
      accessories: 'Kleinserien Designer-Mode',
      vintage: 'ruhiger Minimalismus'
    }
  };
  const buildProductImageAlt = (product, viewIndex = 0) => {
    const title = String(product?.title || (LANG === 'de' ? 'Produkt' : 'Product')).trim();
    const type = String(product?.productType || product?.type || '').toLowerCase();
    const styleLabel = ALT_STYLE_BY_TYPE[LANG]?.[type] || ALT_STYLE_BY_TYPE[LANG]?.tops;
    if (LANG === 'de') return `${title}, ${styleLabel}, Ansicht ${Number(viewIndex) + 1}`;
    return `${title}, ${styleLabel}, view ${Number(viewIndex) + 1}`;
  };

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: CACHE_BUST });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.json();
  }
// PDP Size overrides (for multi-size exceptions)
const SIZE_OVERRIDES = {
  // Barrel Pants — Ivory
  'item-11': { options: ['S','M'], disabled: ['S'], default: 'M',
               note: 'Model wore S (sold out). M in stock.' },
  // Barrel Pants — Black
  'item-21': { options: ['S','M'], disabled: ['S'], default: 'M',
               note: 'Model wore S (sold out). M in stock.' }
};

function renderSizeUI(product){
  const box  = document.querySelector('#product-sizes');
  const row  = document.querySelector('#size-chip-row');
  const note = document.querySelector('#size-note');
  if (!box || !row) return;

  row.innerHTML = '';
  if (note) note.textContent = '';

  // Prefer per-product JSON, then overrides
  const ov = SIZE_OVERRIDES[product.id];
  const hasData = Array.isArray(product.sizeOptions) && product.sizeOptions.length > 0;

  const options  = hasData ? product.sizeOptions : (ov?.options || null);
  const disabled = new Set(hasData ? (product.sizeDisabled || []) : (ov?.disabled || []));
  let   selected = hasData
    ? (product.sizeDefault || product.sizeOptions.find(s => !disabled.has(s)) || product.sizeOptions[0])
    : (ov?.default || (options && options.find(s => !disabled.has(s))));

  const fitDetail =
    (typeof product.fitNote === 'string' && product.fitNote.trim()) ||
    (typeof product.sizes   === 'string' && product.sizes.trim()) || '';

  // ===== One-size (no options) → show as selected & available (not disabled) =====
  if (!options) {
    const label =
      (typeof product.defaultSize === 'string' && product.defaultSize.trim()) || 'One Size';

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'size-chip is-static';
    chip.setAttribute('aria-pressed', 'true');       // looks selected
    chip.textContent = label;
    row.appendChild(chip);

    // store for cart/checkout meta
    try { sessionStorage.setItem('eh_selected_size_' + product.id, label); } catch(e){}

    if (fitDetail && note) { note.textContent = fitDetail; note.hidden = false; }
    box.hidden = false;
    return;
  }

  // ===== Multi-size (interactive) =====
  options.forEach(sz => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'size-chip';
    btn.textContent = sz;

    if (disabled.has(sz)) {
      btn.setAttribute('aria-disabled', 'true');     // greyed/dashed
    } else {
      if (sz === selected) btn.setAttribute('aria-pressed', 'true');
      btn.addEventListener('click', () => {
        [...row.querySelectorAll('.size-chip[aria-pressed="true"]')]
          .forEach(el => el.removeAttribute('aria-pressed'));
        btn.setAttribute('aria-pressed', 'true');
        selected = sz;
        try { sessionStorage.setItem('eh_selected_size_' + product.id, selected); } catch(e){}
      });
    }
    row.appendChild(btn);
  });

  try { sessionStorage.setItem('eh_selected_size_' + product.id, selected || ''); } catch(e){}
  if (fitDetail && note) { note.textContent = fitDetail; note.hidden = false; }
  box.hidden = false;
}


 

  /** Promo code UI wiring (safe on any page) */
function wirePromoUI() {
  // Look for the input and button; if not present, just exit silently.
  const input = document.querySelector('#promo-code');              // <-- your input
  const btn   = document.querySelector('[data-apply-promo]');       // <-- your Apply button

  if (!input || !btn) {
    // Not all pages have promo UI, so that's okay.
    return;
  }

  // Pre-fill from sessionStorage if user had applied before
  const saved = sessionStorage.getItem('promo_code') || '';
  if (saved && !input.value) input.value = saved;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const code = (input.value || '').trim();
    sessionStorage.setItem('promo_code', code);
    // Optional: tiny UI feedback
    btn.setAttribute('aria-live', 'polite');
    btn.textContent = code ? 'Applied' : 'Apply';
    // Optional: console marker to verify it ran
    console.log('[promo] stored promo_code =', code);
  });
}

/*** MOBILE PDP HELPERS ***/
function injectMobilePdpStyles(){
  if (document.getElementById('eh-mobile-pdp-css')) return;
  const css = `
  @media (max-width:768px){
    :root{
      --eh-top-offset: 0px;            /* 헤더+브레드크럼 높이 (JS가 셋팅) */
      --eh-sticky-h: 64px;             /* 하단 buy now 높이 */
      --eh-aspect-w: 3;                /* ← 기본 규격: 3:4 */
      --eh-aspect-h: 4;
      --eh-inner-pad: 16px;
    }

    /* 풀블리드 유틸리티 */
    .eh-fullbleed{ width:100vw; margin-left:50%; transform:translateX(-50%); }
    .eh-inner{ padding-left:var(--eh-inner-pad); padding-right:var(--eh-inner-pad); }

    /* Breadcrumb (상단 고정 + 풀블리드) */
    .eh-bc{ position:sticky; top:0; z-index:50; background:#fff; border-bottom:1px solid #eee; }
    .eh-bc .trail{ display:flex; gap:6px; white-space:nowrap; overflow-x:auto; scrollbar-width:none; -ms-overflow-style:none; }
    .eh-bc .trail::-webkit-scrollbar{ display:none; }
    .eh-bc .current{ max-width:56vw; overflow:hidden; text-overflow:ellipsis; display:inline-block; }
    .eh-bc{ composes: eh-fullbleed; }
    .eh-bc .trail{ composes: eh-inner; }

    /* ===== 모바일 갤러리: 기본 규격 3:4 프레임 =====
       - 높이 = min(뷰포트-상단오프셋, 3:4 비율 높이)
       - 필요시 cover로 바꾸면 ‘자동 크롭’ 일관 높이 유지
    */
    body.eh-pdp-mobile .eh-gallery{
      composes: eh-fullbleed;
      position:relative;
      height: min(
        calc(100svh - var(--eh-top-offset)),
        calc(100vw * (var(--eh-aspect-h) / var(--eh-aspect-w)))
      );
      background:#fff;
    }
    body.eh-pdp-mobile .eh-track{
      height:100%; display:flex; overflow-x:auto; overflow-y:hidden;
      scroll-snap-type:x mandatory; -webkit-overflow-scrolling:touch;
    }
    body.eh-pdp-mobile .eh-slide{
      position:relative;
      flex:0 0 100vw; height:100%;
      scroll-snap-align:center; display:grid; place-items:center;
      background:#efefef;                  /* 제품 배경 캔버스 */
    }
    body.eh-pdp-mobile .eh-slide img{
      width:100%; height:100%;
      object-fit: contain;                  /* ← 기본: 전체가 보이게 */
      object-position:center;
      display:block; margin:0;
    }
    /* 만약 ‘잘라서 통일’을 원하면 위 한 줄을 다음으로 변경
       object-fit: cover; background:#efefef; */

    body.eh-pdp-mobile .eh-swipe-hint{
      position:absolute; left:50%; bottom:60px; transform:translateX(-50%);
      font-size:12px; letter-spacing:0.08em; text-transform:uppercase;
      color:#535353; opacity:0.7; pointer-events:none; z-index:66;
      transition: opacity .35s ease, transform .35s ease;
    }
    body.eh-pdp-mobile .eh-swipe-hint.is-hidden{
      opacity:0; transform:translateX(-50%) translateY(6px);
    }

    body.eh-pdp-mobile .eh-gallery-arrow{
      position:absolute; top:50%; transform:translateY(-50%);
      width:34px; height:34px; border-radius:999px;
      border:1px solid rgba(83,83,83,0.18);
      background:rgba(255,255,255,0.86);
      color:#535353; font-size:16px; line-height:1;
      display:grid; place-items:center; z-index:65;
      box-shadow:0 2px 10px rgba(0,0,0,0.1);
      transition: opacity .2s ease;
    }
    body.eh-pdp-mobile .eh-gallery-arrow--left{ left:10px; }
    body.eh-pdp-mobile .eh-gallery-arrow--right{ right:10px; }
    body.eh-pdp-mobile .eh-gallery-arrow.is-disabled{ opacity:0.28; }

    body.eh-pdp-mobile .eh-tap-zone{
      position:absolute; top:0; bottom:0; width:50%; z-index:62;
      background:transparent;
    }
    body.eh-pdp-mobile .eh-tap-zone--left{ left:0; }
    body.eh-pdp-mobile .eh-tap-zone--right{ right:0; }

    /* 원래 이미지/썸네일은 모바일에서 숨김 */
    body.eh-pdp-mobile .eh-hide-mobile{ display:none !important; }

    /* Info 섹션: 풀블리드 + 내부 패딩 + sticky 버튼 피하기 */
    body.eh-pdp-mobile [data-product-info]{
      composes: eh-fullbleed eh-inner;
      padding-bottom: calc(24px + var(--eh-sticky-h));
      background:#fff;
    }

    .buy-now-sticky, .sticky-atc{ z-index:70; }
  }`;
  const style = document.createElement('style');
  style.id = 'eh-mobile-pdp-css';
  style.textContent = css;
  document.head.appendChild(style);
}


function initMobileGallery(product, opts={}){
  // 1) 환경
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (!isMobile || !product?.images?.length) return;

  document.body.classList.add('eh-pdp-mobile');
  injectMobilePdpStyles();

  // 2) 원본 이미지 영역(있으면) 숨김 표시용 클래스 부여
  const originalImageWrap =
    document.querySelector('#product-image-gallery') ||
    document.querySelector('.product-images') ||
    document.querySelector('[data-product-images]');
  if (originalImageWrap) originalImageWrap.classList.add('eh-hide-mobile');

  const thumbs = document.querySelector('.thumb-list');
  if (thumbs) thumbs.classList.add('eh-hide-mobile');

  const singleMain = document.querySelector('#main-image');
  if (singleMain) singleMain.classList.add('eh-hide-mobile');

  // 3) 갤러리 DOM 구성 (상단에 삽입)
  const host = document.querySelector('.product-detail-main') || document.body;
  const gallery = document.createElement('section');
  gallery.className = 'eh-gallery';
  const track = document.createElement('div'); track.className = 'eh-track';
  const hint = document.createElement('div');
  hint.className = 'eh-swipe-hint';
  hint.textContent = '← swipe →';
  const leftArrow = document.createElement('button');
  leftArrow.type = 'button';
  leftArrow.className = 'eh-gallery-arrow eh-gallery-arrow--left';
  leftArrow.setAttribute('aria-label', 'Previous image');
  leftArrow.textContent = '‹';
  const rightArrow = document.createElement('button');
  rightArrow.type = 'button';
  rightArrow.className = 'eh-gallery-arrow eh-gallery-arrow--right';
  rightArrow.setAttribute('aria-label', 'Next image');
  rightArrow.textContent = '›';
  const totalSlides = product.images.length;

  // 슬라이드 생성
  product.images.forEach((src, i) => {
    const slide = document.createElement('figure');
    slide.className = 'eh-slide';
    const img = document.createElement('img');
    img.src = src;
    img.alt = `${product.title || 'Product'} image ${i+1}`;
    img.loading = 'lazy';
    slide.appendChild(img);

    const tapLeft = document.createElement('div');
    tapLeft.className = 'eh-tap-zone eh-tap-zone--left';
    tapLeft.setAttribute('aria-hidden', 'true');
    const tapRight = document.createElement('div');
    tapRight.className = 'eh-tap-zone eh-tap-zone--right';
    tapRight.setAttribute('aria-hidden', 'true');
    slide.appendChild(tapLeft);
    slide.appendChild(tapRight);

    track.appendChild(slide);

  });

  gallery.appendChild(track);
  gallery.appendChild(leftArrow);
  gallery.appendChild(rightArrow);
  gallery.appendChild(hint);
  // 갤러리 DOM 구성 이후의 삽입 위치를 '브레드크럼 바로 아래'로
const bcWrap = document.querySelector('.product-breadcrumb');
if (bcWrap) {
  bcWrap.insertAdjacentElement('afterend', gallery);
} else {
  // 혹시 브레드크럼이 없으면 기존 방식으로 상단에 삽입
  host.prepend(gallery);
}

// 헤더/배너/브레드크럼 실제 높이를 합산해서 CSS 변수로 내려 보내기 (여백 보정)
const headerH = document.querySelector('.site-header')?.offsetHeight || 0;
const bannerH = document.querySelector('#site-banner')?.offsetHeight || 0;
const bcH     = bcWrap?.offsetHeight || 0;
document.documentElement.style.setProperty('--eh-top-offset', `${headerH + bannerH + bcH}px`);


  const getSlideWidth = () => Math.max(track.clientWidth || 0, 1);
  const getIndex = () => Math.round(track.scrollLeft / getSlideWidth());
  const goToIndex = (idx) => {
    const safe = Math.min(Math.max(idx, 0), totalSlides - 1);
    track.scrollTo({ left: safe * getSlideWidth(), behavior: 'smooth' });
  };

  // 인디케이터/네비 상태 활성화
  const setActive = () => {
    const idx = getIndex();
    leftArrow.classList.toggle('is-disabled', idx <= 0);
    rightArrow.classList.toggle('is-disabled', idx >= totalSlides - 1);
  };
  setActive();
  track.addEventListener('scroll', () => requestAnimationFrame(setActive));
  window.addEventListener('resize', setActive);

  leftArrow.addEventListener('click', () => goToIndex(getIndex() - 1));
  rightArrow.addEventListener('click', () => goToIndex(getIndex() + 1));

  track.querySelectorAll('.eh-tap-zone--left').forEach((zone) => {
    zone.addEventListener('click', () => goToIndex(getIndex() - 1));
  });
  track.querySelectorAll('.eh-tap-zone--right').forEach((zone) => {
    zone.addEventListener('click', () => goToIndex(getIndex() + 1));
  });

  setTimeout(() => {
    hint.classList.add('is-hidden');
  }, 2000);

  // 4) 모바일 breadcrumb 말줄임을 위한 title 동기화(선택)
  const bc = document.querySelector('#breadcrumb-title');
  if (bc && product.title) {
    const full = product.title.trim();
    bc.textContent = full.length > 50 ? full.slice(0,47) + '…' : full; // 모바일에서만 살짝 단축
    bc.title = full;
  }
}

  /*** SEO ***/
  function injectSchema(product) {
    if (!product) return;
    const productUrl = getAbsoluteProductUrl(product);
    const isDe = location.pathname.toLowerCase().startsWith('/de/');
    const homeUrl = isDe ? 'https://www.einharu.com/de/' : 'https://www.einharu.com/';
    const asAbs = (u) => {
      try { return new URL(u, location.origin).toString(); } catch (_) { return u; }
    };
    const images = Array.isArray(product.images) ? product.images.filter(Boolean).map(asAbs) : [];
    const desc = Array.isArray(product.description) ? product.description.join(' ') : (product.description || '');
    const availability = product.releaseStatus === 'coming_soon'
      ? 'https://schema.org/PreSale'
      : (product._soldOut || product.releaseStatus !== 'available')
      ? 'https://schema.org/OutOfStock'
      : 'https://schema.org/InStock';
    const productLd = {
      '@type': 'Product',
      '@id': `${productUrl}#product`,
      sku: product.id,
      name: product.title,
      image: images,
      description: desc,
      brand: {
        '@type': 'Brand',
        name: product.brand || 'einHaru Collective'
      },
      seller: {
        '@type': 'Organization',
        '@id': 'https://www.einharu.com/#organization',
        name: 'einHaru Collective'
      },
      offers: {
        '@type': 'Offer',
        url: productUrl,
        priceCurrency: product.currency || 'EUR',
        price: Number(product.price ?? 0).toFixed(2),
        availability,
        shippingDetails: [
          {
            '@type': 'OfferShippingDetails',
            shippingRate: { '@type': 'MonetaryAmount', value: '4.90', currency: 'EUR' },
            shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'DE' }
          },
          {
            '@type': 'OfferShippingDetails',
            shippingRate: { '@type': 'MonetaryAmount', value: '9.90', currency: 'EUR' },
            shippingDestination: [
              { '@type': 'DefinedRegion', addressCountry: 'AT' },
              { '@type': 'DefinedRegion', addressCountry: 'FR' },
              { '@type': 'DefinedRegion', addressCountry: 'NL' },
              { '@type': 'DefinedRegion', addressCountry: 'BE' },
              { '@type': 'DefinedRegion', addressCountry: 'IT' },
              { '@type': 'DefinedRegion', addressCountry: 'ES' },
              { '@type': 'DefinedRegion', addressCountry: 'PL' }
            ]
          },
          {
            '@type': 'OfferShippingDetails',
            shippingRate: { '@type': 'MonetaryAmount', value: '18.90', currency: 'EUR' },
            shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'ZZ' }
          }
        ],
        hasMerchantReturnPolicy: {
          '@type': 'MerchantReturnPolicy',
          applicableCountry: 'DE',
          returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
          merchantReturnDays: 14,
          returnMethod: 'https://schema.org/ReturnByMail',
          returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility'
        }
      }
    };

    const rawCategory = String(product?.productType || product?.category || '').trim();
    const hasCategory = rawCategory && !['all', 'new-arrivals'].includes(rawCategory.toLowerCase());
    const categoryLabel = hasCategory
      ? rawCategory
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, (ch) => ch.toUpperCase())
      : '';
    const categorySlug = hasCategory
      ? encodeURIComponent(rawCategory.toLowerCase().replace(/\s+/g, '-'))
      : '';

    const breadcrumbItems = [
      {
        '@type': 'ListItem',
        position: 1,
        item: {
          '@id': homeUrl,
          name: isDe ? 'Startseite' : 'Home'
        }
      }
    ];
    if (hasCategory) {
      breadcrumbItems.push({
        '@type': 'ListItem',
        position: 2,
        item: {
          '@id': `${homeUrl}#category-${categorySlug}`,
          name: categoryLabel
        }
      });
    }
    breadcrumbItems.push({
      '@type': 'ListItem',
      position: hasCategory ? 3 : 2,
      item: {
        '@id': productUrl,
        name: product.title || (isDe ? 'Produkt' : 'Product')
      }
    });

    const breadcrumbLd = {
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumbItems
    };

    const ld = {
      '@context': 'https://schema.org',
      '@graph': [productLd, breadcrumbLd]
    };
    let s = document.getElementById('eh-product-jsonld');
    if (!s) {
      s = document.createElement('script');
      s.id = 'eh-product-jsonld';
      s.type = 'application/ld+json';
      document.head.appendChild(s);
    }
    s.textContent = JSON.stringify(ld);
  }

  function setMeta(product) {
    const titleText = product?.title ? `${product.title} | einHaru Collective` : 'einHaru Collective';
    const descText = (Array.isArray(product?.description) ? product.description.join(' ') : product?.description) || 'Quiet daily wear from Berlin & Seoul.';
    const img = (product?.images || [])[0];

    document.title = titleText;

    const set = (sel, attr, val) => {
      const el = document.head.querySelector(sel);
      if (el && val) el.setAttribute(attr, val);
    };

    set('meta[name="description"]', 'content', descText);
    const productUrl = getAbsoluteProductUrl(product);
    set('link[rel="canonical"]', 'href', productUrl);
    set('meta[property="og:title"]', 'content', titleText);
    set('meta[property="og:description"]', 'content', descText);
    set('meta[property="og:type"]', 'content', 'website');
    set('meta[property="og:url"]', 'content', productUrl);
    if (img) set('meta[property="og:image"]', 'content', img);
  }

  /*** HOMEPAGE ***/
  function renderHomepage(products, releaseMode = 'available') {
    const grid = $('#product-grid');
    const comingSoonGrid = $('#coming-soon-grid');
    const comingSoonList = $('#coming-soon-list');
    const isComingSoonSplitView = releaseMode === 'coming_soon' && comingSoonGrid && comingSoonList;
    const isComingSoonListOnly = releaseMode === 'coming_soon' && !comingSoonGrid && !!comingSoonList;
    if (isComingSoonListOnly) {
      comingSoonList.classList.add('product-grid');
      comingSoonList.classList.remove('product-list');
      comingSoonList.classList.remove('product-grid--list');
    }
    const newestDropsGrid = $('#newest-drops-grid');
    if (!grid && !isComingSoonSplitView && !isComingSoonListOnly && !newestDropsGrid) return;
    const sortSelect = $('#sort-products');
    const viewBtns = $$('[data-view-toggle]');
    const typeBtns = $$('[data-product-type]');
    const VIEW_KEY = 'eh_shop_view';

    let currentFilter = 'all';
    let currentProductType = 'new-arrivals';
    let currentSort = (sortSelect?.value || 'featured').toLowerCase();
    const showComingSoonBadge = releaseMode === 'coming_soon';

    const sortedProducts = (items, sortMode) => {
      const list = [...items];
      switch (sortMode) {
        case 'availability':
          return list.sort((a, b) => {
            const aSoldOut = getProductState(a) === 'sold_out' ? 1 : 0;
            const bSoldOut = getProductState(b) === 'sold_out' ? 1 : 0;
            return aSoldOut - bSoldOut;
          });
        case 'price-asc': return list.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
        case 'price-desc': return list.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
        case 'name-asc': return list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
        default: return list;
      }
    };

    const filteredProducts = (items, filterMode, productTypeMode) => {
      let result = items.filter((p) => getProductState(p) !== 'sold_out');

      if (filterMode !== 'all') {
        result = result.filter((p) => (p.category || 'collection').toLowerCase() === filterMode);
      }

      if (productTypeMode && productTypeMode !== 'new-arrivals') {
        result = result.filter((p) => {
          const type = (p.productType || p.type || '').toLowerCase();
          const category = (p.category || '').toLowerCase();
          return type === productTypeMode || category === productTypeMode;
        });
      }

      return result;
    };

    const renderCardsToGrid = (targetGrid, list) => {
      if (!targetGrid) return;
      targetGrid.innerHTML = '';

      list.forEach((prod) => {
        const first = (prod.images && prod.images[0]) || prod.cover || '';
        const state = getProductState(prod);
        const showPrice = prod.price != null;
        const badgeHtml = state === 'coming_soon'
          ? `<span class="badge--comingsoon">${t('badgeComingSoon')}</span>`
          : (state === 'sold_out' ? `<span class="badge--soldout">${t('badgeSoldOut')}</span>` : '');

        const card = document.createElement('div');
        card.className = 'product-card';
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `${prod.title}, ${fmtPrice(prod.price, prod.currency || 'EUR')}`);
        card.dataset.category = (prod.category || 'collection').toLowerCase();
        const brand = prod.brand || (card.dataset.category === 'vintage' ? 'Vintage One-Off' : 'einHaru Collective');

        card.innerHTML = `
          <div class="card-image-wrapper">
            <img src="${first}" alt="${buildProductImageAlt(prod, 0)}" class="card-img primary" loading="lazy">
            ${badgeHtml}
          </div>
          <div class="card-info">
            <div class="card-brand">${brand}</div>
            <h2 class="card-title"><a href="${getProductPath(prod)}" tabindex="-1">${prod.title ?? ''}</a></h2>
            ${showPrice ? `<div class="card-price">${fmtPrice(prod.price, prod.currency || 'EUR')}</div>` : ''}
          </div>
        `;

        // Hover-cycle through all product images (desktop pointer devices).
        const images = Array.isArray(prod.images) ? prod.images.filter(Boolean) : [];
        if (images.length > 1) {
          const primaryImg = card.querySelector('.card-img.primary');
          let idx = 0;
          let timer = null;

          // Preload all images to reduce flicker while cycling.
          images.forEach((src) => {
            const img = new Image();
            img.src = src;
          });

          const stopCycle = () => {
            if (timer) clearInterval(timer);
            timer = null;
            idx = 0;
            if (primaryImg) {
              primaryImg.src = images[0];
              primaryImg.alt = buildProductImageAlt(prod, 0);
            }
          };

          card.addEventListener('mouseenter', () => {
            if (timer) return;
            timer = setInterval(() => {
              idx = (idx + 1) % images.length;
              if (primaryImg) {
                primaryImg.src = images[idx];
                primaryImg.alt = buildProductImageAlt(prod, idx);
              }
            }, 700);
          });

          card.addEventListener('mouseleave', stopCycle);
          card.addEventListener('blur', stopCycle);
        }

        const go = () => location.assign(getProductPath(prod));
        card.addEventListener('click', go);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

        targetGrid.appendChild(card);
      });
    };

    const renderRowsToList = (targetList, list) => {
      if (!targetList) return;
      targetList.innerHTML = '';

      list.forEach((prod) => {
        const state = getProductState(prod);
        const showPrice = prod.price != null;
        const img = (prod.images && prod.images[0]) || prod.cover || '';
        const badgeHtml = state === 'coming_soon'
          ? `<span class="badge--comingsoon">${t('badgeComingSoon')}</span>`
          : (state === 'sold_out' ? `<span class="badge--soldout">${t('badgeSoldOut')}</span>` : '');
        const brand = prod.brand || ((prod.category || '').toLowerCase() === 'vintage' ? 'Vintage One-Off' : 'einHaru Collective');
        const row = document.createElement('article');
        row.className = 'product-list-item';
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', `${prod.title}, ${fmtPrice(prod.price, prod.currency || 'EUR')}`);
        row.innerHTML = `
          <div class="product-list-thumb">
            <img src="${img}" alt="${buildProductImageAlt(prod, 0)}" loading="lazy">
            ${badgeHtml}
          </div>
          <div class="product-list-info">
            <div class="card-brand">${brand}</div>
            <h2 class="card-title"><a href="${getProductPath(prod)}" tabindex="-1">${prod.title ?? ''}</a></h2>
            ${showPrice ? `<div class="card-price">${fmtPrice(prod.price, prod.currency || 'EUR')}</div>` : ''}
          </div>
        `;

        const go = () => location.assign(getProductPath(prod));
        row.addEventListener('click', go);
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        targetList.appendChild(row);
      });
    };

    const renderCards = () => {
      const scopedProducts = products.filter((p) => {
        const state = getProductState(p);
        return releaseMode === 'coming_soon' ? state === 'coming_soon' : state !== 'coming_soon';
      });

      const visible = sortedProducts(
        filteredProducts(scopedProducts, currentFilter, currentProductType),
        currentSort
      );

      if (isComingSoonSplitView) {
        renderCardsToGrid(comingSoonGrid, visible);
        renderRowsToList(comingSoonList, visible);
      } else if (isComingSoonListOnly) {
        renderCardsToGrid(comingSoonList, visible);
      } else {
        renderCardsToGrid(grid, visible);
      }
    };

    const setView = (view) => {
      const mode = view === 'list' ? 'list' : 'grid';
      if (!isComingSoonSplitView && grid) {
        grid.classList.toggle('product-grid--list', mode === 'list');
      }
      document.body.classList.remove('view--grid', 'view--list');
      document.body.classList.add(`view--${mode}`);
      viewBtns.forEach((btn) => {
        const active = btn.dataset.viewToggle === mode;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
      try { localStorage.setItem(VIEW_KEY, mode); } catch (_) {}
    };

    renderCards();

    if (newestDropsGrid) {
      const brandsAttr = newestDropsGrid.dataset.brands;
      const brandFilter = brandsAttr ? brandsAttr.split(',').map(b => b.trim()) : null;
      const available = products.filter(p =>
        getProductState(p) !== 'coming_soon' &&
        (!brandFilter || brandFilter.includes(p.brand))
      ).slice(0, 6);
      renderCardsToGrid(newestDropsGrid, available);
    }

    if (typeBtns.length) {
      typeBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          currentProductType = (btn.dataset.productType || 'new-arrivals').toLowerCase();
          typeBtns.forEach((t) => {
            const on = t === btn;
            t.classList.toggle('is-active', on);
            t.setAttribute('aria-pressed', String(on));
          });
          renderCards();
        });
      });
    }

    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        currentSort = (sortSelect.value || 'featured').toLowerCase();
        renderCards();
      });
    }

    if (viewBtns.length) {
      viewBtns.forEach((btn) => {
        btn.addEventListener('click', () => setView(btn.dataset.viewToggle || 'grid'));
      });
      setView('grid');
    }
  }

  /*** PRODUCT PAGE ***/
  function renderProductPage(products) {
    const renderProductError = (titleText, descText) => {
      const homeHref = LANG === 'de' ? '/de/' : '/';
      const main = $('.product-detail-main') || document.body;
      main.innerHTML = `
        <section class="status-page" aria-live="polite">
          <div class="status-wrap">
            <div class="status-eyebrow">Product</div>
            <h1 class="status-title">${titleText}</h1>
            <p class="status-desc">${descText}</p>
            <div class="status-actions">
              <a href="${homeHref}" class="button-primary">${t('backToShop')}</a>
            </div>
          </div>
        </section>
      `;
    };

    const slug = String(getQuery('slug') || getSlugFromPathname() || '').trim();
    const id = String(getQuery('id') || '').trim();
    if (!slug && !id) {
      renderProductError(t('productNotFound'), t('productNotFoundDesc'));
      return;
    }

    const product = Array.isArray(products)
      ? products.find((p) => (slug ? p.slug === slug : p.id === id))
      : (products && (
          (slug ? Object.values(products).find((p) => p?.slug === slug) : null) ||
          (id ? products[id] : null)
        ));

    if (!product) {
      console.warn('Product not found for params:', { slug, id });
      renderProductError(t('productNotFound'), t('productNotFoundDesc'));
      return;
    }

    // If loaded via legacy ?id= param, redirect to the clean slug URL.
    if (!slug && id && product.slug) {
      const isDe = location.pathname.toLowerCase().startsWith('/de/');
      const cleanUrl = isDe
        ? `/de/${encodeURIComponent(product.slug)}`
        : `/${encodeURIComponent(product.slug)}`;
      window.location.replace(cleanUrl);
      return;
    }

    // Keep EN/DE switcher page-to-page on PDP.
    const productSlug = product.slug || slug;
    const langLinks = $$('.language-switcher a');
    if (langLinks.length && productSlug) {
      langLinks.forEach((a) => {
        const label = (a.textContent || '').trim().toLowerCase();
        if (label === 'de') a.setAttribute('href', `/de/${encodeURIComponent(productSlug)}`);
        if (label === 'en') a.setAttribute('href', `/${encodeURIComponent(productSlug)}`);
      });
    }

    // Meta & schema
    setMeta(product);
    injectSchema(product);
    initMobileGallery(product);

    // Static UI
    $('#breadcrumb-title') && ($('#breadcrumb-title').textContent = product.title || '');
    $('#back-button')?.addEventListener('click', () => history.back());
    $('#product-brand') && ($('#product-brand').textContent = product.brand || 'einHaru Collective');
    $('#product-collection') && ($('#product-collection').textContent =
      ((product.category || '').toLowerCase() === 'vintage' ? 'einHaru Vintage' : 'einHaru Collection'));
    $('#product-title') && ($('#product-title').textContent = product.title || '');
    const subtitleEl = $('#product-subtitle');
    if (subtitleEl) {
      const subtitle = (product.subtitle || '').trim();
      if (subtitle) {
        subtitleEl.textContent = subtitle;
        subtitleEl.hidden = false;
      } else {
        subtitleEl.hidden = true;
      }
    }
    $('#product-price') && ($('#product-price').textContent = fmtPrice(product.price, product.currency || 'EUR'));
    const updateProductShippingUI = () => {
      const shippingNudge = $('#shipping-nudge');
      if (!shippingNudge) return;
      const region = detectShippingRegion(getSelectedShippingCountry());
      const subtotal = Number(product.price || 0);
      const qualified = region === 'DE'
        ? subtotal >= SHIPPING_REGIONS.DE.threshold
        : (region === 'EU' ? subtotal >= SHIPPING_REGIONS.EU.threshold : false);
      shippingNudge.textContent = getShippingMessage(subtotal, product.currency || 'EUR');
      shippingNudge.classList.toggle('shipping-nudge--qualified', qualified);
      shippingNudge.classList.toggle('shipping-nudge--neutral', region === 'INTL');
    };
    updateProductShippingUI();
    document.querySelectorAll('[data-ship-country]').forEach((select) => {
      if (select.dataset.boundShippingChange === 'true') return;
      select.dataset.boundShippingChange = 'true';
      const current = getSelectedShippingCountry();
      if (current) select.value = current;
      select.addEventListener('change', () => {
        try { localStorage.setItem(SHIPPING_KEY, select.value.toUpperCase()); } catch (_) {}
        updateProductShippingUI();
      });
    });
    const stockStateEl = $('#product-stock-state');
    if (stockStateEl) {
      if (getProductState(product) === 'coming_soon') {
        stockStateEl.className = 'stock-state stock-state--coming';
        stockStateEl.textContent = t('stockComing');
      } else if (getProductState(product) === 'sold_out') {
        stockStateEl.className = 'stock-state stock-state--soldout';
        stockStateEl.textContent = t('stockSoldOut');
      } else {
        stockStateEl.className = 'stock-state stock-state--in';
        stockStateEl.textContent = t('stockIn');
      }
    }

    // Measurements / Size details (always visible)
    const measEl = $('#product-measurements');
    if (measEl) {
      measEl.innerHTML = '';
      if (Array.isArray(product.sizeDetails)) {
        product.sizeDetails.filter(Boolean).forEach((line) => {
          const div = document.createElement('div'); div.textContent = line; measEl.appendChild(div);
        });
      } else if (product.measurements && typeof product.measurements === 'object') {
        Object.entries(product.measurements).forEach(([k, v]) => {
          const div = document.createElement('div'); div.innerHTML = `<strong>${k}:</strong> ${v}`; measEl.appendChild(div);
        });
      }
    }

    // Description
    const descEl = $('#product-description');
    if (descEl) {
      const d = product.description;
      const text = Array.isArray(d) ? d.join(' ') : (d || '');
      descEl.textContent = text;
    }

    // Materials & Care
    const matEl = $('#product-materials');
    if (matEl) {
      matEl.innerHTML = '';
      const mats = Array.isArray(product.materials) ? product.materials.filter(Boolean) : [];
      mats.forEach((m) => { const div = document.createElement('div'); div.textContent = m; matEl.appendChild(div); });
    }
    const careEl = $('#product-care');
    if (careEl) {
      careEl.innerHTML = '';
      if (Array.isArray(product.care)) {
        product.care.filter(Boolean).forEach((c) => { const div = document.createElement('div'); div.textContent = c; careEl.appendChild(div); });
      }
    }

    /*** PURCHASE AREA (no size selector) ***/
    const vintedCta = $('[data-vinted-cta]');
    const buyForm   = $('#add-to-cart-form');
    const addBtn    = $('[data-add-to-cart]');
    const stock = Number(product.stock ?? 0);
const state = getProductState(product);
const isComingSoon = state === 'coming_soon';
const isSoldOut = state === 'sold_out';

// Render size UI (one-size static, known sold-out size overrides)
renderSizeUI(product);

// If product is not purchasable, render all size chips as disabled/inactive.
if (isComingSoon || isSoldOut) {
  const sizeChipRow = $('#size-chip-row');
  if (sizeChipRow) {
    $$('.size-chip', sizeChipRow).forEach((chip) => {
      chip.setAttribute('aria-disabled', 'true');
      chip.removeAttribute('aria-pressed');
    });
  }
}


    const buyBtn = (buyForm && (buyForm.querySelector('button[type="submit"], [data-buy-now]'))) || $('#buy-button');
    if (!product.sellOnVintedOnly && isComingSoon) {
      if (addBtn) { addBtn.disabled = true; addBtn.textContent = t('availableSoon'); addBtn.classList.add('btn-disabled'); }
      if (buyBtn) { buyBtn.disabled = true; buyBtn.textContent = t('availableSoon'); buyBtn.classList.add('btn-disabled'); }
    } else if (!product.sellOnVintedOnly && isSoldOut) {
      if (addBtn) { addBtn.disabled = true; addBtn.textContent = t('soldOut'); addBtn.classList.add('btn-disabled'); }
      if (buyBtn) { buyBtn.disabled = true; buyBtn.textContent = t('soldOut'); buyBtn.classList.add('btn-disabled'); }
    }
function getChosenSize(product) {
  const ov = SIZE_OVERRIDES[product.id];
  if (ov) {
    try { return sessionStorage.getItem('eh_selected_size_' + product.id) || ov.default || ''; }
    catch(_) { return ov.default || ''; }
  }
  // fallback for one-size items
  return (typeof product.defaultSize === 'string' && product.defaultSize.trim())
    ? product.defaultSize.trim()
    : 'One Size';
}

    // Vinted-only flow
    if (product.sellOnVintedOnly && product.vintedUrl) {
      if (vintedCta) {
        vintedCta.hidden = false;
        vintedCta.href = product.vintedUrl;
        vintedCta.rel = 'noopener noreferrer';
      }
    }

    // Direct “Buy now” (Stripe via backend)
    if (buyForm && !product.sellOnVintedOnly) {
      const endpoint =
        buyForm.getAttribute('data-endpoint') ||
        (window.EH_BACKEND
          ? `${window.EH_BACKEND.replace(/\/$/, '')}/create-checkout-session`
          : (typeof STRIPE_ENDPOINT !== 'undefined' ? STRIPE_ENDPOINT : '/.netlify/functions/create-checkout-session'));

      buyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isComingSoon) return alert(t('alertAvailableSoon'));
        if (isSoldOut) return alert(t('alertSoldOut'));
        const promo =
          (sessionStorage.getItem('promo_code') || document.querySelector('#promo-code')?.value || '').trim();
        const shipping_country = getSelectedShippingCountry();
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: [{ price: product.stripePriceId, quantity: 1 }],
              customer_email: '',
              promo_code: promo,
              shipping_country
            })
          });
          const data = await res.json();
          if (res.ok && data?.url) location.assign(data.url);
          else { console.error('Stripe response', data); alert(data?.error || 'Failed to create checkout session.'); }
        } catch (err) {
          console.error('Checkout error:', err);
          alert('Checkout error. Please try again.');
        }
      });
    }

    // Add to bag (mini-cart)
    if (addBtn && !product.sellOnVintedOnly) {
      addBtn.addEventListener('click', () => {
        if (isComingSoon) return alert(t('alertAvailableSoon'));
        if (isSoldOut) return alert(t('alertSoldOut'));
        if (!window.Cart?.add) return alert(t('alertCartUnavailable'));
        if (!product.stripePriceId) return alert(t('alertMissingStripe'));

        Cart.add({
          id: product.id,
          title: product.title,
          price: Number(product.price),
          currency: product.currency || 'EUR',
          size: getChosenSize(product),        
          qty: 1,
          image: product.cover || (product.images && product.images[0]) || '',
          stripePriceId: product.stripePriceId,
          stock
        });

        document.querySelector('[data-cart-open]')?.click();
      });
    }

   /*** GALLERY ***/
/*** GALLERY (desktop only; mobile uses horizontal gallery) ***/
const isMobile = window.matchMedia('(max-width: 768px)').matches;

if (!isMobile) {
  const thumbsContainer = $('.thumb-list');
  const mainImg = $('#main-image');

  if (thumbsContainer && mainImg) {
    let current = 0;
    const fullGallery = $('#product-image-gallery'); // ← 한 번만 선언

    function updateMain(index) {
      current = index;

      // 1) Replace the single main image (if you show one)
      const url = product.images?.[index];
      if (url) {
        mainImg.src = url;
        mainImg.alt = buildProductImageAlt(product, index);
      }

      // 2) Scroll the full gallery strip to the correct slide (if present)
      if (fullGallery) {
        const target = fullGallery.querySelector(`#image-${index}`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
      }

      // 3) Thumb states
      $$('.thumb-list button', thumbsContainer).forEach((btn, idx) => {
        btn.setAttribute('aria-pressed', String(idx === index));
      });
    }

    // Build thumbs
    (product.images || []).forEach((imgUrl, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'thumb';
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('data-index', String(idx));
      btn.innerHTML = `<img src="${imgUrl}" alt="${buildProductImageAlt(product, idx)}" loading="lazy">`;
      btn.addEventListener('click', () => updateMain(idx));
      btn.addEventListener('keydown', (e) => { if (e.key === 'Enter') updateMain(idx); });
      thumbsContainer.appendChild(btn);
    });

    // Build full gallery strip (if you use it)
    if (fullGallery && Array.isArray(product.images)) {
      fullGallery.innerHTML = '';
      product.images.forEach((url, idx) => {
        const img = document.createElement('img');
        img.src = url;
        img.alt = buildProductImageAlt(product, idx);
        img.id = `image-${idx}`;
        img.className = 'full-product-image';
        img.loading = 'lazy';
        fullGallery.appendChild(img);
      });
    }

    updateMain(0);

    // Keyboard arrows (desktop only)
    document.addEventListener('keydown', (e) => {
      if (!product.images?.length) return;
      if (e.key === 'ArrowRight') updateMain((current + 1) % product.images.length);
      if (e.key === 'ArrowLeft')  updateMain((current - 1 + product.images.length) % product.images.length);
    });
  }
}



    /*** STICKY CTA (mobile) ***/
    const stickyHost = $('#sticky-cta-container');
    const purchaseAnchor =
      (product.sellOnVintedOnly && vintedCta) ? vintedCta : $('#buy-button');
    if (stickyHost && purchaseAnchor) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((ent) => {
          stickyHost.innerHTML = '';
          if (!ent.isIntersecting) {
            const clone = purchaseAnchor.cloneNode(true);
            clone.style.width = '100%';
            if (clone.tagName === 'A') clone.rel = 'noopener noreferrer';
            if (clone.tagName === 'BUTTON' && buyForm) {
              clone.type = 'button';
              clone.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof buyForm.requestSubmit === 'function') {
                  buyForm.requestSubmit();
                } else {
                  buyForm.submit();
                }
              });
            }
            stickyHost.appendChild(clone);
          }
        });
      }, { threshold: 0.1 });
      io.observe(purchaseAnchor);
    }
  }

  /*** BANNER ***/
  function initBanner() {
    const banner = $('#site-banner');
    const closeBtn = $('#banner-close');
    const textEl = $('#banner-text');
    if (!banner || !closeBtn || !textEl) return;

    if (sessionStorage.getItem('bannerDismissed')) {
      banner.style.display = 'none';
    }

    closeBtn.addEventListener('click', () => {
      banner.style.display = 'none';
      sessionStorage.setItem('bannerDismissed', 'true');
    });

    // Banner text is set dynamically by cart.js renderBanner()
  }

  function initStickyLayout() {
    const chrome = $('.site-chrome');
    if (!chrome) return;

    const setChromeHeight = () => {
      document.documentElement.style.setProperty('--chrome-height', `${chrome.offsetHeight}px`);
    };
    setChromeHeight();

    window.addEventListener('resize', () => {
      setChromeHeight();
    });

    $('#banner-close')?.addEventListener('click', () => {
      requestAnimationFrame(() => {
        setChromeHeight();
      });
    });
  }


  /*** INIT ***/
  async function init() {
    const year = String(new Date().getFullYear());
    $('#year') && ($('#year').textContent = year);
    $('#year2') && ($('#year2').textContent = year);

    window.Cart?.init?.();
    initBanner();
    initStickyLayout();
    wirePromoUI();

    let products;
    try {
      products = await fetchJSON(PRODUCTS_JSON);
    } catch (err) {
      console.error(err);
      return;
    }
// after: products = await fetchJSON(PRODUCTS_JSON);
let soldMap = {};
try {
  const r = await fetch('/.netlify/functions/get-inventory', { cache: 'no-store' });
  if (r.ok) soldMap = (await r.json()).sold || {};
} catch (_) { /* ignore */ }

// Mark sold items by stripePriceId
if (Array.isArray(products)) {
  products = products.map(p => (p.stripePriceId && soldMap[p.stripePriceId]) ? { ...p, stock: 0, _soldOut: true } : p);
} else if (products && typeof products === 'object') {
  Object.values(products).forEach(p => {
    if (p.stripePriceId && soldMap[p.stripePriceId]) { p.stock = 0; p._soldOut = true; }
  });
}

    // Ensure product asset URLs (images/covers) resolve from site root for both / and /de pages.
    if (Array.isArray(products)) {
      products = products.map(normalizeProductAssets);
    } else if (products && typeof products === 'object') {
      Object.keys(products).forEach((k) => {
        products[k] = normalizeProductAssets(products[k]);
      });
    }

    const path = location.pathname.toLowerCase();
    const params = new URLSearchParams(location.search);
    const hasProductParam = params.has('id') || params.has('slug');
    const pathnameSlug = getSlugFromPathname();
    const isProductsPath = /\/(de\/)?products\//.test(path);
    const hasProductDom = !!(
      document.querySelector('[data-product-info]') ||
      document.querySelector('#product-title') ||
      document.querySelector('#add-to-cart-form')
    );
    const isProductPage = hasProductDom && (
      path.includes('product.html') ||
      isProductsPath ||
      hasProductParam ||
      !!pathnameSlug
    );
    const isComingSoonPage = path.includes('coming-soon');
    if (isProductPage) renderProductPage(products);
    else if (isComingSoonPage) renderHomepage(products, 'coming_soon');
    else renderHomepage(products, 'available');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
(function initAccordions(){
  document.querySelectorAll('.accordion-trigger').forEach(btn => {
    // Safety: make sure it never submits forms
    if (!btn.hasAttribute('type')) btn.type = 'button';

    const id = btn.getAttribute('aria-controls');
    const panel = id && document.getElementById(id);
    if (!panel) return;

    // defaults
    if (!btn.hasAttribute('aria-expanded')) btn.setAttribute('aria-expanded','false');
    if (!panel.hasAttribute('hidden')) panel.hidden = true;

    const icon = btn.querySelector('.accordion-icon');

    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      panel.hidden = open;
      if (icon) icon.textContent = open ? '+' : '–';
    });

    // keyboard support
    btn.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); btn.click(); }
    });
  });
})();

// Prevent right-click save on images
document.addEventListener('contextmenu', (e) => {
  if (e.target.tagName === 'IMG') e.preventDefault();
});
