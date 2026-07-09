/**
 * login-inject.js
 * Reads query params on /login and /signin pages and shows contextual banners:
 *   ?verified=1       → "Email verified — you can now sign in"
 *   ?error=link_expired  → "Verification link expired — request a new one"
 *   ?error=link_invalid  → "Invalid verification link"
 */
(function () {
  'use strict';

  var path = window.location.pathname;
  if (path !== '/login' && path !== '/signin') return;

  var params = new URLSearchParams(window.location.search);
  var verified = params.get('verified');
  var error    = params.get('error');

  if (!verified && !error) return;

  /* ── Styles ── */
  (function () {
    if (document.getElementById('ls-login-banner-style')) return;
    var s = document.createElement('style');
    s.id = 'ls-login-banner-style';
    s.textContent = `
      .ls-login-banner {
        font-family: Inter, sans-serif;
        font-size: 13.5px;
        font-weight: 500;
        line-height: 1.5;
        padding: 12px 18px;
        border-radius: 10px;
        margin-bottom: 16px;
        display: flex;
        align-items: flex-start;
        gap: 10px;
        animation: ls-banner-in .3s ease;
      }
      @keyframes ls-banner-in {
        from { opacity: 0; transform: translateY(-6px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .ls-login-banner.success {
        background: #f0fdf4;
        border: 1px solid #86efac;
        color: #166534;
      }
      .ls-login-banner.error {
        background: #fff1f2;
        border: 1px solid #fca5a5;
        color: #991b1b;
      }
      .ls-login-banner .icon { flex-shrink: 0; font-size: 16px; margin-top: 1px; }
    `;
    document.head.appendChild(s);
  })();

  /* ── Build banner ── */
  var isSuccess = verified === '1';
  var message   = isSuccess
    ? '✓ Your email has been verified. You can now sign in.'
    : error === 'link_expired'
      ? '⚠ Your verification link has expired. Sign in and request a new one.'
      : '⚠ Invalid verification link. Please check your email or request a new one.';

  var banner = document.createElement('div');
  banner.className = 'ls-login-banner ' + (isSuccess ? 'success' : 'error');
  banner.textContent = message;

  /* ── Find the login form and insert banner above it ── */
  function inject() {
    /* Look for the login form container */
    var form = document.querySelector('form') ||
               document.querySelector('input[type="email"]');
    if (!form) return false;

    var container = form.tagName === 'FORM' ? form : form.closest('form') || form.parentElement;
    if (!container) return false;

    /* Don't inject twice */
    if (container.querySelector('.ls-login-banner')) return true;

    container.insertBefore(banner, container.firstChild);

    /* Clean the URL so refreshing doesn't re-show the banner */
    try {
      var clean = window.location.pathname;
      history.replaceState(null, '', clean);
    } catch (e) {}

    return true;
  }

  function tryInject() {
    if (inject()) return;
    var n = 0;
    var iv = setInterval(function () {
      n++;
      if (inject() || n > 30) clearInterval(iv);
    }, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tryInject, 400); });
  } else {
    setTimeout(tryInject, 400);
  }

})();
