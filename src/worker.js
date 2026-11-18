import { json, readJson, me, ping, ports } from './net.js';

// Turnstile gate: the page is only served to browsers holding a signed cookie, issued after Cloudflare verifies a challenge token.
const TTL = 3600; // seconds a solved challenge stays valid
const MAX_BODY = 4096; // bytes accepted by /verify; a Turnstile token is at most 2048 characters
const MAX_TOKEN = 2048;
const enc = new TextEncoder();
// readable before the challenge: tab icons, the policy and the files the challenge page itself needs
const PUBLIC = new Set(['/favicon.ico', '/favicon.png', '/icon.svg', '/apple-touch-icon.png', '/privacy', '/cookie-notice.js', '/ui.js', '/theme-init.js', '/challenge.js']);

// Everything the app talks to, nothing else. Inline <style> and style="" stay allowed (they can't run script); inline scripts are not.
const CSP = [
  "default-src 'none'",
  "script-src 'self' https://cdnjs.cloudflare.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "img-src 'self' data: https://tile.openstreetmap.org https://cdnjs.cloudflare.com",
  "connect-src 'self' https://bash.ws https://*.bash.ws https://get.geojs.io https://api.ipify.org https://api64.ipify.org https://cloudflare-dns.com https://help.one.one.one.one https://doubleclick.net https://example.com https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "base-uri 'none'", "form-action 'none'", "object-src 'none'", "frame-ancestors 'none'",
].join('; ');

