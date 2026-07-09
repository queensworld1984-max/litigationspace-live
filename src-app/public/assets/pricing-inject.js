/**
 * pricing-inject.js — Full pricing page rebuild
 * Runs only on /pricing. Replaces the React-rendered pricing section with
 * the final spec: toggle, PAYG + 4 plan cards, collapsible feature table.
 */
(function () {
  'use strict';

  if (window.location.pathname.replace(/\/$/, '') !== '/pricing') return;

  /* ── Fonts ─────────────────────────────────────────────────────────────── */
  (function () {
    if (document.getElementById('ls-pricing-fonts')) return;
    var l = document.createElement('link');
    l.id = 'ls-pricing-fonts';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800;900&family=Inter:wght@400;500;600;700&display=swap';
    document.head.appendChild(l);
  })();

  /* ── Styles ─────────────────────────────────────────────────────────────── */
  function injectStyles() {
    var old = document.getElementById('ls-pricing-styles');
    if (old) old.remove();
    var s = document.createElement('style');
    s.id = 'ls-pricing-styles';
    s.textContent = `
      /* ── Page canvas ── */
      [data-ls-pricing="1"] {
        background: linear-gradient(170deg, #FFFDF5 0%, #FDF8EC 50%, #FAF4E4 100%) !important;
        color: #0c2461 !important;
        font-family: Inter, sans-serif !important;
        padding: 0 !important;
        margin: 0 !important;
        min-height: 100vh;
        position: relative;
      }

      /* Subtle gold shimmer at top */
      [data-ls-pricing="1"]::before {
        content: '';
        position: fixed;
        top: -5%;
        left: 50%;
        transform: translateX(-50%);
        width: 1000px;
        height: 500px;
        background: radial-gradient(ellipse at center,
          rgba(213,168,50,0.10) 0%,
          rgba(213,168,50,0.03) 50%,
          transparent 70%);
        pointer-events: none;
        z-index: 0;
      }

      .lsp-wrap {
        max-width: 1200px;
        margin: 0 auto;
        padding: 96px 36px 140px;
        box-sizing: border-box;
        position: relative;
        z-index: 1;
      }

      /* ── Ornamental divider ── */
      .lsp-ornament {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 14px;
        margin-bottom: 32px;
      }
      .lsp-ornament span {
        display: block;
        height: 1px;
        width: 80px;
        background: linear-gradient(90deg, transparent, rgba(190,148,35,0.50));
      }
      .lsp-ornament span:last-child {
        background: linear-gradient(90deg, rgba(190,148,35,0.50), transparent);
      }
      .lsp-ornament em {
        color: #C9A020;
        font-style: normal;
        font-size: 18px;
        letter-spacing: 0.15em;
      }

      /* ── Hero ── */
      .lsp-hero { text-align: center; margin-bottom: 56px; }

      .lsp-eyebrow {
        display: inline-block;
        font-family: Inter, sans-serif;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: #9a7010;
        background: rgba(190,148,35,0.10);
        border: 1px solid rgba(190,148,35,0.30);
        border-radius: 9999px;
        padding: 5px 18px;
        margin-bottom: 24px;
      }

      .lsp-hero h1 {
        font-family: "Playfair Display", Georgia, serif !important;
        font-size: 58px !important;
        font-weight: 900 !important;
        line-height: 1.08 !important;
        margin: 0 0 20px !important;
        color: #0c2461 !important;
        -webkit-text-fill-color: #0c2461 !important;
        letter-spacing: -0.02em !important;
      }

      .lsp-hero p {
        font-size: 16px;
        color: #111111;
        max-width: 560px;
        margin: 0 auto 40px;
        line-height: 1.7;
        font-weight: 400;
      }

      /* ── Billing toggle ── */
      .lsp-toggle-wrap { display: flex; flex-direction: column; align-items: center; gap: 0; }
      .lsp-toggle {
        display: inline-flex;
        align-items: center;
        background: #ffffff;
        border: 1px solid #d8cba8;
        border-radius: 9999px;
        padding: 5px;
        margin-bottom: 10px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      }
      .lsp-toggle button {
        background: none;
        border: none;
        cursor: pointer;
        font-family: Inter, sans-serif;
        font-size: 13.5px;
        font-weight: 600;
        padding: 8px 26px;
        border-radius: 9999px;
        transition: background .2s, color .2s, box-shadow .2s;
        color: #111111;
        letter-spacing: 0.01em;
      }
      .lsp-toggle button.active {
        background: linear-gradient(135deg, #D4A020 0%, #C49010 100%);
        color: #ffffff !important;
        -webkit-text-fill-color: #ffffff !important;
        box-shadow: 0 3px 14px rgba(196,144,16,0.40);
        font-weight: 700;
      }
      .lsp-save-badge {
        display: inline-block;
        margin-left: 6px;
        background: rgba(190,148,35,0.12);
        border: 1px solid rgba(190,148,35,0.30);
        color: #9a7010;
        font-size: 10.5px;
        font-weight: 700;
        border-radius: 9999px;
        padding: 2px 9px;
        vertical-align: middle;
        letter-spacing: 0.04em;
      }

      /* ── Notice banner ── */
      .lsp-notice {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        background: #ffffff;
        border: 1px solid #d8cba8;
        border-radius: 14px;
        padding: 16px 24px;
        font-size: 13.5px;
        color: #111111;
        max-width: 820px;
        margin: 0 auto 64px;
        line-height: 1.6;
        box-shadow: 0 2px 16px rgba(0,0,0,0.07);
      }
      .lsp-notice span.star {
        color: #C9A020;
        font-size: 18px;
        flex-shrink: 0;
        margin-top: 1px;
      }

      /* ── PAYG card ── */
      .lsp-payg {
        max-width: 540px;
        margin: 0 auto 72px;
        border: 1.5px solid #d8cba8;
        border-radius: 20px;
        padding: 44px 48px;
        background: #ffffff;
        text-align: center;
        box-shadow: 0 8px 40px rgba(0,0,0,0.09), inset 0 1px 0 rgba(255,255,255,0.90);
        position: relative;
        overflow: hidden;
      }
      .lsp-payg::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 3px;
        background: linear-gradient(90deg, transparent, #C9A020, #E8C040, #C9A020, transparent);
      }
      .lsp-payg h2 {
        font-family: "Playfair Display", Georgia, serif;
        font-size: 26px;
        font-weight: 800;
        color: #0c2461;
        margin: 0 0 10px;
        letter-spacing: -0.01em;
      }
      .lsp-payg p {
        font-size: 14px;
        color: #111111;
        margin: 0 0 24px;
        line-height: 1.6;
      }
      .lsp-payg .price {
        font-family: "Playfair Display", Georgia, serif;
        font-size: 38px;
        font-weight: 900;
        color: #B8860B;
        -webkit-text-fill-color: #B8860B;
        margin-bottom: 28px;
        line-height: 1;
      }
      .lsp-payg .price span {
        font-family: Inter, sans-serif;
        font-size: 15px;
        font-weight: 400;
        color: #111111;
        -webkit-text-fill-color: #111111;
      }

      /* ── Plan cards ── */
      .lsp-cards {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 22px;
        margin-bottom: 80px;
        align-items: start;
      }
      .lsp-card {
        border: 1.5px solid #ddd5b8;
        border-radius: 20px;
        padding: 36px 26px 30px;
        background: #ffffff;
        display: flex;
        flex-direction: column;
        position: relative;
        overflow: hidden;
        box-shadow: 0 4px 24px rgba(0,0,0,0.07);
        transition: transform .2s, box-shadow .2s, border-color .2s;
      }
      .lsp-card:hover {
        transform: translateY(-6px);
        box-shadow: 0 16px 48px rgba(0,0,0,0.12), 0 0 0 1.5px #C9A020;
        border-color: #C9A020;
      }
      .lsp-card::before {
        content: '';
        position: absolute;
        top: 0; left: 15%; right: 15%;
        height: 2px;
        background: linear-gradient(90deg, transparent, rgba(190,148,35,0.40), transparent);
      }
      .lsp-card.popular {
        border-color: #C9A020;
        background: #FFFDF4;
        box-shadow: 0 6px 32px rgba(190,148,35,0.16), 0 0 0 1.5px rgba(190,148,35,0.35);
      }
      .lsp-card.popular::before {
        left: 0; right: 0;
        background: linear-gradient(90deg, transparent, #C9A020, #E8C040, #C9A020, transparent);
        height: 3px;
        opacity: 1;
      }

      .lsp-badge-popular {
        position: absolute;
        top: -1px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #D4A820 0%, #C09010 100%);
        color: #ffffff;
        font-size: 10px;
        font-weight: 800;
        border-radius: 0 0 10px 10px;
        padding: 4px 18px;
        white-space: nowrap;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        box-shadow: 0 4px 16px rgba(190,148,35,0.40);
      }

      .lsp-card h3 {
        font-family: "Playfair Display", Georgia, serif;
        font-size: 22px;
        font-weight: 800;
        color: #0c2461;
        margin: 0 0 10px;
        letter-spacing: -0.01em;
      }
      .lsp-card .card-desc {
        font-size: 13px;
        color: #111111;
        line-height: 1.6;
        margin-bottom: 22px;
      }
      .lsp-card .trial-info {
        background: #FFFBEE;
        border: 1px solid #ddc86a;
        border-radius: 10px;
        padding: 12px 16px;
        margin-bottom: 8px;
        font-size: 12px;
        color: #6a5010;
        line-height: 1.6;
      }
      .lsp-card .trial-info strong {
        color: #9a7010;
        font-weight: 700;
      }
      .lsp-card .price-block { margin-bottom: 26px; margin-top: 8px; }
      .lsp-card .price-main {
        font-family: "Playfair Display", Georgia, serif;
        font-size: 48px;
        font-weight: 900;
        line-height: 1;
        color: #0c2461;
        -webkit-text-fill-color: #0c2461;
      }
      .lsp-card .price-main.label-price {
        font-size: 32px;
      }
      .lsp-card .price-main .curr {
        font-family: Inter, sans-serif;
        font-size: 22px;
        font-weight: 600;
        vertical-align: super;
      }
      .lsp-card .price-per {
        font-size: 13px;
        color: #111111;
        margin-top: 6px;
        letter-spacing: 0.02em;
      }
      .lsp-card .price-annual {
        font-size: 11.5px;
        color: #9a7010;
        margin-top: 5px;
      }

      /* ── CTAs ── */
      .lsp-card-cta {
        display: block;
        width: 100%;
        text-align: center;
        padding: 13px 0;
        border-radius: 10px;
        font-family: Inter, sans-serif;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        text-decoration: none !important;
        transition: all .2s;
        box-sizing: border-box;
        margin-top: auto;
        letter-spacing: 0.03em;
      }
      .lsp-card-cta.gold {
        background: linear-gradient(135deg, #D4A820 0%, #C09010 100%);
        color: #ffffff !important;
        -webkit-text-fill-color: #ffffff !important;
        border: none;
        box-shadow: 0 4px 20px rgba(190,148,35,0.35);
      }
      .lsp-card-cta.gold:hover {
        background: linear-gradient(135deg, #E0B828 0%, #C9A020 100%);
        box-shadow: 0 8px 28px rgba(190,148,35,0.48);
        transform: translateY(-2px);
      }
      .lsp-card-cta.outline {
        background: transparent;
        color: #0c2461 !important;
        -webkit-text-fill-color: #0c2461 !important;
        border: 1.5px solid #a8b8d8;
      }
      .lsp-card-cta.outline:hover {
        background: #f0f4ff;
        border-color: #0c2461;
        box-shadow: 0 4px 16px rgba(12,36,97,0.10);
      }

      /* ── Upgrade nudge ── */
      .upgrade-nudge {
        font-size: 11.5px;
        color: #111111;
        line-height: 1.6;
        margin-bottom: 20px;
        font-style: italic;
        padding: 0 2px;
      }

      /* ── Section divider ── */
      .lsp-divider {
        display: flex;
        align-items: center;
        gap: 20px;
        margin: 0 0 56px;
      }
      .lsp-divider hr {
        flex: 1;
        border: none;
        border-top: 1px solid #d8cba8;
        margin: 0;
      }
      .lsp-divider span {
        color: #C9A020;
        font-size: 16px;
        letter-spacing: 0.15em;
      }

      /* ── Feature table ── */
      .lsp-table-section { margin-top: 0; }
      .lsp-table-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;
      }
      .lsp-table-header h2 {
        font-family: "Playfair Display", Georgia, serif;
        font-size: 32px;
        font-weight: 900;
        color: #0c2461;
        -webkit-text-fill-color: #0c2461;
        margin: 0;
        letter-spacing: -0.02em;
      }
      .lsp-collapse-btn {
        background: #ffffff;
        border: 1px solid #c8bfa0;
        border-radius: 8px;
        color: #111111;
        font-family: Inter, sans-serif;
        font-size: 12.5px;
        font-weight: 600;
        padding: 8px 18px;
        cursor: pointer;
        transition: all .2s;
        letter-spacing: 0.03em;
        box-shadow: 0 1px 6px rgba(0,0,0,0.06);
      }
      .lsp-collapse-btn:hover {
        background: #f8f2e0;
        border-color: #C9A020;
        color: #0c2461;
      }
      .lsp-table-wrap {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        border-radius: 16px;
        border: 1.5px solid #d8cba8;
        box-shadow: 0 4px 28px rgba(0,0,0,0.08);
      }
      .lsp-table-wrap.collapsed { display: none; }
      .lsp-ftable {
        width: 100%;
        border-collapse: collapse;
        min-width: 720px;
        font-size: 13.5px;
      }
      .lsp-ftable thead th {
        background: #0c2461;
        padding: 16px 18px;
        text-align: center;
        font-weight: 600;
        font-size: 13px;
        color: rgba(255,255,255,0.88);
        border-bottom: 2px solid #C9A020;
        letter-spacing: 0.02em;
      }
      .lsp-ftable thead th:first-child { text-align: left; }
      .lsp-ftable thead th.col-elite {
        color: #FFE566;
        background: #163080;
      }
      .lsp-ftable tbody tr { background: #ffffff; }
      .lsp-ftable tbody tr:nth-child(even) td { background: #F9F6EE; }
      .lsp-ftable tbody td {
        padding: 12px 18px;
        border-bottom: 1px solid #ede5cc;
        color: #111111;
        text-align: center;
        transition: background .1s;
      }
      .lsp-ftable tbody tr:hover td { background: #FFF8E6 !important; }
      .lsp-ftable tbody td:first-child { text-align: left; color: #0c2461; font-weight: 500; }
      .lsp-ftable tr.section-head td {
        background: #0c2461 !important;
        color: #FFE566 !important;
        font-weight: 700;
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        padding: 10px 18px;
        border-top: none;
        border-bottom: 1px solid #1a3a8c;
      }
      .lsp-ftable .check { color: #1a8a4a; font-size: 15px; font-weight: 700; }
      .lsp-ftable .credits { color: #111111; font-size: 12px; }
      .lsp-ftable .tier-std { color: #111111; font-size: 12.5px; }
      .lsp-ftable .tier-exp { color: #1a60c0; font-size: 12.5px; }
      .lsp-ftable .tier-high { color: #1a8a4a; font-size: 12.5px; }
      .lsp-ftable .tier-ded { color: #9a7010; font-size: 12.5px; font-weight: 700; }
      .lsp-ftable .tier-lim { color: #111111; font-size: 12.5px; }
      .lsp-ftable .tier-adv { color: #6040a0; font-size: 12.5px; }
      .lsp-ftable .tier-unl { color: #1a8a4a; font-size: 12.5px; font-weight: 700; }

      /* ── Fair use ── */
      .lsp-fair-use {
        text-align: center;
        margin-top: 56px;
        font-size: 12px;
        color: #333333;
        line-height: 1.7;
        letter-spacing: 0.01em;
        padding: 0 24px;
      }

      /* ── Responsive ── */
      @media (max-width: 1100px) {
        .lsp-cards { grid-template-columns: repeat(2, 1fr); }
      }
      @media (max-width: 640px) {
        .lsp-hero h1 { font-size: 36px !important; }
        .lsp-cards { grid-template-columns: 1fr; }
        .lsp-wrap { padding: 64px 20px 100px; }
        .lsp-payg { padding: 32px 24px; }
        .lsp-table-header { flex-direction: column; align-items: flex-start; gap: 14px; }
      }
    `;
    document.head.appendChild(s);
  }

  /* ── State ──────────────────────────────────────────────────────────────── */
  var billing = 'monthly'; // 'monthly' | 'annual'
  var tableOpen = true;

  /* ── Prices ─────────────────────────────────────────────────────────────── */
  var PLANS = [
    {
      id: 'basic',
      name: 'Basic',
      desc: 'Full platform access for individuals, researchers, and lightweight legal workflows.',
      hasTrial: true,
      monthly: 49,
      annual: 39,
      per: '/mo',
      cta: 'Start Free Trial',
      ctaStyle: 'outline',
      popular: true,
      href: '/register',
      external: false,
    },
    {
      id: 'elite',
      name: 'Elite',
      desc: 'Enhanced litigation intelligence capacity for active legal professionals and larger caseloads.',
      hasTrial: false,
      monthly: 129,
      annual: 103,
      per: '/mo',
      cta: 'Upgrade to Elite',
      ctaStyle: 'gold',
      href: 'https://www.zeffy.com/en-US/ticketing/ls-elite-plan',
      external: true,
    },
    {
      id: 'chambers',
      name: 'Chambers',
      desc: 'Collaborative litigation infrastructure for firms, partnerships, and active legal teams managing shared litigation workflows.',
      hasTrial: false,
      monthly: 179,
      annual: 143,
      per: '/user/mo',
      cta: 'Choose Chambers',
      ctaStyle: 'outline',
      href: 'https://www.zeffy.com/en-US/ticketing/chambers',
      external: true,
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      desc: 'Custom infrastructure, dedicated AI capacity, advanced compliance, and enterprise legal operations support.',
      hasTrial: false,
      monthly: null,
      annual: null,
      priceLabel: 'From $349',
      per: '/user/mo',
      cta: 'Talk to Sales',
      ctaStyle: 'outline',
      href: '/contact',
    },
  ];

  /* ── Feature table data ─────────────────────────────────────────────────── */
  var C = '<span class="check">✓</span>';
  var CR = '<span class="credits">Credits</span>';
  var STD = '<span class="tier-std">Standard</span>';
  var EXP = '<span class="tier-exp">Expanded</span>';
  var HIGH = '<span class="tier-high">High</span>';
  var DED = '<span class="tier-ded">Dedicated</span>';
  var LIM = '<span class="tier-lim">Limited</span>';
  var ADV = '<span class="tier-adv">Advanced</span>';
  var UNL = '<span class="tier-unl">Unlimited</span>';

  var TABLE_SECTIONS = [
    { heading: 'Legal Brain AI', rows: [
      ['Case-context Q&A', CR, C, C, C, C],
      ['Jurisdiction-aware answers', CR, C, C, C, C],
      ['Statute & case law lookup', CR, C, C, C, C],
      ['Custom prompt templates', CR, C, C, C, C],
      ['Advanced litigation reasoning capacity', CR, STD, EXP, HIGH, DED],
      ['Concurrent AI processing', CR, STD, EXP, HIGH, DED],
      ['Large document reasoning workflows', CR, LIM, EXP, ADV, UNL],
    ]},
    { heading: 'Motion Analyzer', rows: [
      ['Upload & analyze motions', CR, C, C, C, C],
      ['Strength / weakness report', CR, C, C, C, C],
      ['Counter-argument drafts', CR, C, C, C, C],
      ['Advanced motion reasoning capacity', CR, STD, EXP, HIGH, DED],
    ]},
    { heading: 'Document Analyzer', rows: [
      ['Legal document analysis', CR, C, C, C, C],
      ['Deep contradiction analysis', CR, LIM, EXP, ADV, UNL],
      ['Multi-document reasoning workflows', CR, LIM, EXP, ADV, UNL],
    ]},
    { heading: 'Drafting Engine', rows: [
      ['AI-assisted drafting', CR, C, C, C, C],
      ['Word & PDF export', CR, C, C, C, C],
      ['Clause library', CR, C, C, C, C],
      ['Brand templates', CR, C, C, C, C],
      ['Advanced drafting intelligence', CR, STD, EXP, ADV, DED],
    ]},
    { heading: 'Case Vault', rows: [
      ['Active cases', '5', UNL, UNL, UNL, UNL],
      ['Document storage', '1 GB', '25 GB', '100 GB', '500 GB', 'Custom'],
      ['Case tags & filters', C, C, C, C, C],
      ['Conflict-of-interest check', CR, C, C, C, C],
    ]},
    { heading: 'War Room & Timeline', rows: [
      ['Visual timeline builder', CR, C, C, C, C],
      ['Deadline alerts', CR, C, C, C, C],
      ['Event calendar sync', CR, C, C, C, C],
      ['Strategic litigation simulations', CR, LIM, EXP, ADV, DED],
    ]},
    { heading: 'Live Bench', rows: [
      ['Judge profile access', CR, C, C, C, C],
      ['Ruling history analytics', CR, C, C, C, C],
      ['Court filing insights', CR, C, C, C, C],
    ]},
    { heading: 'Team Collaboration', rows: [
      ['Seats included', '1', '1', '1', 'Up to 10', UNL],
      ['Role-based permissions', CR, C, C, C, C],
      ['Shared case workspace', CR, C, C, C, C],
      ['Activity audit log', CR, C, C, C, C],
    ]},
    { heading: 'Billing & Invoicing', rows: [
      ['Client invoicing', CR, C, C, C, C],
      ['Time tracking', CR, C, C, C, C],
      ['Expense tracking', CR, C, C, C, C],
      ['QuickBooks / Xero sync', CR, C, C, C, C],
    ]},
    { heading: 'Analytics Dashboard', rows: [
      ['Personal productivity stats', CR, C, C, C, C],
      ['Firm-wide reporting', CR, C, C, C, C],
      ['Custom report builder', CR, C, C, C, C],
    ]},
    { heading: 'Security & Compliance', rows: [
      ['AES-256 encryption', C, C, C, C, C],
      ['SOC 2 compliant', C, C, C, C, C],
      ['Tenant data isolation', C, C, C, C, C],
      ['SSO / SAML 2.0', CR, C, C, C, C],
    ]},
    { heading: 'Support', rows: [
      ['Community & docs', C, C, C, C, C],
      ['Email support', C, C, C, C, C],
      ['Priority support (8-hr SLA)', CR, C, C, C, C],
      ['Dedicated account manager', CR, C, C, C, C],
      ['Custom SLA guarantee', CR, C, C, C, C],
    ]},
  ];

  /* ── Build price display ────────────────────────────────────────────────── */
  function buildPriceBlock(plan) {
    if (plan.priceLabel) {
      return '<div class="price-block">' +
        '<div class="price-main label-price">' + plan.priceLabel + '</div>' +
        '<div class="price-per">' + plan.per + '</div>' +
        '</div>';
    }
    var price = billing === 'annual' ? plan.annual : plan.monthly;
    var annualNote = billing === 'annual'
      ? '<div class="price-annual">Billed annually · Save 20%</div>'
      : '';
    return '<div class="price-block">' +
      '<div class="price-main"><span class="curr">$</span>' + price + '</div>' +
      '<div class="price-per">' + plan.per + '</div>' +
      annualNote +
      '</div>';
  }

  /* ── Build cards ────────────────────────────────────────────────────────── */
  function buildCards() {
    return PLANS.map(function (plan) {
      var popularBadge = plan.popular ? '<div class="lsp-badge-popular">Most Popular</div>' : '';
      var trialBox = plan.hasTrial
        ? '<div class="trial-info">' +
            '<strong>7-day free trial</strong> · 200 trial credits included<br>' +
            'Trial expires after 7 days or when credits are depleted<br>' +
            '<span style="color:#111111;font-size:11.5px;">No credit card required.</span>' +
          '</div>' +
          '<div class="upgrade-nudge">Upgrade anytime to unlock enhanced litigation intelligence capacity and larger workflow limits.</div>'
        : '';
      return '<div class="lsp-card' + (plan.popular ? ' popular' : '') + '">' +
        popularBadge +
        '<h3>' + plan.name + '</h3>' +
        '<div class="card-desc">' + plan.desc + '</div>' +
        trialBox +
        buildPriceBlock(plan) +
        '<a href="' + plan.href + '"' + (plan.external ? ' target="_blank" rel="noopener"' : '') + ' class="lsp-card-cta ' + plan.ctaStyle + '">' + plan.cta + '</a>' +
        '</div>';
    }).join('');
  }

  /* ── Build table ────────────────────────────────────────────────────────── */
  function buildTable() {
    var rows = '';
    TABLE_SECTIONS.forEach(function (sec) {
      rows += '<tr class="section-head"><td colspan="6">' + sec.heading + '</td></tr>';
      sec.rows.forEach(function (row) {
        rows += '<tr>' +
          '<td>' + row[0] + '</td>' +
          '<td>' + row[1] + '</td>' +
          '<td>' + row[2] + '</td>' +
          '<td>' + row[3] + '</td>' +
          '<td>' + row[4] + '</td>' +
          '<td>' + row[5] + '</td>' +
          '</tr>';
      });
    });
    return rows;
  }

  /* ── Full HTML ──────────────────────────────────────────────────────────── */
  function buildHTML() {
    return '<div class="lsp-wrap">' +

      /* Ornament */
      '<div class="lsp-ornament">' +
        '<span></span><em>✦ ✦ ✦</em><span></span>' +
      '</div>' +

      /* Hero */
      '<div class="lsp-hero">' +
        '<div class="lsp-eyebrow">Institutional-Grade Legal AI</div>' +
        '<h1>Simple, Transparent Pricing</h1>' +
        '<p>Every paid plan includes the complete LitigationSpace platform. No feature gating, no hidden upgrade traps, and no surprise per-seat charges on core tools.</p>' +
        '<div class="lsp-toggle-wrap">' +
          '<div class="lsp-toggle">' +
            '<button id="lsp-btn-monthly" class="' + (billing === 'monthly' ? 'active' : '') + '">Monthly</button>' +
            '<button id="lsp-btn-annual" class="' + (billing === 'annual' ? 'active' : '') + '">Annual <span class="lsp-save-badge">Save 20%</span></button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* Notice */
      '<div class="lsp-notice">' +
        '<span class="star">✦</span>' +
        '<span>Every paid plan includes all LitigationSpace tools — AI processing capacity, storage, collaboration, and workflow scale increase by plan.</span>' +
      '</div>' +

      /* PAYG */
      '<div class="lsp-payg">' +
        '<h2>Pay As You Go</h2>' +
        '<p>No monthly commitment — buy credits and use LitigationSpace at your own pace.</p>' +
        '<div class="price">From $0.10 <span>/ credit</span></div>' +
        '<a href="https://www.zeffy.com/en-US/ticketing/pay-as-you-go" target="_blank" rel="noopener" class="lsp-card-cta outline" style="max-width:220px;margin:0 auto;display:block;">Get Credits</a>' +
      '</div>' +

      /* Divider */
      '<div class="lsp-divider"><hr/><span>◆</span><hr/></div>' +

      /* Plan cards */
      '<div class="lsp-cards" id="lsp-cards">' + buildCards() + '</div>' +

      /* Divider */
      '<div class="lsp-divider"><hr/><span>◆</span><hr/></div>' +

      /* Feature table */
      '<div class="lsp-table-section">' +
        '<div class="lsp-table-header">' +
          '<h2>Full Feature Comparison</h2>' +
          '<button class="lsp-collapse-btn" id="lsp-collapse-btn">' + (tableOpen ? 'Collapse ▲' : 'Expand ▼') + '</button>' +
        '</div>' +
        '<p style="font-size:13.5px;color:#111111;margin:0 0 28px;line-height:1.6;">See exactly what\'s included across every plan.</p>' +
        '<div class="lsp-table-wrap' + (tableOpen ? '' : ' collapsed') + '" id="lsp-table-wrap">' +
          '<table class="lsp-ftable">' +
            '<thead><tr>' +
              '<th style="width:34%">Feature</th>' +
              '<th>Pay As You Go</th>' +
              '<th>Basic</th>' +
              '<th class="col-elite">Elite</th>' +
              '<th>Chambers</th>' +
              '<th>Enterprise</th>' +
            '</tr></thead>' +
            '<tbody>' + buildTable() + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +

      /* Fair use */
      '<div class="lsp-fair-use">Advanced AI processing and litigation intelligence workflows are subject to platform fair use and compute policies.</div>' +

    '</div>';
  }

  /* ── Wire events ────────────────────────────────────────────────────────── */
  function wireEvents(root) {
    var btnMonthly = root.querySelector('#lsp-btn-monthly');
    var btnAnnual  = root.querySelector('#lsp-btn-annual');
    var cards      = root.querySelector('#lsp-cards');
    var collapseBtn = root.querySelector('#lsp-collapse-btn');
    var tableWrap  = root.querySelector('#lsp-table-wrap');

    if (btnMonthly) {
      btnMonthly.addEventListener('click', function () {
        billing = 'monthly';
        btnMonthly.classList.add('active');
        btnAnnual.classList.remove('active');
        if (cards) cards.innerHTML = buildCards();
      });
    }
    if (btnAnnual) {
      btnAnnual.addEventListener('click', function () {
        billing = 'annual';
        btnAnnual.classList.add('active');
        btnMonthly.classList.remove('active');
        if (cards) cards.innerHTML = buildCards();
      });
    }
    if (collapseBtn && tableWrap) {
      collapseBtn.addEventListener('click', function () {
        tableOpen = !tableOpen;
        tableWrap.classList.toggle('collapsed', !tableOpen);
        collapseBtn.textContent = tableOpen ? 'Collapse ▲' : 'Expand ▼';
      });
    }
  }

  /* ── Find & replace pricing container ──────────────────────────────────── */
  function apply() {
    injectStyles();

    if (document.querySelector('[data-ls-pricing="1"]')) return true;

    // The React pricing component (kN) renders:
    //   <div style="background:#0a1628; min-height:100vh">   ← outer (dark)
    //     <Navbar/>
    //     <div class="pt-16">                                 ← content wrapper
    //       <div class="max-w-7xl ...">content</div>
    //     </div>
    //   </div>
    //
    // Strategy:
    //   1. Find the outer div (first child of #root) once it has pricing content
    //   2. Strip its inline dark background → set cream directly
    //   3. Find the content wrapper (div.pt-16) and replace its innerHTML

    var rootDiv = document.querySelector('#root > div');
    if (!rootDiv) return false;

    // Confirm this is the pricing page render (not another route)
    if (rootDiv.textContent.indexOf('Simple, Transparent Pricing') === -1 &&
        rootDiv.textContent.indexOf('Transparent Pricing') === -1 &&
        rootDiv.textContent.indexOf('Pay As You Go') === -1) {
      return false;
    }

    // Clear the React component's inline dark background
    rootDiv.style.background = 'linear-gradient(170deg, #FFFDF5 0%, #FDF8EC 50%, #FAF4E4 100%)';
    rootDiv.style.minHeight = '100vh';
    rootDiv.style.color = '#0c2461';

    // Find content wrapper (div.pt-16 — sits right below the navbar)
    var contentWrap = rootDiv.querySelector('.pt-16');
    if (!contentWrap) {
      // Fallback: second child of rootDiv (first child is the navbar)
      contentWrap = rootDiv.children.length > 1 ? rootDiv.children[1] : rootDiv;
    }

    contentWrap.setAttribute('data-ls-pricing', '1');
    contentWrap.style.cssText = ''; // clear any inline padding/margin
    contentWrap.innerHTML = buildHTML();
    wireEvents(contentWrap);
    return true;
  }

  /* ── Boot ───────────────────────────────────────────────────────────────── */
  function tryApply() {
    if (apply()) return;
    var n = 0;
    var iv = setInterval(function () {
      n++;
      if (apply() || n > 50) clearInterval(iv);
    }, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tryApply, 400); });
  } else {
    setTimeout(tryApply, 400);
  }

  /* Re-apply on SPA navigation back to /pricing */
  setInterval(function () {
    if (window.location.pathname.replace(/\/$/, '') !== '/pricing') return;
    // Also re-strip dark background if React re-renders it
    var rootDiv = document.querySelector('#root > div');
    if (rootDiv && rootDiv.style.background.indexOf('0a1628') !== -1) {
      rootDiv.style.background = 'linear-gradient(170deg, #FFFDF5 0%, #FDF8EC 50%, #FAF4E4 100%)';
      rootDiv.style.color = '#0c2461';
    }
    if (!document.querySelector('[data-ls-pricing="1"]')) tryApply();
  }, 2000);

})();
