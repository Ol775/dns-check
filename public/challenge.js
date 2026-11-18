// Human-check page: renders the Turnstile widget (re-rendered when the theme changes), shows what is happening
// (loading, verifying, verified, errors with a retry), and trades the token for the access cookie.
(() => {
  'use strict';
  document.documentElement.classList.add('js'); // tells the page's CSS-only fallback hint that scripts are running
  const $ = id => document.getElementById(id);
  const EN = { ch_loading: 'Loading the check…', chk_wait: 'Checking…', ch_verified: 'Verified. Starting the test…', ch_retry: 'Try again', ch_toomany: 'Too many attempts. Wait a minute, then try again.', ch_slow: 'Taking longer than usual. If you use a content blocker, allow challenges.cloudflare.com, then try again.', verify_fail: 'Verification failed.' };
  const t = k => (window.DNSCK ? DNSCK.t(k) : EN[k] || k);
  let wid, state = null, slowTimer, pollTimer;

  // status line: a spinner, a tick or a warning mark plus text; kept as a key so it re-translates when the language changes
  function paint() {
    const s = $('status'); if (!s) return;
    s.replaceChildren();
    $('retry').hidden = !state || state.kind !== 'error';
    if (!state) return;
    const ic = document.createElement('span'), tx = document.createElement('span');
    ic.className = 'ic ' + state.kind; ic.setAttribute('aria-hidden', 'true'); tx.textContent = t(state.key);
    s.append(ic, tx);
  }
  const set = (key, kind) => { state = key ? { key, kind } : null; paint(); };

  const isDark = () => { const a = document.documentElement.getAttribute('data-theme'); return a ? a === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
  const solved = () => document.body.classList.contains('done');

  // Turnstile keeps its frame out of reach of page scripts, so "the widget is on screen" is read from the size of its container
  const shown = el => (el.firstElementChild?.offsetHeight || 0) > 0;

  function draw() {
    const el = $('ts');
    if (!window.turnstile || solved()) return;
    if (!el) return addEventListener('DOMContentLoaded', draw, { once: true });
    clearTimeout(slowTimer); clearInterval(pollTimer);
    if (wid != null) turnstile.remove(wid);
    $('slot').classList.remove('ready'); set('ch_loading', 'spin');
    wid = turnstile.render(el, { sitekey: el.dataset.sitekey, theme: isDark() ? 'dark' : 'light', callback: window.ok, 'error-callback': window.bad, 'expired-callback': () => turnstile.reset(wid) });
    pollTimer = setInterval(() => {
      if (!shown(el)) return;
      clearInterval(pollTimer); clearTimeout(slowTimer);
      $('slot').classList.add('ready'); if (state?.key === 'ch_loading') set(null);
    }, 100);
    slowTimer = setTimeout(() => { if (!shown(el)) { clearInterval(pollTimer); set('ch_slow', 'error'); } }, 8000);
  }

  window.bad = () => { clearTimeout(slowTimer); clearInterval(pollTimer); set('verify_fail', 'error'); };
  window.ok = async token => {
    set('chk_wait', 'spin');
    try {
      const r = await fetch('/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
      if (r.ok) { document.body.classList.add('done'); set('ch_verified', 'ok'); setTimeout(() => location.reload(), 700); return; }
      set(r.status === 429 ? 'ch_toomany' : 'verify_fail', 'error');
    } catch { set('verify_fail', 'error'); }
  };
  window.tsReady = draw; // called by Turnstile's api.js once it has loaded

  document.addEventListener('dnsck:theme', draw);
  document.addEventListener('dnsck:lang', paint);
  // this script runs in <head>, so anything touching the page's elements waits for it to exist
  addEventListener('DOMContentLoaded', () => {
    $('retry').addEventListener('click', () => { set(null); draw(); });
    if (!state) set('ch_loading', 'spin');
  });
})();
