// netlify/functions/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Flat €5 shipping; free over €100 + free by coupon (server-side validation)
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // 프론트에서 보내는 값
    const {
      items, title, price, email, customer_email,
      promo_code = '',
      shipping_country = 'DE'
    } = JSON.parse(event.body || '{}');

    // Build line_items & subtotal (cents)
    let line_items = [];
    let subtotal = 0;

    if (Array.isArray(items) && items.length) {
      const normalized = items.map(i => ({
        price: i.price || i.stripePriceId,
        quantity: Math.max(1, Math.min(9, Number(i.quantity ?? i.qty ?? 1)))
      }));
      if (normalized.some(n => !n.price)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing Stripe Price ID in items.' }) };
      }
      const unique = [...new Set(normalized.map(n => n.price))];
      const priceMap = new Map();
      for (const pid of unique) {
        const p = await stripe.prices.retrieve(pid);
        if (!p || typeof p.unit_amount !== 'number') {
          return { statusCode: 400, body: JSON.stringify({ error: `Invalid Stripe Price: ${pid}` }) };
        }
        priceMap.set(pid, p.unit_amount);
      }
      subtotal = normalized.reduce((sum, n) => sum + priceMap.get(n.price) * n.quantity, 0);
      line_items = normalized;
    } else {
      if (!title || typeof price !== 'number') {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid payload for single-item checkout' }) };
      }
      const unitAmount = Math.round(price * 100);
      subtotal = unitAmount;
      line_items = [{
        price_data: {
          currency: 'eur',
          product_data: { name: title },
          unit_amount: unitAmount
        },
        quantity: 1
      }];
    }

    // 🔐 쿠폰/국가 환경변수
    const VALID_COUPONS = (process.env.COUPON_CODES || '')
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);   

    const FREE_COUNTRIES = (process.env.FREE_SHIP_COUNTRIES || '')
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);   // e.g. ['DE'] (비우면 전체 허용)

    // 쿠폰 검증(백엔드 전용)
    const code = (typeof promo_code === 'string' ? promo_code : '').trim().toUpperCase();
    const couponValid = !!code && VALID_COUPONS.includes(code);

    const shipCountry = (shipping_country || 'DE').toUpperCase();
    const countryOk  = !FREE_COUNTRIES.length || FREE_COUNTRIES.includes(shipCountry);

    // (옵션) 유효기간/최소금액 조건 추가 지점
    const notExpired = true;   // Date.now() <= new Date('2025-12-31T23:59:59Z').getTime()
    const meetsMin   = true;   // typeof subtotal === 'number' ? subtotal >= 3000 : true

    const allowFreeByCoupon = couponValid && countryOk && notExpired && meetsMin;
    const showFreeThreshold = subtotal >= 10000; // €100 이상 무료

    // 🚚 배송 옵션
    const shipping_options = [
      {
        shipping_rate_data: {
          display_name: 'Standard Shipping',
          type: 'fixed_amount',
          fixed_amount: { amount: 500, currency: 'eur' }, // €5.00 (원하면 590=€5.90)
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 2 },
            maximum: { unit: 'business_day', value: 7 }
          }
        }
      }
    ];

    // ✅ 무료옵션은 쿠폰 OR 임계값 중 하나라도 만족 시 "한 번만" 추가
    if (allowFreeByCoupon || showFreeThreshold) {
      shipping_options.push({
        shipping_rate_data: {
          display_name: allowFreeByCoupon
            ? 'Free Shipping (coupon)'
            : 'Free Shipping (orders over €100)',
          type: 'fixed_amount',
          fixed_amount: { amount: 0, currency: 'eur' },
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 2 },
            maximum: { unit: 'business_day', value: 7 }
          }
        }
      });
    }

    const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'https://einharu.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customer_email || email || undefined,
      line_items,
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: {
        allowed_countries: [
          'DE','FR','NL','BE','LU','AT','IT','ES','PT','IE','FI','SE','DK','PL','CZ','HU','SK','SI','HR','RO','BG','EE','LV','LT','MT','CY'
        ]
      },
      shipping_options,
      // allow_promotion_codes: true, // (상품 금액 할인코드 허용; 배송쿠폰과는 별개. 필요 시 주석 해제)
      success_url: `${CLIENT_ORIGIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_ORIGIN}/cancel.html`
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        url: session.url,
        id: session.id,
        _debug: { subtotal, allowFreeByCoupon, showFreeThreshold, shipCountry, code }
      })
    };
  } catch (e) {
    console.error('create-checkout-session error', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Failed to create session' }) };
  }
};
