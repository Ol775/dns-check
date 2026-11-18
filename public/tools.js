// Network tools: tabs, the connection / VPN / proxy check, the port check and the DNS lookup.
// Everything shown from a third party or a request is escaped; nothing is inserted as HTML.
(() => {
  'use strict';
  const T = (k, v) => DNSCK.t(k, v);
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const row = (k, v) => `<dt>${esc(k)}</dt><dd>${esc(v ?? T('ip_none'))}</dd>`;
  const sig = (c, title, msg) => `<li><span class="dot" style="background:var(--${c})"></span><span class="org">${esc(title)}</span><span class="meta">${esc(msg)}</span></li>`;

  // ---------- tabs ----------
  const TABS = ['dns', 'conn', 'ports', 'lookup'];
  const tabBtns = [...document.querySelectorAll('[role="tab"]')];
  let connRan = false;
  function show(id, focus) {
    if (!TABS.includes(id)) id = 'dns';
    tabBtns.forEach(b => { const on = b.dataset.tab === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    TABS.forEach(t => { $('tab-' + t).hidden = t !== id; });
    $('rerun').hidden = id !== 'dns'; // "Run again" belongs to the DNS leak test
    try { history.replaceState(null, '', id === 'dns' ? location.pathname + location.search : '#' + id); } catch {}
    if (id === 'conn' && !connRan) { connRan = true; runConn(); }
  }
  tabBtns.forEach(b => { b.onclick = () => show(b.dataset.tab); });
  $('tabs').addEventListener('keydown', e => {
    const i = TABS.indexOf(document.activeElement?.dataset?.tab);
    if (i < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    show(TABS[e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length], true);
  });

  // ---------- connection, VPN and proxy ----------
  let conn = null;
  const ipify = async url => { try { return (await (await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) })).json()).ip || null; } catch { return null; } };

  async function latency() { // sequential pings to the edge; the first one pays for the connection, so it is dropped
    const t = [];
    for (let i = 0; i < 6; i++) { const a = performance.now(); try { await fetch('/api/ping?' + i, { cache: 'no-store' }); } catch { break; } t.push(performance.now() - a); }
    t.shift();
    if (!t.length) return null;
    return { min: Math.min(...t), avg: t.reduce((a, b) => a + b) / t.length, jitter: t.slice(1).reduce((s, v, i) => s + Math.abs(v - t[i]), 0) / Math.max(1, t.length - 1) };
  }

  // WebRTC asks a STUN server for the address it is reachable on; a VPN that doesn't cover WebRTC lets the real one through.
  function webrtcIps(ms = 3500) {
    return new Promise(resolve => {
      const ips = new Set(); let pc, done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); try { pc.close(); } catch {} resolve([...ips]); };
      try { pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }); } catch { return resolve(null); }
      const timer = setTimeout(finish, ms);
      pc.createDataChannel('x');
      pc.onicecandidate = e => {
        if (!e.candidate) return finish();
        const m = /candidate:\S+ \d+ \w+ \d+ (\S+) \d+ typ (\w+)/.exec(e.candidate.candidate);
        if (m && m[2] === 'srflx') ips.add(m[1]);
      };
      pc.createOffer().then(o => pc.setLocalDescription(o)).catch(finish);
    });
  }

  const clockAt = tz => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()); } catch { return null; } };

  async function runConn() {
    conn = null; $('chero').className = 'hero run'; $('chero').innerHTML = `<div class="icon" aria-hidden="true">…</div><div><div class="t">${esc(T('conn_wait'))}</div></div>`;
    ['cip', 'cq', 'csig'].forEach(id => { $(id).innerHTML = ''; });
    const t0 = Date.now();
    const [meRes, v4, v64, rtc] = await Promise.all([
      fetch('/api/me', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null),
      ipify('https://api.ipify.org?format=json'), ipify('https://api64.ipify.org?format=json'), webrtcIps(),
    ]);
    const t1 = Date.now();
    const lat = await latency();
    conn = { me: meRes, v4, v6: v64 && v64.includes(':') ? v64 : null, rtc, lat, offset: meRes ? meRes.time - (t0 + t1) / 2 : null };
    renderConn();
  }

  function renderConn() {
    if (!conn) return;
    const { me, v4, v6, rtc, lat, offset } = conn;
    if (!me) { $('chero').className = 'hero bad'; $('chero').innerHTML = `<div class="icon" aria-hidden="true">!</div><div><div class="t">${esc(T('ports_err'))}</div></div>`; return; }
    const seen = new Set([me.ip, v4, v6].filter(Boolean));
    const leak = (rtc || []).filter(ip => !seen.has(ip));
    const proxyHdr = [me.proxy.via && 'Via', me.proxy.forwarded && 'Forwarded', me.proxy.xffCount > 1 && 'X-Forwarded-For'].filter(Boolean);
    const sameTz = me.timezone && Intl.DateTimeFormat().resolvedOptions().timeZone ? clockAt(me.timezone) === clockAt(Intl.DateTimeFormat().resolvedOptions().timeZone) : null;

    // verdict, most serious first
    const [cls, icon, title, sub] =
      me.kind === 'tor' ? ['bad', '✗', T('v_tor'), T('v_tor_sub')] :
      leak.length ? ['bad', '✗', T('v_leak'), T('v_leak_sub')] :
      me.kind === 'vpn' || me.kind === 'hosting' ? ['warn', '?', T('v_vpn'), T('v_vpn_sub')] :
      proxyHdr.length ? ['warn', '?', T('v_hdr'), T('v_hdr_sub')] :
      ['ok', '✓', T('v_clean'), T('v_clean_sub')];
    $('chero').className = `hero ${cls}`;
    $('chero').innerHTML = `<div class="icon" aria-hidden="true">${icon}</div><div><div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div></div>`;

    $('cip').innerHTML = row(T('k_ip4'), v4 || (me.ipVersion === 4 ? me.ip : null)) + row(T('k_ip6'), v6) +
      row(T('k_isp'), me.org ? `${me.org} (AS${me.asn})` : null) +
      row(T('k_loc'), [me.city, me.region, me.country].filter(Boolean).join(', ') || null) + row(T('k_tz'), me.timezone) +
      row(T('k_edge'), me.colo) + row(T('k_proto'), [me.httpProtocol, me.tlsVersion].filter(Boolean).join(' · ') || null);
    const ms = n => `${n.toFixed(n < 10 ? 1 : 0)} ms`;
    $('cq').innerHTML = row(T('k_lat'), lat ? `${ms(lat.min)} – ${ms(lat.avg)}` : null) + row(T('k_jit'), lat ? ms(lat.jitter) : null) +
      row(T('k_clock'), offset == null ? null : Math.abs(offset) < 1000 ? `${offset >= 0 ? '+' : '−'}${Math.abs(Math.round(offset))} ms` : `${offset >= 0 ? '+' : '−'}${(Math.abs(offset) / 1000).toFixed(1)} s`);

    const items = [];
    items.push(me.kind === 'isp' ? sig('ok', T('s_net'), T('sg_net_isp', { org: me.org })) :
      me.kind === 'tor' ? sig('bad', T('s_net'), T('sg_net_tor')) :
      me.kind === 'vpn' ? sig('warn', T('s_net'), T('sg_net_vpn', { org: me.org })) : sig('warn', T('s_net'), T('sg_net_host', { org: me.org })));
    items.push(me.tor === true ? sig('bad', T('s_tor'), T('sg_net_tor')) : me.tor === false ? sig('ok', T('s_tor'), T('sg_tor_no')) : sig('mut', T('s_tor'), T('sg_tor_unk')));
    items.push(proxyHdr.length ? sig('warn', T('s_hdr'), T('sg_hdr_yes', { h: proxyHdr.join(', ') })) : sig('ok', T('s_hdr'), T('sg_hdr_no')));
    items.push(rtc == null ? sig('ok', T('s_rtc'), T('sg_rtc_off')) : !rtc.length ? sig('ok', T('s_rtc'), T('sg_rtc_none')) :
      leak.length ? sig('bad', T('s_rtc'), T('sg_rtc_leak', { ip: leak.join(', '), seen: [...seen].join(', ') })) : sig('ok', T('s_rtc'), T('sg_rtc_ok', { ip: rtc.join(', ') })));
    items.push(sameTz == null ? sig('mut', T('s_tz'), '–') : sameTz ? sig('ok', T('s_tz'), T('sg_tz_ok', { tz: me.timezone })) :
      sig('warn', T('s_tz'), T('sg_tz_bad', { b: Intl.DateTimeFormat().resolvedOptions().timeZone, i: me.timezone })));
    items.push(!v4 || me.ipVersion !== 4 ? sig('mut', T('s_addr'), T('sg_addr_unk')) : v4 === me.ip ? sig('ok', T('s_addr'), T('sg_addr_ok')) : sig('warn', T('s_addr'), T('sg_addr_bad', { a: me.ip, b: v4 })));
    $('csig').innerHTML = items.join('');
  }

  // ---------- port check ----------
  const PRESETS = { common: [21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 587, 993, 995, 3306, 3389, 5432, 5900, 8080, 8443], web: [80, 443, 8000, 8080, 8443, 3000], remote: [22, 23, 3389, 5900, 5938], mail: [25, 110, 143, 465, 587, 993, 995], media: [8096, 8920, 32400, 7878, 8989, 8686, 9696] };
  let preset = 'common', portsData = null;
  const pchips = [...document.querySelectorAll('#pchips [data-p]')];
  const markPreset = () => pchips.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === preset)));
  markPreset();
  $('pchips').onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; preset = b.dataset.p; $('pcustom').value = ''; markPreset(); };

  function chosenPorts() { // custom field wins when filled: "22, 8080, 3000-3005"
    const raw = $('pcustom').value.trim();
    if (!raw) return PRESETS[preset];
    const out = new Set();
    for (const part of raw.split(/[\s,;]+/).filter(Boolean)) {
      const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(part);
      if (!m) return null;
      const a = +m[1], b = m[2] ? +m[2] : a;
      if (a < 1 || b > 65535 || b < a || b - a > 24) return null;
      for (let p = a; p <= b; p++) out.add(p);
    }
    return out.size && out.size <= 25 ? [...out] : null;
  }
  function renderPorts() {
    if (!portsData) return;
    const rs = portsData.results.slice().sort((a, b) => a.port - b.port), n = s => rs.filter(r => r.state === s).length;
    $('pout').innerHTML = `<p class="mut">${esc(portsData.ip)} · ${esc(T('ports_sum', { open: n('open'), closed: n('closed'), filtered: n('filtered') + n('blocked') }))}</p>` +
      `<div class="tblwrap"><table class="tbl"><thead><tr><th>${esc(T('th_port'))}</th><th>${esc(T('th_service'))}</th><th>${esc(T('th_state'))}</th></tr></thead><tbody>` +
      rs.map(r => `<tr><td>${esc(r.port)}</td><td>${esc(r.service || '–')}</td><td class="st-${esc(r.state)}">${esc(T('st_' + r.state))}</td></tr>`).join('') + '</tbody></table></div>';
  }
  async function runPorts() {
    const ports = chosenPorts();
    if (!ports) { $('pout').innerHTML = `<p class="err" role="alert">${esc(T('ports_bad'))}</p>`; return; }
    $('prun').disabled = true; $('pout').innerHTML = `<p class="mut">${esc(T('ports_wait'))}</p>`; portsData = null;
    try {
      const r = await fetch('/api/ports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ports }) });
      if (r.status === 429) { $('pout').innerHTML = `<p class="err" role="alert">${esc(T('ports_limit'))}</p>`; return; }
      if (!r.ok) throw new Error(r.status);
      portsData = await r.json(); renderPorts();
    } catch { $('pout').innerHTML = `<p class="err" role="alert">${esc(T('ports_err'))}</p>`; }
    finally { $('prun').disabled = false; }
  }
  $('prun').onclick = runPorts;
  $('pcustom').addEventListener('keydown', e => { if (e.key === 'Enter') runPorts(); });

  // ---------- DNS lookup (DNS over HTTPS to Cloudflare) ----------
  const RTYPES = { 1: 'A', 2: 'NS', 5: 'CNAME', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA' };
  let lkType = 'A', lkData = null;
  const lkChips = [...document.querySelectorAll('#lktypes [data-t]')];
  const markType = () => lkChips.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === lkType)));
  markType();

  function expandV6(ip) {
    if (!/^[0-9a-f:]+$/i.test(ip) || ip.split('::').length > 2) return null;
    const [a, b] = ip.split('::'), A = a ? a.split(':') : [], B = b ? b.split(':') : [];
    const g = ip.includes('::') ? [...A, ...Array(8 - A.length - B.length).fill('0'), ...B] : A;
    return g.length === 8 && g.every(x => x.length >= 1 && x.length <= 4) ? g.map(x => x.padStart(4, '0')) : null;
  }
  function parseQuery(input) { // -> { name, type } or null
    const s = input.trim().toLowerCase().replace(/\.$/, '');
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every(o => +o <= 255)) return { name: s.split('.').reverse().join('.') + '.in-addr.arpa', type: 'PTR' };
    if (s.includes(':')) { const g = expandV6(s); return g ? { name: g.join('').split('').reverse().join('.') + '.ip6.arpa', type: 'PTR' } : null; }
    if (!s || /[\s/@?#]/.test(s)) return null;
    let host; try { host = new URL('http://' + s).hostname; } catch { return null; } // converts internationalised names to punycode
    return /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9-]{2,63}$/.test(host) ? { name: host, type: lkType } : null;
  }
  function renderLookup() {
    if (!lkData) return;
    const { status, answers, name } = lkData;
    if (!answers.length) { $('lkout').innerHTML = `<p class="mut">${esc(name)}: ${esc(status === 3 ? 'NXDOMAIN' : T('lk_none'))}</p>`; return; }
    $('lkout').innerHTML = `<p class="mut">${esc(name)}</p><div class="tblwrap"><table class="tbl"><thead><tr><th>${esc(T('th_type'))}</th><th>${esc(T('th_ttl'))}</th><th>${esc(T('th_value'))}</th></tr></thead><tbody>` +
      answers.map(a => `<tr><td>${esc(RTYPES[a.type] || a.type)}</td><td>${esc(a.TTL)}</td><td>${esc(a.data)}</td></tr>`).join('') + '</tbody></table></div>';
  }
  async function runLookup(e) {
    e?.preventDefault();
    const q = parseQuery($('lkin').value);
    if (!q) { $('lkout').innerHTML = `<p class="err" role="alert">${esc(T('lk_bad'))}</p>`; return; }
    $('lkout').innerHTML = `<p class="mut">${esc(T('lk_wait'))}</p>`; lkData = null;
    try {
      const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(q.name)}&type=${q.type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      lkData = { status: j.Status, answers: Array.isArray(j.Answer) ? j.Answer : [], name: `${q.name} ${q.type}` }; renderLookup();
    } catch { $('lkout').innerHTML = `<p class="err" role="alert">${esc(T('lk_err'))}</p>`; }
  }
  $('lkform').onsubmit = runLookup;
  $('lktypes').onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; lkType = b.dataset.t; markType(); if ($('lkin').value.trim()) runLookup(); };

  document.addEventListener('dnsck:lang', () => { renderConn(); renderPorts(); renderLookup(); });
  show(location.hash.slice(1));
})();
