// Informational notice: the only cookie is strictly necessary, so this isn't a consent gate. Dismissal is remembered in localStorage.
(() => {
  const KEY = 'dnsck-notice';
  try { if (localStorage.getItem(KEY)) return; } catch {}
  const tr = (k, en) => (window.DNSCK ? DNSCK.t(k) : en);
  const css = document.createElement('style');
  css.textContent = `
    #cn{position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;max-width:640px;margin:0 auto;display:flex;gap:12px;align-items:center;flex-wrap:wrap;
      padding:14px 16px;border-radius:14px;font:14px/1.45 system-ui,-apple-system,"Hiragino Sans","PingFang SC","Noto Sans CJK SC",sans-serif;background:var(--card,#fff);color:var(--fg,#16181c);border:1px solid var(--line,#e4e7ec);box-shadow:0 8px 30px rgba(0,0,0,.18)}
    #cn p{margin:0;flex:1 1 260px} #cn a{color:var(--me,#2563eb)}
    #cn button{font:inherit;font-weight:600;padding:9px 16px;min-height:44px;border-radius:10px;border:0;background:var(--me,#2563eb);color:var(--onme,#fff);cursor:pointer}
    #cn button:focus-visible,#cn a:focus-visible{outline:3px solid var(--me,#2563eb);outline-offset:2px}`;
  const bar = document.createElement('div');
  bar.id = 'cn'; bar.setAttribute('role', 'region');
  const p = document.createElement('p'), a = document.createElement('a'), btn = document.createElement('button');
  a.href = '/privacy'; btn.type = 'button';
  p.append(document.createTextNode(''), a); bar.append(p, btn);
  const text = () => { // text nodes only, never HTML
    bar.setAttribute('aria-label', 'Cookie');
    p.firstChild.textContent = tr('cn_text', 'This site uses one essential cookie to remember you passed the human check for an hour. There are no tracking or advertising cookies.') + ' ';
    a.textContent = tr('privacy', 'Privacy and terms'); btn.textContent = tr('cn_ok', 'Got it');
  };
  const close = () => { try { localStorage.setItem(KEY, '1'); } catch {} bar.remove(); css.remove(); document.body.style.paddingBottom = ''; };
  btn.onclick = close;
  text();
  document.addEventListener('dnsck:lang', text);
  const show = () => { document.head.append(css); document.body.append(bar); document.body.style.paddingBottom = bar.offsetHeight + 24 + 'px'; };
  document.body ? show() : addEventListener('DOMContentLoaded', show);
})();
