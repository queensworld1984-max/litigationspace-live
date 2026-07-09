/**
 * subscription-inject.js
 * Shows plan type + days/credits remaining in the dashboard sidebar.
 * Runs on all authenticated dashboard routes.
 * Fetches /api/v1/billing/subscription/status using the stored JWT.
 */
(function () {
  'use strict';

  /* ── Only run inside the dashboard ─────────────────────────────────────── */
  function isDashboardRoute() {
    var p = window.location.pathname;
    return p.startsWith('/dashboard') || p.startsWith('/cases') ||
           p.startsWith('/legal-brain') || p.startsWith('/motion-analyzer') ||
           p.startsWith('/war-room') || p.startsWith('/drafting') ||
           p.startsWith('/jurisdiction') || p.startsWith('/live-bench') ||
           p.startsWith('/team') || p.startsWith('/billing') ||
           p.startsWith('/notifications') || p.startsWith('/settings') ||
           p.startsWith('/win-simulator') || p.startsWith('/document-analyzer') ||
           p.startsWith('/workflows');
  }

  /* ── Auth token ─────────────────────────────────────────────────────────── */
  function getToken() {
    try { return localStorage.getItem('token') || sessionStorage.getItem('token') || null; }
    catch (e) { return null; }
  }

  /* ── Styles ─────────────────────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('ls-sub-styles')) return;
    var s = document.createElement('style');
    s.id = 'ls-sub-styles';
    s.textContent = `
      .ls-sub-widget {
        margin: 8px 10px 12px;
        border-radius: 10px;
        padding: 12px 14px;
        font-family: Inter, sans-serif;
        font-size: 12px;
        position: relative;
        overflow: hidden;
        flex-shrink: 0;
      }

      /* Grace / Trial */
      .ls-sub-widget.ls-sw-trial {
        background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
        border: 1px solid #fcd34d;
      }
      .ls-sub-widget.ls-sw-grace {
        background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
        border: 1px solid #86efac;
      }

      /* Paid */
      .ls-sub-widget.ls-sw-active {
        background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
        border: 1px solid #93c5fd;
      }
      .ls-sub-widget.ls-sw-payg {
        background: linear-gradient(135deg, #faf5ff 0%, #ede9fe 100%);
        border: 1px solid #c4b5fd;
      }

      /* Restricted */
      .ls-sub-widget.ls-sw-restricted {
        background: linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%);
        border: 1px solid #fca5a5;
      }

      /* Plan name row */
      .ls-sw-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .ls-sw-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-weight: 700;
        font-size: 11.5px;
        letter-spacing: 0.01em;
      }
      .ls-sw-badge.trial   { color: #92400e; }
      .ls-sw-badge.grace   { color: #166534; }
      .ls-sw-badge.active  { color: #1e3a8a; }
      .ls-sw-badge.payg    { color: #4c1d95; }
      .ls-sw-badge.restricted { color: #991b1b; }

      .ls-sw-dot {
        width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
      }
      .ls-sw-dot.trial      { background: #f59e0b; }
      .ls-sw-dot.grace      { background: #22c55e; box-shadow: 0 0 0 2px rgba(34,197,94,0.25); animation: ls-sw-pulse 2s infinite; }
      .ls-sw-dot.active     { background: #3b82f6; }
      .ls-sw-dot.payg       { background: #8b5cf6; }
      .ls-sw-dot.restricted { background: #ef4444; }

      @keyframes ls-sw-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.4); }
        50%       { box-shadow: 0 0 0 4px rgba(34,197,94,0); }
      }

      /* Days remaining */
      .ls-sw-days {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 9999px;
        white-space: nowrap;
      }
      .ls-sw-days.urgent   { background: #fef2f2; color: #dc2626; border: 1px solid #fca5a5; }
      .ls-sw-days.warn     { background: #fffbeb; color: #d97706; border: 1px solid #fcd34d; }
      .ls-sw-days.ok       { background: #f0fdf4; color: #16a34a; border: 1px solid #86efac; }
      .ls-sw-days.paid     { background: #eff6ff; color: #2563eb; border: 1px solid #93c5fd; }

      /* Credit bar */
      .ls-sw-credits-label {
        display: flex;
        justify-content: space-between;
        color: #6b7280;
        font-size: 10.5px;
        margin-bottom: 4px;
      }
      .ls-sw-bar-track {
        height: 4px;
        background: rgba(0,0,0,0.08);
        border-radius: 9999px;
        overflow: hidden;
        margin-bottom: 10px;
      }
      .ls-sw-bar-fill {
        height: 100%;
        border-radius: 9999px;
        transition: width .4s ease;
      }
      .ls-sw-bar-fill.high  { background: #22c55e; }
      .ls-sw-bar-fill.mid   { background: #f59e0b; }
      .ls-sw-bar-fill.low   { background: #ef4444; }

      /* Upgrade CTA */
      .ls-sw-cta {
        display: block;
        text-align: center;
        background: #0c2461;
        color: #FFE566 !important;
        -webkit-text-fill-color: #FFE566 !important;
        text-decoration: none !important;
        font-size: 11px;
        font-weight: 700;
        padding: 6px 0;
        border-radius: 7px;
        letter-spacing: 0.03em;
        transition: opacity .15s;
      }
      .ls-sw-cta:hover { opacity: .88; }

      .ls-sw-plan-name {
        font-size: 10.5px;
        color: #6b7280;
        margin-bottom: 4px;
      }
    `;
    document.head.appendChild(s);
  }

  /* ── Fetch subscription status ──────────────────────────────────────────── */
  var _cachedState  = null;
  var _cacheExpiry  = 0;
  var CACHE_TTL_MS  = 60000; // 1 min

  function fetchStatus(cb) {
    var now = Date.now();
    if (_cachedState && now < _cacheExpiry) { cb(_cachedState); return; }

    var token = getToken();
    if (!token) { cb(null); return; }

    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/v1/billing/subscription/status', true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.timeout = 8000;
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          _cachedState = data;
          _cacheExpiry = Date.now() + CACHE_TTL_MS;
          cb(data);
        } catch (e) { cb(null); }
      } else { cb(null); }
    };
    xhr.onerror = xhr.ontimeout = function () { cb(null); };
    xhr.send();
  }

  /* ── Build widget HTML ──────────────────────────────────────────────────── */
  function buildWidget(state) {
    if (!state) return null;

    var status = state.status || 'trial';
    var plan   = state.plan   || 'none';

    /* ── Labels ── */
    var planLabel = {
      none:       'Free Trial',
      basic:      'Basic Plan',
      elite:      'Elite Plan',
      chambers:   'Chambers Plan',
      enterprise: 'Enterprise',
      payg:       'Pay As You Go',
    }[plan] || 'Free Trial';

    var statusLabel = {
      grace:      'Grace Period',
      trial:      'Free Trial',
      active:     planLabel,
      payg:       'Pay As You Go',
      restricted: 'Trial Ended',
    }[status] || 'Free Trial';

    var cls = {
      grace:      'grace',
      trial:      'trial',
      active:     'active',
      payg:       'payg',
      restricted: 'restricted',
    }[status] || 'trial';

    /* ── Days remaining ── */
    var daysHtml = '';
    var days = state.days_remaining;
    if (status === 'active' || status === 'payg') {
      daysHtml = '<span class="ls-sw-days paid">Active</span>';
    } else if (days !== null && days !== undefined) {
      var urgency = days <= 1 ? 'urgent' : days <= 3 ? 'warn' : 'ok';
      var daysTxt = days === 0 ? 'Expires today'
                  : days === 1 ? '1 day left'
                  : days + ' days left';
      daysHtml = '<span class="ls-sw-days ' + urgency + '">' + daysTxt + '</span>';
    } else if (status === 'restricted') {
      daysHtml = '<span class="ls-sw-days urgent">Expired</span>';
    }

    /* ── Credits bar (trial/grace only) ── */
    var creditsHtml = '';
    if (status === 'trial' || status === 'grace') {
      var total   = state.trial_credits_total   || 200;
      var used    = state.trial_credits_used    || 0;
      var rem     = state.trial_credits_remaining !== undefined ? state.trial_credits_remaining : (total - used);
      var pct     = Math.max(0, Math.min(100, Math.round((rem / total) * 100)));
      var barCls  = pct > 50 ? 'high' : pct > 20 ? 'mid' : 'low';
      creditsHtml =
        '<div class="ls-sw-credits-label">' +
          '<span>AI Credits</span>' +
          '<span><strong>' + rem + '</strong> / ' + total + '</span>' +
        '</div>' +
        '<div class="ls-sw-bar-track">' +
          '<div class="ls-sw-bar-fill ' + barCls + '" style="width:' + pct + '%"></div>' +
        '</div>';
    } else if (status === 'active') {
      var subRem   = state.subscription_credits_remaining || 0;
      var subTotal = state.subscription_credits_total     || 0;
      var payg     = state.payg_credits                   || 0;
      if (subTotal > 0) {
        var subPct  = Math.max(0, Math.min(100, Math.round((subRem / subTotal) * 100)));
        var subBar  = subPct > 50 ? 'high' : subPct > 20 ? 'mid' : 'low';
        creditsHtml =
          '<div class="ls-sw-credits-label">' +
            '<span>Monthly Credits</span>' +
            '<span><strong>' + subRem.toLocaleString() + '</strong> / ' + subTotal.toLocaleString() + '</span>' +
          '</div>' +
          '<div class="ls-sw-bar-track">' +
            '<div class="ls-sw-bar-fill ' + subBar + '" style="width:' + subPct + '%"></div>' +
          '</div>';
        if (payg > 0) {
          creditsHtml += '<div class="ls-sw-credits-label" style="margin-top:2px;">' +
            '<span style="color:#8b5cf6;">+ PAYG Credits</span>' +
            '<span style="color:#8b5cf6;"><strong>' + payg.toLocaleString() + '</strong></span>' +
            '</div>';
        }
      }
    } else if (status === 'payg') {
      var pg    = state.payg_credits || 0;
      creditsHtml =
        '<div class="ls-sw-credits-label">' +
          '<span>Credits</span>' +
          '<span><strong>' + pg.toLocaleString() + '</strong></span>' +
        '</div>';
    }

    /* ── Upgrade CTA ── */
    var ctaHtml = '';
    if (status === 'trial' || status === 'grace' || status === 'restricted') {
      ctaHtml = '<a href="/pricing" class="ls-sw-cta">Upgrade Plan →</a>';
    }

    return (
      '<div class="ls-sw-header">' +
        '<span class="ls-sw-badge ' + cls + '">' +
          '<span class="ls-sw-dot ' + cls + '"></span>' +
          statusLabel +
        '</span>' +
        daysHtml +
      '</div>' +
      creditsHtml +
      ctaHtml
    );
  }

  /* ── Inject widget into sidebar ─────────────────────────────────────────── */
  function getWidgetClass(status) {
    return 'ls-sub-widget ls-sw-' + (status || 'trial');
  }

  function injectWidget(state) {
    if (!isDashboardRoute()) return;
    injectStyles();

    var aside = document.querySelector('aside');
    if (!aside) return;

    var existing = document.getElementById('ls-sub-widget');

    if (!state) {
      if (existing) existing.remove();
      return;
    }

    var html = buildWidget(state);
    if (!html) return;

    if (existing) {
      /* Update in-place — swap class and content */
      existing.className = getWidgetClass(state.status);
      existing.innerHTML = html;
      return;
    }

    var widget = document.createElement('div');
    widget.id = 'ls-sub-widget';
    widget.className = getWidgetClass(state.status);
    widget.innerHTML = html;

    /* Pin to bottom of aside — insert before last child if aside has a bottom section,
       otherwise append. We look for a user-avatar/profile row at the bottom. */
    var bottomAnchor = aside.querySelector('[data-ls-user-row]') ||
                       aside.querySelector('button:last-child') ||
                       null;

    if (bottomAnchor && aside.contains(bottomAnchor)) {
      aside.insertBefore(widget, bottomAnchor);
    } else {
      aside.appendChild(widget);
    }
  }

  /* ── Poll & refresh ─────────────────────────────────────────────────────── */
  var _lastPath = null;

  function refresh() {
    if (!isDashboardRoute()) return;
    fetchStatus(function (state) {
      injectWidget(state);
    });
  }

  function boot() {
    refresh();

    /* Re-run when React SPA navigates */
    setInterval(function () {
      var p = window.location.pathname;
      if (p !== _lastPath) {
        _lastPath = p;
        _cachedState = null; // clear cache on nav
        refresh();
      }
    }, 800);

    /* Refresh data every 90 seconds */
    setInterval(function () {
      if (isDashboardRoute()) {
        _cachedState = null;
        refresh();
      }
    }, 90000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 600); });
  } else {
    setTimeout(boot, 600);
  }

})();
