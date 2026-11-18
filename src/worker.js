// Turnstile gate: the page is only served to browsers holding a signed cookie, issued after Cloudflare verifies a challenge token.
const TTL = 3600; // seconds a solved challenge stays valid
const enc = new TextEncoder();
const PUBLIC = new Set(['/favicon.ico', '/favicon.png', '/icon.svg', '/apple-touch-icon.png', '/privacy', '/cookie-notice.js']); // readable before the challenge: tab icon and the policy

const sign = async (secret, msg) => {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))].map(b => b.toString(16).padStart(2, '0')).join('');
};

async function hasPass(request, secret) {
  const m = /(?:^|;\s*)dnsck=(\d+)\.([0-9a-f]+)/.exec(request.headers.get('Cookie') || '');
  if (!m || Number(m[1]) < Date.now() / 1000) return false;
  const good = await sign(secret, m[1]);
  return good.length === m[2].length && crypto.subtle.timingSafeEqual(enc.encode(good), enc.encode(m[2])); // timingSafeEqual is a Workers extension
}

const challenge = sitekey => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>DNS Check</title><meta name="robots" content="noindex"><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
  :root{--bg:#f5f6f8;--fg:#16181c;--mut:#667085;--bad:#c0262d}@media(prefers-color-scheme:dark){:root{--bg:#0e0f12;--fg:#ececf0;--mut:#9aa1ad;--bad:#ff7b80}}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;text-align:center;padding:16px}
  h1{font-size:1.35rem;margin:12px 0 4px}p{color:var(--mut);margin:0 0 20px}#err{color:var(--bad);min-height:1.5em;margin-top:12px}
</style>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><script src="/cookie-notice.js" defer></script></head>
<body><main>
<svg width="56" height="56" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#0ea5a4"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#lg)"/><g fill="none" stroke="#fff" stroke-opacity=".3"><circle cx="16" cy="16.5" r="12"/><circle cx="16" cy="16.5" r="8.5"/></g><path d="M16 5.5 7.5 8.6v6.6c0 5.2 3.5 8.7 8.5 10.9 5-2.2 8.5-5.7 8.5-10.9V8.6z" fill="#fff"/><path d="m11.9 15.8 3 3 5.4-5.9" fill="none" stroke="#0e8fa6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
<h1>DNS Check</h1><p>Quick check that you're human, then the test runs.</p>
<div class="cf-turnstile" data-sitekey="${sitekey}" data-callback="ok" data-error-callback="bad"></div>
<div id="err" role="alert"></div><p style="margin-top:32px;font-size:.85rem"><a href="/privacy" style="color:var(--mut)">Privacy and terms</a></p></main>
<script>
async function ok(token){
  const r = await fetch('/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});
  r.ok ? location.reload() : bad();
}
function bad(){ document.getElementById('err').textContent='Verification failed. Reload to try again.'; }
</script></body></html>`, { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } });

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/verify') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      const { token } = await request.json().catch(() => ({}));
      if (typeof token !== 'string' || !token) return new Response('Bad request', { status: 400 });
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: request.headers.get('CF-Connecting-IP') || '' }),
      });
      const out = await res.json().catch(() => ({}));
      if (!out.success) return new Response('Verification failed', { status: 403 });
      const exp = String(Math.floor(Date.now() / 1000) + TTL);
      return new Response(null, { status: 204, headers: { 'Set-Cookie': `dnsck=${exp}.${await sign(env.TURNSTILE_SECRET, exp)}; Max-Age=${TTL}; Path=/; HttpOnly; Secure; SameSite=Lax` } });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    if (PUBLIC.has(pathname) || await hasPass(request, env.TURNSTILE_SECRET)) return env.ASSETS.fetch(request);
    return challenge(env.TURNSTILE_SITEKEY);
  },
};
