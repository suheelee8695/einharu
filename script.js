/* script.js — einHaru site core (no size selector)
   - Homepage grid (from products.json)
   - Product detail by ?id=
   - Single-size display only (no selector)
   - Gallery + keyboard nav
   - Meta/OG + Schema injection
   - Vinted CTA OR Stripe checkout
   - Banner dismiss + current year
*/
(() => {
  'use strict';

  /*** CONFIG ***/
  const PRODUCTS_JSON = 'products.json';
  const CACHE_BUST = 'no-store'; // dev cache behaviour

  /*** HELPERS ***/
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmtPrice = (n, currency = 'EUR') =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(Number(n || 0));
  const getQuery = (k) => new URLSearchParams(location.search).get(k);

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: CACHE_BUST });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.json();
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

    /* 인디케이터 오버레이 */
    body.eh-pdp-mobile .eh-dots{
      position:absolute; left:50%; bottom:14px; transform:translateX(-50%);
      display:inline-flex; gap:6px; z-index:60;
    }
    body.eh-pdp-mobile .eh-dots button{
      width:6px; height:6px; border-radius:999px; border:0; background:#C9D1E4;
    }
    body.eh-pdp-mobile .eh-dots button[aria-current="true"]{ background:#535353; }

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
  const dots  = document.createElement('div'); dots.className  = 'eh-dots';

  // 슬라이드 생성
  product.images.forEach((src, i) => {
    const slide = document.createElement('figure');
    slide.className = 'eh-slide';
    const img = document.createElement('img');
    img.src = src;
    img.alt = `${product.title || 'Product'} image ${i+1}`;
    img.loading = 'lazy';
    slide.appendChild(img);
    track.appendChild(slide);

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.setAttribute('aria-label', `Go to image ${i+1}`);
    dot.addEventListener('click', () => track.scrollTo({ left: i * window.innerWidth, behavior: 'smooth' }));
    dots.appendChild(dot);
  });

  gallery.appendChild(track);
  gallery.appendChild(dots);
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
document.documentElement.style.setProperty('--eh-top', `${headerH + bannerH + bcH}px`);


  // 인디케이터 활성화
  const setActive = () => {
    const idx = Math.round(track.scrollLeft / window.innerWidth);
    Array.from(dots.children).forEach((d,k)=> d.toggleAttribute('aria-current', k===idx));
  };
  setActive();
  track.addEventListener('scroll', () => requestAnimationFrame(setActive));
  window.addEventListener('resize', setActive);

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
    const ld = {
      '@context': 'https://schema.org/',
      '@type': 'Product',
      name: product.title,
      image: product.images || [],
      description: product.description || '',
      brand: product.brand || 'einHaru Collective',
      offers: {
        '@type': 'Offer',
        url: location.href,
        priceCurrency: product.currency || 'EUR',
        price: String(product.price ?? ''),
        availability: (Number(product.stock ?? 0) > 0)
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock'
      }
    };
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(ld);
    document.head.appendChild(s);
  }

  function setMeta(product) {
    const titleText = product?.title ? `${product.title} – einHaru Collective` : 'einHaru Collective';
    const descText = (Array.isArray(product?.description) ? product.description.join(' ') : product?.description) || 'Quiet daily wear from Berlin & Seoul.';
    const img = (product?.images || [])[0];

    document.title = titleText;

    const set = (sel, attr, val) => {
      const el = document.head.querySelector(sel);
      if (el && val) el.setAttribute(attr, val);
    };

    set('meta[name="description"]', 'content', descText);
    set('link[rel="canonical"]', 'href', location.href);
    set('meta[property="og:title"]', 'content', titleText);
    set('meta[property="og:description"]', 'content', descText);
    set('meta[property="og:type"]', 'content', 'website');
    set('meta[property="og:url"]', 'content', location.href);
    if (img) set('meta[property="og:image"]', 'content', img);
  }

  /*** HOMEPAGE ***/
  function renderHomepage(products) {
    const grid = document.querySelector('.product-grid');
    if (!grid) return;

    grid.innerHTML = '';

    products.forEach((prod) => {
      const first  = (prod.images && prod.images[0]) || prod.cover || '';
      const second = (prod.images && (prod.images[1] || prod.images[0])) || prod.cover || first;

      const stock = Number(prod.stock ?? 0);
      const soldOut = stock <= 0;

      const card = document.createElement('div');
      card.className = 'product-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${prod.title}, ${fmtPrice(prod.price, prod.currency || 'EUR')}`);
      card.dataset.category = (prod.category || 'collection').toLowerCase();

      const brand = prod.brand || (card.dataset.category === 'vintage' ? 'Vintage One-Off' : 'einHaru Collective');

      card.innerHTML = `
        <div class="card-image-wrapper">
          <img src="${first}" alt="${prod.title}" class="card-img primary" loading="lazy">
          <img src="${second}" alt="${prod.title}" class="card-img secondary" loading="lazy">
          ${soldOut ? '<span class="badge-soldout">Sold out</span>' : ''}
        </div>
        <div class="card-info">
          <div class="card-brand">${brand}</div>
          <h2 class="card-title">${prod.title ?? ''}</h2>
          <div class="card-price">${fmtPrice(prod.price, prod.currency || 'EUR')}</div>
        </div>
      `;

      if (!soldOut) {
        const go = () => location.assign(`product.html?id=${encodeURIComponent(prod.id)}`);
        card.addEventListener('click', go);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      } else {
        card.setAttribute('aria-disabled', 'true');
        card.style.cursor = 'not-allowed';
      }

      grid.appendChild(card);
    });

    // Simple filter buttons
    const tabs = $$('.filter-tab');
    if (tabs.length) {
      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          const filter = (tab.dataset.filter || 'all').toLowerCase();
          tabs.forEach((t) => t.classList.remove('active'));
          tab.classList.add('active');

          Array.from(grid.children).forEach((card) => {
            const show = filter === 'all' || filter === card.dataset.category;
            card.style.display = show ? '' : 'none';
          });
        });
      });
    }
  }

  /*** PRODUCT PAGE ***/
  function renderProductPage(products) {
    const id = getQuery('id');
    if (!id) return;

    const product = Array.isArray(products)
      ? products.find((p) => p.id === id)
      : (products && products[id]);

    const main = $('.product-detail-main') || document.body;
    if (!product) {
      console.warn('Product not found for id:', id);
      main.innerHTML = `<p>Product not found. <a href="index.html">Back to shop</a></p>`;
      return;
    }

    // Meta & schema
    setMeta(product);
    injectSchema(product);
    initMobileGallery(product);

    // Static UI
    $('#breadcrumb-title') && ($('#breadcrumb-title').textContent = product.title || '');
    $('#back-button')?.addEventListener('click', () => history.back());
    $('#product-brand') && ($('#product-brand').textContent = product.brand || 'einHaru Collective');
    $('#product-title') && ($('#product-title').textContent = product.title || '');
    $('#product-price') && ($('#product-price').textContent = fmtPrice(product.price, product.currency || 'EUR'));

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
      const text = Array.isArray(d) ? d.join('\n\n') : (d || '');
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
    const sizeTextEl = $('#product-sizes-text');

    const stock = Number(product.stock ?? 0);
    const soldOut = stock <= 0;

    // Single-size value (display only)
    const oneSize = (typeof product.defaultSize === 'string' && product.defaultSize.trim())
      ? product.defaultSize.trim()
      : 'Free';
    if (sizeTextEl) sizeTextEl.innerHTML = `<strong>Size:</strong> ${oneSize}`;

    const buyBtn = (buyForm && (buyForm.querySelector('button[type="submit"], [data-buy-now]'))) || $('#buy-button');
    if (!product.sellOnVintedOnly && soldOut) {
      if (addBtn) { addBtn.disabled = true; addBtn.textContent = 'Sold out'; addBtn.classList.add('btn-disabled'); }
      if (buyBtn) { buyBtn.disabled = true; buyBtn.textContent = 'Sold out'; buyBtn.classList.add('btn-disabled'); }
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
        if (Number(product.stock ?? 0) <= 0) return alert('This item is sold out.');
        const promo =
    (sessionStorage.getItem('promo_code') || document.querySelector('#promo-code')?.value || '').trim();  // ⬅
  const shipping_country = 'DE';
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: [{ price: product.stripePriceId, quantity: 1 }],
              customer_email: '',
              promo_code: (sessionStorage.getItem('promo_code') || '').trim(),
              shipping_country: 'DE'
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
        if (!window.Cart?.add) return alert('Cart unavailable.');
        if (!product.stripePriceId) return alert('This item cannot be checked out yet (missing Stripe Price).');
        if (Number(product.stock ?? 0) <= 0) return alert('This item is sold out.');

        Cart.add({
          id: product.id,
          title: product.title,
          price: Number(product.price),
          currency: product.currency || 'EUR',
          size: oneSize,        // used internally; no selector
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
        mainImg.alt = `${product.title || 'Product'} — view ${index + 1}`;
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
      btn.innerHTML = `<img src="${imgUrl}" alt="${product.title} — view ${idx + 1}" loading="lazy">`;
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
        img.alt = `${product.title} image ${idx + 1}`;
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
              clone.addEventListener('click', (e) => {
                e.preventDefault();
                buyForm.requestSubmit?.() || buyForm.submit();
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

    textEl.textContent = 'Free shipping within EU on orders over €100.';
  }

  /*** INIT ***/
  async function init() {
    const year = String(new Date().getFullYear());
    $('#year') && ($('#year').textContent = year);
    $('#year2') && ($('#year2').textContent = year);

    window.Cart?.init?.();
    initBanner();
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
  products = products.map(p => (p.stripePriceId && soldMap[p.stripePriceId]) ? { ...p, stock: 0 } : p);
} else if (products && typeof products === 'object') {
  Object.values(products).forEach(p => {
    if (p.stripePriceId && soldMap[p.stripePriceId]) p.stock = 0;
  });
}

    const path = location.pathname;
    if (path.includes('product.html')) renderProductPage(products);
    else renderHomepage(products);
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
      // make sure opened panel is visible under sticky header
      panel.scrollIntoView({ block: 'nearest' });
    });

    // keyboard support
    btn.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); btn.click(); }
    });
  });
})();
