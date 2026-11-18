const N = 10;
const T = (k, v) => DNSCK.t(k, v), TP = (b, n, v) => DNSCK.tp(b, n, v);
// resolver provider by the organisation/ASN bash.ws reports for the resolver's IP; add or tweak patterns for your own setup
const PROVIDERS = [
  { id: 'controld',   name: 'Control D',            re: /control ?d|datacamp|windscribe|cdn77/i },
  { id: 'cloudflare', name: 'Cloudflare (1.1.1.1)', re: /cloudflare/i },
  { id: 'nextdns',    name: 'NextDNS',              re: /nextdns/i },
  { id: 'google',     name: 'Google Public DNS',    re: /google/i },
  { id: 'quad9',      name: 'Quad9',                re: /quad9|woodynet|packet clearing/i },
  { id: 'opendns',    name: 'OpenDNS (Cisco)',      re: /opendns|cisco/i },
  { id: 'adguard',    name: 'AdGuard DNS',          re: /adguard/i },
];
const providerOf = x => PROVIDERS.find(p => p.re.test(`${x.org} ${x.asn}`))?.id || 'other';
const nameOf = id => PROVIDERS.find(p => p.id === id)?.name || T('unrec');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const $ = id => document.getElementById(id);

let expected = 'auto';
try { expected = localStorage.getItem('dnsck-expect') || 'auto'; } catch {}
const chips = [...document.querySelectorAll('#expect [data-v]')];
if (!chips.some(b => b.dataset.v === expected)) expected = 'auto';
const markExpected = () => chips.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === expected)));
markExpected();

// ---- map ----
let map, layer;
function initMap() {
  if (typeof L === 'undefined') { $('map').textContent = T('map_na'); return; }
  map = L.map('map', { worldCopyJump: true }).setView([30, 10], 2);
  layer = L.layerGroup().addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: '© OpenStreetMap contributors' }).addTo(map);
  new ResizeObserver(() => map.invalidateSize()).observe($('map')); // the card's height settles after first paint; without this tiles stop short
}
const pin = (p, colour, label) => L.marker(p, { title: label, icon: L.divIcon({ className: '', iconSize: [16, 16], html: `<div class="pin" style="background:${colour}"></div>` }) }).bindPopup(Object.assign(document.createElement('span'), { textContent: label })).addTo(layer); // label comes from third-party APIs: text node, never HTML

async function geo(ips) { // [{latitude,longitude,city}] in input order; failures just get no marker
  try {
    const r = await (await fetch(`https://get.geojs.io/v1/ip/geo.json?ip=${ips.join(',')}`, { signal: AbortSignal.timeout(6000) })).json();
    return Array.isArray(r) ? r : [r];
  } catch { return []; }
}

// ---- hero: a function returning [class, icon, title, sub], re-run on language change ----
let heroFn = () => ['run', '…', T('checking_title'), T('checking_sub', { n: N })];
function paintHero() {
  const [cls, icon, title, sub] = heroFn();
  $('hero').className = `hero ${cls}`;
  $('hero').innerHTML = `<div class="icon" aria-hidden="true">${esc(icon)}</div><div><div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div></div>`;
}
const setHero = fn => { heroFn = fn; paintHero(); };

// ---- direct provider checks (separate from the leak test) ----
// can a request to this host connect? (no-cors: only success/failure is visible, which is all we need)
const reach = u => fetch(u, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(6000) }).then(() => true, () => false);
// help.one.one.one.one only resolves on Cloudflare's resolvers (1.1.1.1, and the 1.1.1.2 / 1.1.1.3 family servers share it).
// (NextDNS has test.nextdns.io, but it sends no CORS headers, so a browser can't read it: NextDNS is recognised by resolver name only.)
// filtering: doubleclick.net is on every ad/tracker list; example.com is the control that proves we're online
// (DNSSEC isn't tested here: no public test host has a valid HTTPS cert, so a browser can't tell refusal from cert failure)
let chk = null; // results of the direct checks; null while running
async function otherChecks() {
  chk = null; renderChecks();
  const [cf, ad, ctl] = await Promise.all([reach('https://help.one.one.one.one'), reach('https://doubleclick.net'), reach('https://example.com')]);
  chk = { cf, ad, ctl }; renderChecks();
}
function renderChecks() {
  if (!chk) { $('checks').innerHTML = `<li><span></span><span>${esc(T('chk_wait'))}</span></li>`; return; }
  const { cf, ad, ctl } = chk;
  const items = [
    cf ? ['ok', 'Cloudflare DNS', T('cf_ok')] : ['mut', 'Cloudflare DNS', T('nd')],
    !ctl ? ['warn', T('ad_t'), T('ad_off')] : ad ? ['warn', T('ad_t'), T('ad_no')] : ['ok', T('ad_t'), T('ad_yes')],
  ];
  $('checks').innerHTML = items.map(([c, title, msg]) => `<li><span class="dot" style="background:var(--${c})"></span><span class="org">${esc(title)}</span><span class="meta">${esc(msg)}</span></li>`).join('');
}

// ---- verdict and drawing; re-run on every change of "Expecting", theme or language without new lookups ----
let last = null; // { id, me, dns: [{...bash.ws, pid}], pts, when }

