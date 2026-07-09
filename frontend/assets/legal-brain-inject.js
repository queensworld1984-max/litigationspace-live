(function () {
  'use strict';
  if (!location.pathname.startsWith('/legal-brain')) return;
  if (document.getElementById('lb-inject-style')) return;

  /* ── CSS ──────────────────────────────────────────────────────────────────── */
  const CSS = ;

  const styleEl = document.createElement('style');
  styleEl.id = 'lb-inject-style';
  document.head.appendChild(styleEl);
  styleEl.textContent = CSS;

  /* ── Pills ─────────────────────────────────────────────────────────────────── */
  const PILLS = [
    { label: 'Email Drafter',    text: 'Draft a professional legal email' },
    { label: 'Research',         text: 'Research the legal issues in my case' },
    { label: 'Analyze Document', text: 'Analyze this legal document' },
    { label: 'Analyze Motion',   text: 'Analyze this motion and advise on strategy' },
  ];

  function getTextarea() {
    return document.querySelector('textarea[placeholder*=legal question]') ||
           document.querySelector('textarea[placeholder*=Ask any]');
  }

  function fillTextarea(text) {
    const ta = getTextarea();
    if (!ta) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  }

  let pillsAdded = false;
  function addPills() {
    if (pillsAdded) return;
    const ta = getTextarea();
    if (!ta) return;
    const bar = ta.closest('div[style*=border-top]');
    if (!bar || bar.querySelector('.lb-pills')) return;
    const wrap = document.createElement('div');
    wrap.className = 'lb-pills';
    PILLS.forEach(function (p) {
      const btn = document.createElement('button');
      btn.className = 'lb-pill';
      btn.textContent = p.label;
      btn.addEventListener('click', function () { fillTextarea(p.text); });
      wrap.appendChild(btn);
    });
    bar.insertBefore(wrap, bar.firstChild);
    pillsAdded = true;
  }

  /* ── Wrap assistant bubbles ─────────────────────────────────────────────────── */
  function wrapBubble(bubble) {
    if (bubble.dataset.lbDone) return;
    bubble.dataset.lbDone = '1';
    const inner = bubble.querySelector('div');
    if (!inner) return;
    const surround = document.createElement('div');
    surround.className = 'lb-surround';
    const card = document.createElement('div');
    card.className = 'lb-card';
    const md = document.createElement('div');
    md.className = 'lb-md';
    md.innerHTML = inner.innerHTML;
    card.appendChild(md);
    surround.appendChild(card);
    bubble.style.cssText = 'background:transparent;border:none;padding:0;border-radius:0;';
    inner.innerHTML = '';
    inner.appendChild(surround);
  }

  function scan() {
    document.querySelectorAll('div').forEach(function (el) {
      if (el.style.justifyContent !== 'flex-start') return;
      const ch = el.children;
      if (ch.length < 2) return;
      const avatar = ch[0];
      if (!avatar || avatar.offsetWidth > 50) return;
      const wrapper = ch[1];
      if (!wrapper) return;
      const bubble = wrapper.firstElementChild;
      if (bubble && !bubble.dataset.lbDone) wrapBubble(bubble);
    });
    addPills();
  }

  const obs = new MutationObserver(scan);
  function init() {
    obs.observe(document.body, { childList: true, subtree: true });
    scan();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
