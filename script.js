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
  // const STRIPE_ENDPOINT = 'http://localhost:4242/create-checkout-session'; // optional
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
          : (typeof STRIPE_ENDPOINT !== 'undefined' ? STRIPE_ENDPOINT : 'http://localhost:4242/create-checkout-session'));

      buyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (Number(product.stock ?? 0) <= 0) return alert('This item is sold out.');

        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: [{ price: product.stripePriceId, quantity: 1 }],
              customer_email: ''
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
const thumbsContainer = $('.thumb-list');
const mainImg = $('#main-image');

if (thumbsContainer && mainImg) {
  let current = 0;
  const fullGallery = $('#product-image-gallery');

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



      // Keyboard arrows
      document.addEventListener('keydown', (e) => {
        if (!product.images?.length) return;
        if (e.key === 'ArrowRight') updateMain((current + 1) % product.images.length);
        if (e.key === 'ArrowLeft') updateMain((current - 1 + product.images.length) % product.images.length);
      });
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

    textEl.textContent = 'Free shipping within Germany on orders over €100.';
  }

  /*** INIT ***/
  async function init() {
    const year = String(new Date().getFullYear());
    $('#year') && ($('#year').textContent = year);
    $('#year2') && ($('#year2').textContent = year);

    window.Cart?.init?.();
    initBanner();

    let products;
    try {
      products = await fetchJSON(PRODUCTS_JSON);
    } catch (err) {
      console.error(err);
      return;
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
