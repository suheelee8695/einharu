(() => {
  'use strict';

  const KEY = 'einharu_consent_v1';
  const GA_ID = 'G-Z42LZ4WR68';
  let gaLoaded = false;

  const readConsent = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY));
    } catch {
      return null;
    }
  };

  const writeConsent = (data) => {
    localStorage.setItem(KEY, JSON.stringify({ ...data, ts: Date.now() }));
  };

  const loadAnalytics = () => {
    if (gaLoaded || !GA_ID) return;
    gaLoaded = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
    script.onload = () => {
      window.gtag('js', new Date());
      window.gtag('config', GA_ID, { anonymize_ip: true });
    };
    document.head.appendChild(script);
  };

  const ensurePanel = () => {
    if (document.querySelector('.cookie-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'cookie-overlay';

    const panel = document.createElement('section');
    panel.className = 'cookie-preferences';
    panel.setAttribute('aria-label', 'Cookie preferences');
    panel.innerHTML = `
      <div class="cookie-preferences__panel">
        <div class="cookie-preferences__left">
          <p class="cookie-preferences__eyebrow">Cookie Preferences</p>
          <h2>Your data, your choice.</h2>
          <p>
            Essential cookies keep the store, bag and checkout working. Optional cookies help us understand usage and remember preferences.
            We do not use advertising cookies. Read our <a href="privacy.html">Privacy Policy</a>.
          </p>
        </div>
        <div class="cookie-preferences__right">
          <div class="cookie-pref-row">
            <div>
              <h3>Essential</h3>
              <p>Required for core store and checkout functionality.</p>
            </div>
            <label class="cookie-toggle">
              <input type="checkbox" checked disabled />
              <span></span>
            </label>
          </div>
          <div class="cookie-pref-row">
            <div>
              <h3>Analytics</h3>
              <p>Anonymous measurement to improve the website experience.</p>
            </div>
            <label class="cookie-toggle">
              <input type="checkbox" id="cookie-analytics" />
              <span></span>
            </label>
          </div>
          <div class="cookie-pref-row">
            <div>
              <h3>Personalisation</h3>
              <p>Remember non-essential display and browsing preferences.</p>
            </div>
            <label class="cookie-toggle">
              <input type="checkbox" id="cookie-personal" />
              <span></span>
            </label>
          </div>
          <div class="cookie-pref-row">
            <div>
              <h3>Marketing</h3>
              <p>Not used by einHaru Collective.</p>
            </div>
            <label class="cookie-toggle">
              <input type="checkbox" disabled />
              <span></span>
            </label>
          </div>
          <div class="cookie-pref-actions">
            <button type="button" class="cookie-btn cookie-btn--ghost" data-cookie-save>Save choices</button>
            <button type="button" class="cookie-btn" data-cookie-accept-all>Accept all</button>
          </div>
        </div>
      </div>`;

    const toast = document.createElement('div');
    toast.className = 'cookie-toast';
    toast.setAttribute('aria-live', 'polite');

    document.body.appendChild(overlay);
    document.body.appendChild(panel);
    document.body.appendChild(toast);
  };

  const init = () => {
    const bar = document.querySelector('.cookie-bar');
    if (!bar) return;

    ensurePanel();

    const overlay = document.querySelector('.cookie-overlay');
    const panel = document.querySelector('.cookie-preferences');
    const toast = document.querySelector('.cookie-toast');

    const acceptBtn = bar.querySelector('.cookie-btn:not(.cookie-btn--ghost)');
    const declineBtn = bar.querySelector('.cookie-btn--ghost');

    if (!acceptBtn || !declineBtn) return;

    let manageBtn = bar.querySelector('[data-cookie-manage]');
    if (!manageBtn) {
      manageBtn = document.createElement('button');
      manageBtn.type = 'button';
      manageBtn.className = 'cookie-btn cookie-btn--ghost';
      manageBtn.textContent = 'Manage preferences';
      manageBtn.setAttribute('data-cookie-manage', 'true');
      const actions = bar.querySelector('.cookie-bar-actions');
      if (actions) actions.insertBefore(manageBtn, declineBtn);
    }

    const analyticsInput = panel.querySelector('#cookie-analytics');
    const personalInput = panel.querySelector('#cookie-personal');
    const saveBtn = panel.querySelector('[data-cookie-save]');
    const panelAcceptAllBtn = panel.querySelector('[data-cookie-accept-all]');

    const showToast = (text) => {
      toast.textContent = text;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2500);
    };

    const closePanel = () => {
      panel.classList.remove('visible');
      overlay.classList.remove('visible');
    };

    const showBanner = () => {
      setTimeout(() => bar.classList.add('visible'), 350);
    };

    const hideBanner = () => {
      bar.classList.remove('visible');
    };

    const openPanel = () => {
      const saved = readConsent();
      analyticsInput.checked = !!saved?.analytics;
      personalInput.checked = !!saved?.personalisation;
      panel.classList.add('visible');
      overlay.classList.add('visible');
    };

    const setConsent = (consent, message) => {
      writeConsent(consent);
      hideBanner();
      closePanel();
      showToast(message);
      if (consent.analytics) loadAnalytics();
      window.dispatchEvent(new CustomEvent('einharu:consent-updated', { detail: consent }));
    };

    manageBtn.addEventListener('click', openPanel);

    acceptBtn.addEventListener('click', () => {
      setConsent(
        { essential: true, analytics: true, personalisation: true, marketing: false },
        'All cookies accepted.'
      );
    });

    declineBtn.addEventListener('click', () => {
      setConsent(
        { essential: true, analytics: false, personalisation: false, marketing: false },
        'Essential cookies only.'
      );
    });

    saveBtn.addEventListener('click', () => {
      setConsent(
        {
          essential: true,
          analytics: !!analyticsInput.checked,
          personalisation: !!personalInput.checked,
          marketing: false,
        },
        'Preferences saved.'
      );
    });

    panelAcceptAllBtn.addEventListener('click', () => {
      setConsent(
        { essential: true, analytics: true, personalisation: true, marketing: false },
        'All cookies accepted.'
      );
    });

    overlay.addEventListener('click', closePanel);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel();
    });

    const consent = readConsent();
    if (!consent) {
      showBanner();
    } else {
      hideBanner();
      if (consent.analytics) loadAnalytics();
      window.dispatchEvent(new CustomEvent('einharu:consent-updated', { detail: consent }));
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