const secure = res => {
  const h = new Headers(res.headers);
  h.set('Content-Security-Policy', CSP);
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin'); // OpenStreetMap's tile servers require a Referer
  h.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=()');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
};

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
<script src="/theme-init.js"></script>
<style>
  :root{color-scheme:light dark;--bg:#f5f6f8;--fg:#16181c;--mut:#667085;--card:#fff;--line:#e4e7ec;--onme:#fff;--me:#2563eb;--ok:#12805c;--bad:#c0262d;--glow:rgba(37,99,235,.10)}
  :root[data-theme="light"]{color-scheme:light}
  @media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0e0f12;--fg:#ececf0;--mut:#9aa1ad;--card:#17191d;--line:#2a2d33;--onme:#0e0f12;--me:#6ea0ff;--ok:#4cc79a;--bad:#ff7b80;--glow:rgba(110,160,255,.12)}}
  :root[data-theme="dark"]{color-scheme:dark;--bg:#0e0f12;--fg:#ececf0;--mut:#9aa1ad;--card:#17191d;--line:#2a2d33;--onme:#0e0f12;--me:#6ea0ff;--ok:#4cc79a;--bad:#ff7b80;--glow:rgba(110,160,255,.12)}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Hiragino Sans","PingFang SC","Noto Sans CJK SC",sans-serif;text-align:center}
  main{width:calc(100% - 32px);max-width:380px;margin:auto;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:32px 24px 24px;box-shadow:0 10px 40px rgba(0,0,0,.08)}
  .logo{position:relative;width:64px;height:64px;margin:0 auto 4px;display:grid;place-items:center}
  .logo svg{width:56px;height:56px;position:relative}
  .logo .ring{position:absolute;inset:0;border-radius:18px;border:2px solid var(--me);opacity:.35}
  h1{font-size:1.35rem;margin:12px 0 4px}
  p{color:var(--mut);margin:0 0 20px}
  .slot{position:relative;min-height:65px;display:flex;justify-content:center}
  #ts{display:flex;justify-content:center;width:100%;min-height:65px}
  .skel{position:absolute;inset:0;margin:0 auto;width:300px;max-width:100%;height:65px;border-radius:8px;border:1px solid var(--line);background:linear-gradient(90deg,var(--line) 0%,transparent 50%,var(--line) 100%) 0 0/200% 100%;opacity:.7;pointer-events:none}
  .slot.ready .skel,body.done .slot{display:none}
  #status{display:flex;align-items:center;justify-content:center;gap:10px;min-height:28px;margin-top:14px;color:var(--mut);font-size:.9rem}
  #status[hidden]{display:none}
  .ic{flex:none;width:18px;height:18px;border-radius:50%;position:relative}
  .ic.spin{border:2px solid var(--line);border-top-color:var(--me)}
  .ic.ok{background:var(--ok)} .ic.ok::after{content:"";position:absolute;left:5px;top:2px;width:5px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
  .ic.error{background:var(--bad);color:#fff;font-weight:700;font-size:12px;line-height:18px} .ic.error::after{content:"!"}
  body.done #status{color:var(--ok);font-weight:600}
  #retry{margin-top:12px;font:inherit;font-weight:600;padding:10px 18px;min-height:44px;border-radius:10px;border:0;background:var(--me);color:var(--onme);cursor:pointer}
  #retry:focus-visible,a:focus-visible{outline:3px solid var(--me);outline-offset:2px}
  #retry[hidden]{display:none}
  a{color:var(--mut)} .foot{margin:24px 0 0;font-size:.85rem}
  .top{position:fixed;top:12px;right:12px}
  noscript p,.late{color:var(--bad)}
  .late{visibility:hidden;margin:14px 0 0;font-size:.9rem;animation:late 0s 12s forwards} @keyframes late{to{visibility:visible}}
  .js .late,.slot.ready~.late,body.done .late{display:none}
  @media(prefers-reduced-motion:no-preference){
    .skel{animation:shimmer 1.4s linear infinite} @keyframes shimmer{to{background-position:-200% 0}}
    .ic.spin{animation:spin .8s linear infinite} @keyframes spin{to{transform:rotate(360deg)}}
    .logo .ring{animation:ring 2.4s ease-out infinite} @keyframes ring{0%{transform:scale(.9);opacity:.5}100%{transform:scale(1.35);opacity:0}}
    body.done .logo .ring{animation:none;opacity:0}
    main{animation:rise .35s ease-out} @keyframes rise{from{opacity:0;transform:translateY(8px)}}
  }
</style>
<script src="/challenge.js"></script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=tsReady" async defer></script></head>
<body><div class="top" data-dnsck-controls></div><main>
<div class="logo"><span class="ring" aria-hidden="true"></span><svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#0ea5a4"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#lg)"/><g fill="none" stroke="#fff" stroke-opacity=".3"><circle cx="16" cy="16.5" r="12"/><circle cx="16" cy="16.5" r="8.5"/></g><path d="M16 5.5 7.5 8.6v6.6c0 5.2 3.5 8.7 8.5 10.9 5-2.2 8.5-5.7 8.5-10.9V8.6z" fill="#fff"/><path d="m11.9 15.8 3 3 5.4-5.9" fill="none" stroke="#0e8fa6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
<h1>DNS Check</h1><p data-i18n="human">Quick check that you're human, then the test runs.</p>
<div class="slot" id="slot"><div class="skel" aria-hidden="true"></div><div id="ts" data-sitekey="${sitekey}"></div></div>
<div id="status" role="status" aria-live="polite"></div>
<button type="button" id="retry" hidden data-i18n="ch_retry">Try again</button>
<p class="late" data-i18n="ch_slow">Taking longer than usual. If you use a content blocker, allow challenges.cloudflare.com, then try again.</p>
<noscript><style>.skel,.late{display:none}</style><p data-i18n="ch_nojs">JavaScript is required for the human check.</p></noscript>
</main>
<footer data-dnsck-footer="compact"></footer>
<script src="/ui.js"></script><script src="/cookie-notice.js"></script></body></html>`, { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } });

async function handle(request, env) {
  const { pathname } = new URL(request.url);
  // the cookie key is its own secret, not the Turnstile secret; without it nothing is served (fail closed)
  if (!env.COOKIE_SECRET || !env.TURNSTILE_SECRET) return new Response('Service misconfigured', { status: 500 });

  if (pathname === '/verify') {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (env.VERIFY_LIMITER && !(await env.VERIFY_LIMITER.limit({ key: ip || 'unknown' })).success) return new Response('Too many attempts', { status: 429, headers: { 'Retry-After': '60' } });
    const body = await readJson(request, MAX_BODY);
    if (!body) return new Response('Bad request', { status: 400 });
    const { token } = body;
    if (typeof token !== 'string' || !token || token.length > MAX_TOKEN) return new Response('Bad request', { status: 400 });
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    const out = await res.json().catch(() => ({}));
    if (!out.success) return new Response('Verification failed', { status: 403 });
    const exp = String(Math.floor(Date.now() / 1000) + TTL);
    return new Response(null, { status: 204, headers: { 'Set-Cookie': `dnsck=${exp}.${await sign(env.COOKIE_SECRET, exp)}; Max-Age=${TTL}; Path=/; HttpOnly; Secure; SameSite=Lax` } });
  }

  const pass = PUBLIC.has(pathname) || await hasPass(request, env.COOKIE_SECRET);

  if (pathname.startsWith('/api/')) { // network tools: only for visitors who passed the challenge
    if (!pass) return json({ error: 'unauthorised' }, 401);
    if (pathname === '/api/ports') return ports(request, env);
    if (request.method !== 'GET') return json({ error: 'method' }, 405);
    if (pathname === '/api/me') return me(request);
    if (pathname === '/api/ping') return ping();
    return json({ error: 'not found' }, 404);
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  if (pass) return env.ASSETS.fetch(request);
  return challenge(env.TURNSTILE_SITEKEY);
}

export default { fetch: async (request, env) => secure(await handle(request, env)) };
