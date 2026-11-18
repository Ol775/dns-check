// Network tools served by the Worker: what the edge sees about the visitor, and a TCP port check of the visitor's own IP.
import { connect } from 'cloudflare:sockets';

export const json = (o, status = 200, headers = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

// Reads at most `max` bytes of the body as JSON; null if it is too big or not JSON (also covers requests with no Content-Length).
export async function readJson(request, max) {
  if (Number(request.headers.get('Content-Length') || 0) > max) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  try { return JSON.parse(new TextDecoder().decode(await new Blob(chunks).arrayBuffer())); } catch { return null; }
}

// ---- who owns the network: a heuristic on the AS organisation name, so it can be wrong in both directions ----
const VPN = /nord ?vpn|express ?vpn|surfshark|mullvad|proton ?(vpn|ag)|windscribe|cyberghost|private internet access|ipvanish|tunnelbear|hide\.me|ivpn|vyprvpn|astrill|torguard|perfect privacy|airvpn|hotspot shield|zenmate|pure ?vpn|atlas vpn|\bvpn\b/i;
const HOSTING = /hosting|data ?cent(er|re)|cloud|server|vps|colo|digitalocean|linode|akamai|vultr|ovh|hetzner|leaseweb|choopa|m247|datacamp|cdn77|quadranet|tzulo|zenlayer|amazon|aws|google|microsoft|azure|oracle|alibaba|tencent|contabo|scaleway|kamatera|equinix|psychz|frantech|packet|\bhost/i;

// Tor publishes its exit list; fetched through Cloudflare's cache so we ask at most about once an hour per location.
async function isTor(ip) {
  try {
    const r = await fetch('https://check.torproject.org/torbulkexitlist', { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!r.ok) return null;
    return (await r.text()).split('\n').includes(ip);
  } catch { return null; }
}

// GET /api/me: what the edge sees. Everything returned is about the requester's own connection.
export async function me(request) {
  const cf = request.cf || {}, h = request.headers;
  const ip = h.get('CF-Connecting-IP') || '';
  const org = cf.asOrganization || '';
  const tor = ip ? await isTor(ip) : null;
  const vpn = VPN.exec(org)?.[0] || null;
  const kind = tor ? 'tor' : vpn ? 'vpn' : HOSTING.test(org) ? 'hosting' : 'isp';
  const xff = (h.get('X-Forwarded-For') || '').split(',').map(s => s.trim()).filter(Boolean);
  return json({
    ip, ipVersion: ip.includes(':') ? 6 : 4,
    country: cf.country || null, region: cf.region || null, city: cf.city || null, timezone: cf.timezone || null,
    asn: cf.asn || null, org, colo: cf.colo || null,
    httpProtocol: cf.httpProtocol || null, tlsVersion: cf.tlsVersion || null, tlsCipher: cf.tlsCipher || null,
    kind, vpn, tor,
    proxy: { via: h.get('Via'), forwarded: h.get('Forwarded'), xffCount: xff.length },
    time: Date.now(),
  });
}

// GET /api/ping: the smallest possible reply, for latency
export const ping = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

// ---- port check ----
const SERVICES = { 20: 'FTP data', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 110: 'POP3', 143: 'IMAP', 443: 'HTTPS', 445: 'SMB', 465: 'SMTPS', 587: 'SMTP submission', 993: 'IMAPS', 995: 'POP3S',
  1433: 'SQL Server', 1723: 'PPTP VPN', 3000: 'Dev server', 3306: 'MySQL', 3389: 'RDP', 5432: 'PostgreSQL', 5800: 'VNC (web)', 5900: 'VNC', 5938: 'TeamViewer', 6379: 'Redis', 7878: 'Radarr', 8000: 'HTTP alt', 8080: 'HTTP alt', 8096: 'Jellyfin', 8443: 'HTTPS alt', 8686: 'Lidarr', 8920: 'Jellyfin HTTPS', 8989: 'Sonarr', 9696: 'Prowlarr', 25565: 'Minecraft', 27017: 'MongoDB', 32400: 'Plex' };
const MAX_PORTS = 25, PROBE_MS = 3000, CONCURRENCY = 8;
const PRIVATE = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i;

async function probe(host, port) {
  let socket;
  try {
    socket = connect({ hostname: host, port });
    const opened = socket.opened.then(() => 'open');
    opened.catch(() => {}); // the race below may be over before this settles
    return await Promise.race([opened, new Promise(r => setTimeout(() => r('filtered'), PROBE_MS))]);
  } catch (e) {
    return /not allowed|prohibited|forbidden/i.test(String(e?.message)) ? 'blocked' : 'closed'; // a refused connection is just "closed"
  } finally {
    try { await socket?.close(); } catch {}
  }
}

// POST /api/ports {ports:[...]}: only ever the caller's own IP. The target is never taken from the request.
export async function ports(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (request.headers.get('Origin') !== url.origin) return json({ error: 'origin' }, 403); // same-origin pages only
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (env.PORT_LIMITER && !(await env.PORT_LIMITER.limit({ key: ip || 'unknown' })).success) return json({ error: 'rate' }, 429, { 'Retry-After': '60' });
  const body = await readJson(request, 1024);
  const list = body?.ports;
  if (!Array.isArray(list) || !list.length || list.length > MAX_PORTS || !list.every(p => Number.isInteger(p) && p >= 1 && p <= 65535)) return json({ error: 'ports' }, 400);
  if (!env.TEST_TARGET_IP && request.cf?.asn === 13335) return json({ error: 'cloudflare' }, 400); // visitors on Cloudflare WARP have a Cloudflare address, which Workers may not connect to
  const target = env.TEST_TARGET_IP || ip; // TEST_TARGET_IP exists only in a local .dev.vars, never in production
  if (!target || (!env.TEST_TARGET_IP && PRIVATE.test(target))) return json({ error: 'target' }, 400);

  const wanted = [...new Set(list)], results = [];
  for (let i = 0; i < wanted.length; i += CONCURRENCY) {
    results.push(...await Promise.all(wanted.slice(i, i + CONCURRENCY).map(async port => ({ port, service: SERVICES[port] || null, state: await probe(target, port) }))));
  }
  return json({ ip: env.TEST_TARGET_IP ? 'test target' : ip, results });
}
