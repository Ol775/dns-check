// Human-check page: renders the Turnstile widget (re-rendered when the theme changes) and trades the token for the access cookie.
(() => {
  let wid;
  const isDark = () => { const a = document.documentElement.getAttribute('data-theme'); return a ? a === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
  window.bad = () => { document.getElementById('err').textContent = window.DNSCK ? DNSCK.t('verify_fail') : 'Verification failed. Reload to try again.'; };
  window.ok = async token => {
    const r = await fetch('/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    r.ok ? location.reload() : window.bad();
  };
  function draw() {
    const el = document.getElementById('ts');
    if (!window.turnstile) return;
    if (!el) return addEventListener('DOMContentLoaded', draw, { once: true });
    if (wid != null) turnstile.remove(wid);
    wid = turnstile.render(el, { sitekey: el.dataset.sitekey, theme: isDark() ? 'dark' : 'light', callback: window.ok, 'error-callback': window.bad });
  }
  window.tsReady = draw; // called by Turnstile's api.js once loaded
  document.addEventListener('dnsck:theme', draw);
})();
