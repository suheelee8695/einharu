// cart.js
(() => {
  const STORAGE = 'eh_cart_v1';
  const els = {};
  const state = { items: [] }; // [{id,title,price,currency,size,qty,image,stripePriceId,stock?}]
  let lastFocused = null;

  // ---- stock helpers
  const getStock = (i) => {
    const n = Number(i?.stock);
    return Number.isFinite(n) ? Math.max(0, n) : 1;
  };
  const clampQty = (i, q) => {
    const stock = getStock(i);
    const max = Math.min(stock, 9); // cap at 9
    return stock === 0 ? 0 : Math.max(1, Math.min(Number(q) || 1, max));
  };

  // ---- storage
  const save = () => localStorage.setItem(STORAGE, JSON.stringify(state.items));
  const load = () => { try { state.items = JSON.parse(localStorage.getItem(STORAGE)) || []; } catch (_) { state.items = []; } };

  // ---- helpers
  const key = (i) => `${i.id}::${i.size}`;
  const fmt = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
    .format(Number(n || 0));
  const count = () => state.items.reduce((n,i)=>n+i.qty,0);
  const subtotal = () => state.items.reduce((s,i)=>s + i.qty * i.price, 0);

  // ---- public api (stock-aware)
  function add(item) {
    const incoming = { ...item, qty: Number(item.qty || 1), stock: getStock(item) };
    if (incoming.stock === 0) {
      toast('This item is out of stock.');
      return;
    }
    const k = key(incoming);
    const exist = state.items.find(i => key(i) === k);

    if (exist) {
      exist.stock = Number.isFinite(item?.stock) ? incoming.stock : exist.stock;
      const desired = exist.qty + incoming.qty;
      const clamped = clampQty(exist, desired);
      if (clamped !== desired) {
        // toast('Reached maximum quantity for this item.');
      }
      exist.qty = clamped;
    } else {
      incoming.qty = clampQty(incoming, incoming.qty);
      if (incoming.qty === 0) { toast('This item is out of stock.'); return; }
      state.items.push(incoming);
    }
    save(); render(); open();
  }

  function removeAt(k) {
    state.items = state.items.filter(i => key(i) !== k);
    save(); render();
  }

  function updateQty(k, q) {
    const it = state.items.find(i => key(i) === k);
    if (!it) return;
    const n = Number(q);
    if (!n) { removeAt(k); return; }
    const clamped = clampQty(it, n);
    it.qty = clamped;
    save(); render();
  }

  async function checkout(email = null) {
    if (!state.items.length) return;

    // guard against any qty > stock
    for (const i of state.items) {
      const stock = getStock(i);
      if (i.qty > stock) {
        toast(`“${i.title}” has only ${stock} in stock.`);
        return;
      }
    }

    const items = state.items.map(i => ({ price: i.stripePriceId, quantity: i.qty }));
    if (items.some(it => !it.price)) return toast('One or more items are not purchasable yet.');

    const selectedCountry =
      (document.querySelector('[data-ship-country]')?.value || 'DE').toUpperCase();
    const rawSubtotal = subtotal();
    if (!Number.isFinite(rawSubtotal) || rawSubtotal <= 0) return toast('Your bag is empty.');
    const subtotalCents = Math.round(rawSubtotal * 100);

    try {
      // Call your Netlify Function on the SAME origin
const base = (window.EH_BACKEND || location.origin).replace(/\/$/, '');
const res = await fetch(`${base}/create-checkout-session`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           items,
           customer_email: email,
           shipping_country: selectedCountry,
           subtotal_cents: subtotalCents
         })
       });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Checkout failed.');
      if (data?.url) location.href = data.url;
      else throw new Error('Missing Stripe URL');
    } catch (e) {
      console.error(e); toast(e.message);
    }
  }

  // ---- drawer UI
  function cacheEls() {
    els.open = document.querySelector('[data-cart-open]');
    els.close = document.querySelector('[data-cart-close]');
    els.drawer = document.querySelector('[data-cart-drawer]');
    els.overlay = document.querySelector('[data-cart-overlay]');
    els.list = document.querySelector('[data-cart-list]');
    els.sub = document.querySelector('[data-cart-subtotal]');
    els.count = document.querySelector('[data-cart-count]');
    els.checkout = document.querySelector('[data-cart-checkout]');
    els.cont = document.querySelector('[data-cart-continue]');
  }

  function bindUI() {
    els.open?.addEventListener('click', open);
    els.overlay?.addEventListener('click', close);
    els.close?.addEventListener('click', close);
    document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });
    els.checkout?.addEventListener('click', ()=>checkout());
    els.cont?.addEventListener('click', close);
  }

  function trapFocus(e) {
    if (!els.drawer || els.drawer.hidden) return;
    if (e.key !== 'Tab') return;
    const focusables = els.drawer.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open(){
    if(!els.drawer) return;
    lastFocused = document.activeElement;
    els.overlay.hidden = false;
    els.drawer.hidden = false;
    els.drawer.setAttribute('aria-hidden','false');
    const first = els.drawer.querySelector('button, [href], input, select, textarea');
    (first || els.drawer).focus({preventScroll:true});
    document.addEventListener('keydown', trapFocus);
    document.body.style.overflow='hidden';
  }

  function close(){
    if(!els.drawer) return;
    els.overlay.hidden = true;
    els.drawer.setAttribute('aria-hidden','true');
    setTimeout(()=>{ els.drawer.hidden = true; }, 200);
    document.removeEventListener('keydown', trapFocus);
    document.body.style.overflow='';
    els.open?.focus({preventScroll:true});
  }

  let qtyTimer;
  function render() {
    // badge + subtotal
    if (els.count) els.count.textContent = String(count());
    if (els.sub) els.sub.textContent = fmt(subtotal());

    if (!els.list) return;
    if (!state.items.length) {
      els.list.innerHTML = `<div class="empty">Your bag is empty.</div>`;
      return;
    }

    els.list.innerHTML = state.items.map(i => {
      const k = key(i);
      const stock = getStock(i);
      const atMax = i.qty >= stock;
      const sizeText = (i.size && String(i.size).trim())
        ? String(i.size).replace(/^size:\s*/i,'')
        : 'Free';

      const qtyUI = stock <= 1
        ? '' // hide qty UI for single-stock items
        : `
          <div class="qty" role="group" aria-label="Quantity">
            <button type="button" aria-label="Decrease" data-qty-dec data-k="${k}">−</button>
            <input type="number" class="qty-input" min="1" max="${Math.min(stock,9)}" value="${i.qty}" aria-label="Quantity input" data-qty-input data-k="${k}">
            <button type="button" aria-label="Increase" data-qty-inc data-k="${k}" ${atMax ? 'disabled' : ''}>+</button>
          </div>
        `;

      return `
        <div class="cart-line" data-k="${k}">
          <img alt="" loading="lazy" src="${i.image}">
          <div>
            <div class="cart-line__title">${i.title}</div>
            <div class="cart-line__meta">Size: ${sizeText} • ${fmt(i.price)}</div>

            <div class="cart-line__actions">
              ${qtyUI}
              <button type="button" class="remove-link" data-remove data-k="${k}">Remove</button>
            </div>
          </div>
          <div class="line-total">${fmt(i.qty * i.price)}</div>
        </div>`;
    }).join('');

    // events
    els.list.querySelectorAll('[data-remove]').forEach(b=>b.onclick = () => removeAt(b.dataset.k));
    els.list.querySelectorAll('[data-qty-dec]').forEach(b=>b.onclick = () => {
      const it = state.items.find(x=>key(x)===b.dataset.k); if (!it) return;
      updateQty(b.dataset.k, it.qty - 1);
    });
    els.list.querySelectorAll('[data-qty-inc]').forEach(b=>b.onclick = () => {
      const it = state.items.find(x=>key(x)===b.dataset.k); if (!it) return;
      const capped = clampQty(it, it.qty + 1);
      if (capped === it.qty) { return; }
      updateQty(it.id + '::' + it.size, it.qty + 1);
    });
    // typed qty
    els.list.querySelectorAll('[data-qty-input]').forEach(inp => {
      inp.oninput = () => {
        const it = state.items.find(x => key(x) === inp.dataset.k);
        if (!it) return;
        const val = parseInt(inp.value, 10);
        const clamped = clampQty(it, val);
        if (clamped === 0) {
          removeAt(inp.dataset.k);
          return;
        }
        if (String(clamped) !== inp.value) inp.value = String(clamped);
        updateQty(inp.dataset.k, clamped);
      };
      inp.onblur = () => {
        const it = state.items.find(x => key(x) === inp.dataset.k);
        if (!it) return;
        inp.value = String(it.qty);
      };
    });
  }

  function toast(msg){ console.warn(msg); /* hook UI here */ }

  function init(){
    cacheEls(); load(); bindUI(); render();
    window.addEventListener('storage', (e)=>{ if(e.key===STORAGE) { load(); render(); }});
  }

  window.Cart = { init, add, removeAt, updateQty, getItems:()=>state.items.slice(), count, subtotal, checkout };
})();
