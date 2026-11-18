// Informational notice: the only cookie is strictly necessary, so this isn't a consent gate. Dismissal is remembered in localStorage.
(() => {
  const KEY = 'dnsck-notice';
  try { if (localStorage.getItem(KEY)) return; } catch {}
  const css = document.createElement('style');
  css.textContent = `
    #cn{position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;max-width:640px;margin:0 auto;display:flex;gap:12px;align-items:center;flex-wrap:wrap;
      padding:14px 16px;border-radius:14px;font:14px/1.45 system-ui,-apple-system,sans-serif;background:#fff;color:#16181c;border:1px solid #e4e7ec;box-shadow:0 8px 30px rgba(0,0,0,.18)}
    #cn p{margin:0;flex:1 1 260px} #cn a{color:#2563eb}
    #cn button{font:inherit;font-weight:600;padding:9px 16px;min-height:44px;border-radius:10px;border:0;background:#2563eb;color:#fff;cursor:pointer}
    #cn button:focus-visible,#cn a:focus-visible{outline:3px solid #2563eb;outline-offset:2px}
    @media(prefers-color-scheme:dark){#cn{background:#17191d;color:#ececf0;border-color:#2a2d33}#cn a{color:#6ea0ff}#cn button{background:#6ea0ff;color:#0e0f12}}`;
  const bar = document.createElement('div');
  bar.id = 'cn'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Cookie notice');
  bar.innerHTML = '<p>This site uses one essential cookie to remember you passed the human check for an hour. There are no tracking or advertising cookies. <a href="/privacy">Privacy and terms</a></p><button type="button">Got it</button>';
  bar.querySelector('button').onclick = () => { try { localStorage.setItem(KEY, '1'); } catch {} bar.remove(); css.remove(); document.body.style.paddingBottom = ''; };
  const show = () => { document.head.append(css); document.body.append(bar); document.body.style.paddingBottom = bar.offsetHeight + 24 + 'px'; };
  document.body ? show() : addEventListener('DOMContentLoaded', show);
})();