function verdict(dns) {
  const ids = [...new Set(dns.map(x => x.pid))];
  const counts = Object.fromEntries(ids.map(i => [i, dns.filter(x => x.pid === i).length]));
  const expId = expected !== 'auto' ? expected : ids.sort((a, b) => counts[b] - counts[a])[0];
  const matches = x => x.pid === expId;
  const bad = dns.filter(x => !matches(x));
  const nameFor = x => x.pid === 'other' ? x.org : nameOf(x.pid);
  const names = [...new Set(dns.map(nameFor))].join(', ');
  let fn;
  if (!dns.length) fn = () => ['warn', '?', T('none_title'), T('none_sub')];
  else if (expected === 'auto' && ids.length === 1 && expId === 'other') fn = () => ['warn', '?', T('unrec_title'), T('unrec_sub', { names })];
  else if (!bad.length) fn = () => ['ok', '✓', T('ok_title', { p: nameOf(expId) }), TP('ok_sub', dns.length, { p: nameOf(expId) })];
  else if (bad.length === dns.length) fn = () => ['bad', '✗', T('not_title', { p: nameOf(expId) }), T('not_sub', { names })];
  else fn = () => ['bad', '✗', T('leak_title'), TP('leak_sub', bad.length, { p: nameOf(expId), names: [...new Set(bad.map(nameFor))].join(', ') })];
  return { expId, matches, fn };
}

function render() {
  if (!last) return;
  const { id, me, dns, pts } = last;
  const v = verdict(dns);
  setHero(v.fn);
  const label = x => x.pid === 'other' ? T('unrec') : nameOf(x.pid);
  const colour = x => v.matches(x) ? 'ok' : 'bad';

  $('you').innerHTML = `<dt>${esc(T('ip'))}</dt><dd>${esc(me?.ip)}</dd><dt>${esc(T('net'))}</dt><dd>${esc(me?.org)}</dd><dt>${esc(T('country'))}</dt><dd>${esc(me?.country_name)}</dd>`;
  $('resolvers').innerHTML = dns.map(x =>
    `<li><span class="dot" style="background:var(--${colour(x)})"></span>
      <span class="org">${esc(x.org)}<span class="tag ${colour(x)}">${esc(label(x))}</span></span>
      <span class="meta">${esc(x.ip)} · ${esc(x.country_name)}</span></li>`).join('') || `<li><span></span><span>${esc(T('none'))}</span></li>`;
  $('logrows').innerHTML = dns.map(x =>
    `<tr><td>${esc(x.ip)}</td><td>${esc(x.org)} (${esc(x.asn.split(' ')[0])})</td><td>${esc(x.country_name)}</td><td style="color:var(--${colour(x)})">${esc(label(x))}${v.matches(x) ? '' : ' ' + esc(T('not_exp'))}</td></tr>`).join('') || `<tr><td colspan="4">${esc(T('log_none'))}</td></tr>`;
  // the raw log stays in English: it's a technical record, meant to be copied
  $('logtext').textContent = [
    `${last.when}  test id ${id}`,
    `sent ${N} lookups: 1.${id}.bash.ws … ${N}.${id}.bash.ws`,
    `your IP: ${me?.ip} (${me?.org})`,
    `expecting: ${expected === 'auto' ? `auto (${nameOf(v.expId)})` : nameOf(expected)}`,
    ...dns.map(x => `resolver: ${x.ip}  ${x.asn}  ${x.country_name}  -> ${x.pid === 'other' ? 'unrecognised' : nameOf(x.pid)}${v.matches(x) ? '' : '  (NOT expected)'}`),
  ].join('\n');

  if (map) {
    layer.clearLayers();
    const bounds = [];
    (pts || []).forEach((g, i) => {
      const p = [parseFloat(g.latitude), parseFloat(g.longitude)];
      if (isNaN(p[0]) || isNaN(p[1])) return;
      const isMe = me && i === 0;
      const d = isMe ? null : dns[i - 1];
      const place = g.city ? ' · ' + g.city : '';
      pin(p, isMe ? css('--me') : css(`--${colour(d)}`), isMe ? `${T('you')}${place}` : `${d.org}${place}`);
      bounds.push(p);
    });
    if (bounds.length) { map.invalidateSize(); map.fitBounds(bounds, { padding: [50, 50], maxZoom: 7 }); }
  }
}

let ranAt = null;
const paintStamp = () => { $('stamp').textContent = ranAt ? T('last_run', { time: ranAt.toLocaleTimeString(DNSCK.lang) }) : ''; };

async function run() {
  $('rerun').disabled = true;
  otherChecks();
  setHero(() => ['run', '…', T('checking_title'), T('checking_sub', { n: N })]);
  last = null; layer?.clearLayers();
  try {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join(''); // any random id works; bash.ws/id has no CORS
    // the lookups are the test; no-cors because we only need the DNS query to happen
    await Promise.all(Array.from({ length: N }, (_, i) =>
      fetch(`https://${i + 1}.${id}.bash.ws`, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(6000) }).catch(() => {})));
    await sleep(1500);
    const r = await (await fetch(`https://bash.ws/dnsleak/test/${id}?json`, { cache: 'no-store' })).json();
    const me = r.find(x => x.type === 'ip');
    const dns = r.filter(x => x.type === 'dns').map(x => ({ ...x, pid: providerOf(x) }));
    last = { id, me, dns, pts: null, when: new Date().toISOString() };
    render(); // show the verdict now; the map follows once locations arrive
    if (map) { last.pts = await geo([me?.ip, ...dns.map(x => x.ip)].filter(Boolean)); render(); }
  } catch (e) {
    setHero(() => ['bad', '!', T('fail_title'), e.message]);
  }
  ranAt = new Date(); paintStamp();
  $('rerun').disabled = false;
}

$('expect').onclick = e => {
  const b = e.target.closest('[data-v]'); if (!b) return;
  expected = b.dataset.v; try { localStorage.setItem('dnsck-expect', expected); } catch {}
  markExpected(); render();
};
document.addEventListener('dnsck:lang', () => { paintHero(); renderChecks(); paintStamp(); render(); });
document.addEventListener('dnsck:theme', () => render()); // pin colours come from the theme
$('rerun').onclick = run;
initMap();
run();
