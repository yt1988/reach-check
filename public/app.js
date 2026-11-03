// Reach Check: can other people reach this service, and if not, where does it stop?
// Outside view: Globalping probes (one HTTP measurement from every region, called straight from the browser, so each
// visitor spends their own hourly allowance). Inside view: this browser, by timing two HTTPS requests. DNS: public DoH
// resolvers that answer browsers (CORS).

const GP = "https://api.globalping.io/v1";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// One probe per region: mainland China by carrier (eyeball networks), then each continent's main hubs.
// `loc` is a Globalping location filter; the probe's own city shows under the name.
const REGIONS = [
  { g: "中国大陆", name: "中国电信", loc: { country: "CN", asn: 4134 }, cn: true },
  { g: "中国大陆", name: "中国联通", loc: { country: "CN", asn: 4837 }, cn: true },
  { g: "中国大陆", name: "中国移动", loc: { country: "CN", asn: 9808 }, cn: true },
  { g: "亚太", name: "香港", loc: { country: "HK" } },
  { g: "亚太", name: "台湾", loc: { country: "TW" } },
  { g: "亚太", name: "日本 · 东京", loc: { city: "Tokyo" } },
  { g: "亚太", name: "韩国", loc: { country: "KR" } },
  { g: "亚太", name: "新加坡", loc: { country: "SG" } },
  { g: "亚太", name: "印度", loc: { country: "IN" } },
  { g: "亚太", name: "澳大利亚", loc: { country: "AU" } },
  { g: "欧洲 · 中东 · 非洲", name: "英国 · 伦敦", loc: { city: "London" } },
  { g: "欧洲 · 中东 · 非洲", name: "德国 · 法兰克福", loc: { city: "Frankfurt" } },
  { g: "欧洲 · 中东 · 非洲", name: "俄罗斯", loc: { country: "RU" } },
  { g: "欧洲 · 中东 · 非洲", name: "阿联酋", loc: { country: "AE" } },
  { g: "欧洲 · 中东 · 非洲", name: "南非", loc: { country: "ZA" } },
  { g: "美洲", name: "美国西部 · 洛杉矶", loc: { city: "Los Angeles" } },
  { g: "美洲", name: "美国东部 · 纽约", loc: { city: "New York" } },
  { g: "美洲", name: "巴西 · 圣保罗", loc: { city: "Sao Paulo" } },
];

// Presets: the port, whether it should answer as a web page (and over TLS), what to expect otherwise
const PRESETS = [
  { label: "网站", port: 443, proto: "HTTPS", web: true },
  { label: "网站 HTTP", port: 80, proto: "HTTP", web: true },
  { label: "群晖 DSM", port: 5001, proto: "HTTPS", web: true },
  { label: "Jellyfin / Emby", port: 8096, proto: "HTTP", web: true },
  { label: "Plex", port: 32400, proto: "HTTP", web: true },
  { label: "Home Assistant", port: 8123, proto: "HTTP", web: true },
  { label: "SSH", port: 22, proto: "HTTP", web: false, what: "SSH" },
  { label: "远程桌面", port: 3389, proto: "HTTP", web: false, what: "远程桌面" },
  { label: "Minecraft", port: 25565, proto: "HTTP", web: false, what: "Minecraft 服务器" },
  { label: "UDP 游戏（帕鲁等）", udp: true },
];

// Ports a browser refuses to open (Fetch standard, "bad port"): the request never leaves the browser
const BAD_PORTS = new Set([0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104,
  109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548,
  554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667,
  6668, 6669, 6679, 6697, 10080]);

// Ports Cloudflare's proxy (orange cloud) forwards; anything else never reaches the origin
const CF_HTTP = [80, 8080, 8880, 2052, 2082, 2086, 2095], CF_HTTPS = [443, 2053, 2083, 2087, 2096, 8443];
const CF_V4 = ["173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14",
  "172.64.0.0/13", "131.0.72.0/22"];

const ISP_BLOCKED = [80, 443, 8080, 8443];     // ports Chinese home broadband commonly blocks inbound
const LOCAL_TIMEOUT = 10000;

// ---------- address helpers ----------

const ip4n = ip => ip.split(".").reduce((a, b) => a * 256 + +b, 0);
const isV4 = s => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
const isV6 = s => s.includes(":") && /^[0-9a-f:.]+$/i.test(s);
const inCidr = (ip, cidr) => { const [n, b] = cidr.split("/"); const m = 2 ** (32 - b); return Math.floor(ip4n(ip) / m) === Math.floor(ip4n(n) / m); };
function ipKind(ip) {
  if (isV4(ip)) {
    if (["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16"].some(c => inCidr(ip, c))) return "private";
    if (inCidr(ip, "100.64.0.0/10")) return "cgnat";
    if (inCidr(ip, "198.18.0.0/15")) return "fakeip";       // Clash / sing-box fake-ip range
    if (CF_V4.some(c => inCidr(ip, c))) return "cf";
    return "public";
  }
  if (isV6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::1" || l.startsWith("fe80") || l.startsWith("fc") || l.startsWith("fd")) return "private";
    if (/^(2400:cb00|2606:4700|2803:f800|2405:b500|2405:8100|2a06:98c0|2a06:98c1|2c0f:f248):/.test(l)) return "cf";
    return "public";
  }
  return "";
}

// "nas.example.com", "nas.example.com:5001", "https://x.com/path", "[2001:db8::1]:8443", "1.2.3.4"
function parseTarget(raw, portField) {
  let s = raw.trim(), scheme = "", path = "/", host = "", port = 0;
  const m = s.match(/^([a-z]+):\/\//i);
  if (m) {
    scheme = m[1].toLowerCase();
    try { const u = new URL(s); host = u.hostname.replace(/^\[|\]$/g, ""); port = +u.port || (scheme === "https" ? 443 : 80); path = u.pathname + u.search; }
    catch { return null; }
  } else {
    s = s.replace(/\/.*$/, (p) => { path = p; return ""; });
    const b = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (b) { host = b[1]; port = +b[2] || 0; }
    else if (isV6(s)) host = s;
    else { const [h, p] = s.split(":"); host = h; port = +p || 0; }
  }
  if (+portField) port = +portField;
  host = host.toLowerCase();
  if (!host || !(isV4(host) || isV6(host) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\.?$/i.test(host))) return null;
  return { host, port, path: path || "/", scheme, isIp: isV4(host) || isV6(host) };
}

// ---------- page state ----------

let preset = PRESETS[0], run = 0, myIp = {}, state;

function renderPresets() {
  $("presets").innerHTML = PRESETS.map((p, i) => `<button type="button" class="chip" data-i="${i}" aria-pressed="${p === preset}">${esc(p.label)}${p.port ? `<small>${p.port}</small>` : ""}</button>`).join("");
}
$("presets").addEventListener("click", e => {
  const b = e.target.closest(".chip"); if (!b) return;
  const p = PRESETS[+b.dataset.i];
  if (p.udp) {
    $("myipNote").textContent = "UDP 端口（幻兽帕鲁、CS2、WireGuard 等）在浏览器和公共探针里都测不了：没有通用的方法判断 UDP 端口是否开着。可以先测主机能不能连上（选 SSH 或网站），再让朋友直接用游戏连。";
    return;
  }
  preset = p; $("port").value = p.port; renderPresets();
});

async function loadQuota() {
  try {
    const j = await (await fetch(GP + "/limits")).json();
    showQuota(j.rateLimit.measurements.create.remaining, j.rateLimit.measurements.create.reset);
  } catch { $("quota").textContent = ""; }
}
function showQuota(left, reset) {
  state && (state.quota = { left, reset });
  const cost = REGIONS.length;
  $("quota").textContent = left >= cost
    ? `本小时还能测 ${left} 个地区次，每次检测用 ${cost} 个`
    : `外部检测额度已用完，约 ${Math.ceil(reset / 60)} 分钟后恢复（每个 IP 每小时 250 个地区次）`;
  $("go").dataset.cool = left < cost ? "1" : "";
}

$("myip").addEventListener("click", async () => {
  $("myipNote").textContent = "查询中…";
  await fetchMyIp();
  const ip = myIp.v4 || myIp.any;
  if (ip) { $("target").value = ip; $("myipNote").textContent = `你现在的公网 IP：${[myIp.v4, myIp.any !== myIp.v4 && myIp.any].filter(Boolean).join("、")}。开着代理的话，这可能是代理的 IP。`; }
  else $("myipNote").textContent = "没查到你的公网 IP。";
});
async function fetchMyIp() {
  const get = async (u, f) => { try { const c = new AbortController(); setTimeout(() => c.abort(), 5000); return f(await fetch(u, { signal: c.signal })); } catch { return ""; } };
  const [v4, any] = await Promise.all([
    get("https://api.ipify.org?format=json", async r => (await r.json()).ip),
    get("https://api.ip.sb/ip", async r => (await r.text()).trim()),
  ]);
  myIp = { v4: isV4(v4) ? v4 : isV4(any) ? any : "", any: any || v4 };
}

// ---------- run ----------

$("f").addEventListener("submit", e => { e.preventDefault(); start(); });

function start() {
  const t = parseTarget($("target").value, $("port").value);
  if (!t) { $("myipNote").textContent = "地址看不懂：填域名、IP 或网址。"; return; }
  if (!t.port) t.port = preset.port || 443;
  const pr = PRESETS.find(p => p.port === t.port && !p.udp);
  const proto = t.scheme === "https" ? "HTTPS" : t.scheme === "http" ? "HTTP" : (pr || preset).port === t.port ? (pr || preset).proto : (t.port === 443 || t.port === 8443 || t.port === 5001 ? "HTTPS" : "HTTP");
  const web = t.scheme ? true : pr ? pr.web : true;
  const ipv = $("ipv").value;
  const id = ++run;
  state = { id, t, proto, web, what: pr?.what, home: !!pr && pr.label !== "网站" && pr.label !== "网站 HTTP", plainWeb: proto === "HTTP" && web && (!!pr || t.scheme === "http"), ipv, rows: REGIONS.map(() => null), gpDone: false, local: null, dns: null, quota: state?.quota };
  if (state.quota && state.quota.left < REGIONS.length) { showQuota(state.quota.left, state.quota.reset); }

  history.replaceState(null, "", `?t=${encodeURIComponent($("target").value.trim())}&p=${t.port}`);
  $("inviteUrl").value = `${location.origin}${location.pathname}?t=${encodeURIComponent($("target").value.trim())}&p=${t.port}&from=friend`;
  $("out").hidden = false;
  $("go").disabled = true;
  drawRegions(); drawVerdict();
  $("local").innerHTML = `<p class="m blink">正在从你的浏览器连接…</p>`;
  $("dns").innerHTML = t.isIp ? `<p class="m">直接填的是 IP，不需要解析。</p>${ipNote(t.host)}` : `<p class="m blink">查询中…</p>`;

  const jobs = [runGlobalping(state), runLocal(state)];
  if (!t.isIp) jobs.push(runDns(state));
  if (!myIp.any) jobs.push(fetchMyIp().then(() => state.id === id && state.dns && drawDns()));
  Promise.allSettled(jobs).then(() => { if (state.id === id) { $("go").disabled = false; drawVerdict(); loadQuota(); } });
}

// ---------- outside: Globalping ----------

async function runGlobalping(s) {
  const opts = { protocol: s.proto, port: s.t.port, request: { method: "HEAD", path: s.t.path.split("?")[0] || "/" } };
  if (s.t.path.includes("?")) opts.request.query = s.t.path.split("?")[1];
  if (!s.t.isIp) opts.ipVersion = +s.ipv;
  let r, j;
  try {
    r = await fetch(GP + "/measurements", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "http", target: s.t.host, inProgressUpdates: true, locations: REGIONS.map(x => ({ ...x.loc, limit: 1 })), measurementOptions: opts }) });
    j = await r.json();
  } catch { return gpFail(s, "连不上 Globalping 的接口，外部检测没有运行。"); }
  const left = +r.headers.get("x-ratelimit-remaining"), reset = +r.headers.get("x-ratelimit-reset");
  if (r.headers.get("x-ratelimit-remaining") != null) showQuota(left, reset);
  if (r.status === 429) return gpFail(s, `外部检测额度用完了，约 ${Math.ceil((reset || 3600) / 60)} 分钟后恢复。下面「从你这里」和 DNS 的结果不受影响。`);
  if (!r.ok) return gpFail(s, `外部检测没有运行：${j?.error?.message || r.status}`);

  const t0 = Date.now();
  while (s.id === run && Date.now() - t0 < 45000) {
    await new Promise(res => setTimeout(res, 700));
    let m; try { m = await (await fetch(`${GP}/measurements/${j.id}`)).json(); } catch { continue; }
    place(s, m.results || []);
    drawRegions(); drawVerdict();
    if (m.status !== "in-progress") break;
  }
  s.gpDone = true; s.gpId = j.id;
  drawRegions(); drawVerdict(); if (s.dns) drawDns();
}
function gpFail(s, msg) { s.gpDone = true; s.gpError = msg; drawRegions(); drawVerdict(); }

// Match each probe to its region: results come back in location order, but check the probe's place to be sure
function place(s, results) {
  const used = new Set();
  const fits = (loc, p) => Object.entries(loc).every(([k, v]) => k === "city" ? p.city === v : k === "asn" ? p.asn === v : p[k] === v);
  results.forEach((res, i) => {
    let k = REGIONS.findIndex((x, n) => !used.has(n) && n === i && fits(x.loc, res.probe));
    if (k < 0) k = REGIONS.findIndex((x, n) => !used.has(n) && fits(x.loc, res.probe));
    if (k < 0) k = i;
    used.add(k);
    s.rows[k] = { probe: res.probe, res: res.result, c: res.result.status === "in-progress" ? null : classify(res.result, s) };
  });
}

// What one probe saw, as one of: ok, http5, nothttp, nottls, refused, timeout, dns, unreach, reset, tls, slow, other
function classify(r, s) {
  const raw = r.rawOutput || "";
  if (r.status === "finished") {
    const code = r.statusCode;
    return { k: code >= 500 ? "http5" : "ok", code, cert: r.tls };
  }
  const k = /ECONNREFUSED/.test(raw) ? "refused"
    : /establishing the TCP connection|connect ETIMEDOUT/i.test(raw) ? "timeout"
    : /ENOTFOUND|EAI_AGAIN|ENODATA|SERVFAIL|NXDOMAIN|query(A|Aaaa)/i.test(raw) ? "dns"
    : /EHOSTUNREACH|ENETUNREACH/.test(raw) ? "unreach"
    : /does not match the HTTP|Expected HTTP|Parse Error/i.test(raw) ? "nothttp"
    : /wrong version number|packet length too long|unknown protocol/i.test(raw) ? "nottls"
    : /ECONNRESET|socket hang up/i.test(raw) ? "reset"
    : /certificate|CERT_|self[- ]signed|altnames|unable to verify/i.test(raw) ? "tls"
    : /handshake|ssl|tls alert/i.test(raw) ? "tls"
    : /timed out/i.test(raw) ? "slow" : "other";
  return { k, raw };
}

// Which outcomes mean "something on that port answered"
const REACHED = new Set(["ok", "http5", "nothttp", "nottls", "tls"]);
const good = (c, s) => c && (c.k === "ok" || (!s.web && c.k === "nothttp") || (c.k === "nottls" && !s.web));

const LABEL = {
  refused: ["bad", "拒绝连接：主机在，端口没有服务"],
  timeout: ["bad", "超时：连接没有任何回应"],
  dns: ["bad", "域名解析失败"],
  unreach: ["bad", "网络不可达"],
  reset: ["bad", "连接被重置"],
  tls: ["warn", "TLS 握手失败"],
  slow: ["warn", "连上了，但迟迟不返回"],
  other: ["bad", "失败"],
};
function rowStatus(row, s) {
  const c = row.c, r = row.res;
  if (c.k === "ok" || c.k === "http5") {
    const cf = CF_CODES[c.code];
    const certBad = r.tls && r.tls.authorized === false;
    const cls = c.k === "http5" || certBad ? "warn" : "ok";
    return [cls, `HTTP ${c.code}${cf ? " · " + cf[0] : ""}${certBad ? " · 证书不受信任" : ""}`];
  }
  if (c.k === "nothttp") return s.web ? ["warn", "端口开着，但应答的不是网页"] : ["ok", `端口开着，有服务应答${s.what ? `（不是网页，符合 ${s.what}）` : ""}`];
  if (c.k === "nottls") return s.web ? ["warn", "端口开着，但不是 HTTPS"] : ["ok", "端口开着，有服务应答"];
  return LABEL[c.k] || LABEL.other;
}

const CF_CODES = {
  520: ["源站返回了异常响应", "Cloudflare 连上了你的服务器，但它返回的内容 Cloudflare 看不懂（空响应、头太大等）。看源站的错误日志。"],
  521: ["源站拒绝连接", "Cloudflare 连你的服务器被拒绝：网页服务没运行，或防火墙只拦了 Cloudflare 的 IP。"],
  522: ["连源站超时", "Cloudflare 连你的服务器超时：防火墙、安全组没放行 Cloudflare 的 IP，或服务器负载过高。"],
  523: ["源站不可达", "Cloudflare 找不到去你服务器的路：DNS 里的源站 IP 填错了或已经变了。"],
  524: ["源站响应超时", "连上了源站，但 100 秒内没返回：后端处理太慢。"],
  525: ["和源站的 TLS 握手失败", "SSL 模式是「完全」，但源站的 HTTPS 没配好。"],
  526: ["源站证书无效", "SSL 模式是「完全（严格）」，源站证书过期、自签或域名不匹配。"],
  530: ["Cloudflare 1xxx 错误", "通常是 DNS 指向有误或隧道（Tunnel）没在线。"],
};

// ---------- inside: this browser ----------

async function runLocal(s) {
  const { host, port, path } = s.t;
  if (BAD_PORTS.has(port)) {
    s.local = { k: "blocked" };
    return drawLocal();
  }
  const h = isV6(host) ? `[${host}]` : host;
  const url = `https://${h}:${port}${path.startsWith("/") ? path : "/" + path}`;
  const once = async () => {
    const c = new AbortController(), t = setTimeout(() => c.abort(), LOCAL_TIMEOUT), t0 = performance.now();
    try { await fetch(url, { mode: "no-cors", cache: "no-store", credentials: "omit", signal: c.signal }); return { ok: true, ms: performance.now() - t0 }; }
    catch { return { ok: false, timeout: c.signal.aborted, ms: performance.now() - t0 }; }
    finally { clearTimeout(t); }
  };
  const a = await once();
  if (!a.ok) { s.local = { k: a.timeout ? "timeout" : "answered", ms: a.ms }; return drawLocal(); }
  const b = await once();       // same connection again: one round trip plus the server's time
  s.local = { k: "ok", ms: a.ms, warm: b.ok ? b.ms : null };
  drawLocal();
}

// ---------- DNS over HTTPS ----------

const RESOLVERS = [
  { name: "阿里 DNS", url: (n, t) => `https://dns.alidns.com/resolve?name=${n}&type=${t}` },
  { name: "Cloudflare", url: (n, t) => `https://cloudflare-dns.com/dns-query?name=${n}&type=${t}`, accept: "application/dns-json" },
  { name: "Google", url: (n, t) => `https://dns.google/resolve?name=${n}&type=${t}` },
];
async function runDns(s) {
  const q = async (rv, type) => {
    const c = new AbortController(); setTimeout(() => c.abort(), 5000);
    try {
      const j = await (await fetch(rv.url(encodeURIComponent(s.t.host), type), { headers: rv.accept ? { accept: rv.accept } : {}, signal: c.signal })).json();
      return { status: j.Status, ans: (j.Answer || []).filter(a => a.type === type).map(a => a.data), cname: (j.Answer || []).filter(a => a.type === 5).map(a => a.data.replace(/\.$/, "")), ttl: (j.Answer || [])[0]?.TTL };
    } catch { return { fail: true }; }
  };
  s.dns = await Promise.all(RESOLVERS.map(async rv => ({ rv, a: await q(rv, 1), aaaa: await q(rv, 28) })));
  drawDns(); drawVerdict();
}
const dnsIps = s => [...new Set((s.dns || []).flatMap(d => [...(d.a.ans || []), ...(d.aaaa.ans || [])]))];

function ipNote(ip) {
  const k = ipKind(ip);
  return k === "private" ? `<p class="flag bad">${esc(ip)} 是内网地址，只有同一个局域网里能用，外面的人连不到。</p>`
    : k === "cgnat" ? `<p class="flag bad">${esc(ip)} 在 100.64.0.0/10（运营商级 NAT）里：不是公网地址，端口转发不会生效。</p>`
    : k === "fakeip" ? `<p class="flag">${esc(ip)} 是代理软件的 fake-ip，不是真实地址。关掉代理或用 DoH 结果为准。</p>`
    : k === "cf" ? `<p class="flag">${esc(ip)} 属于 Cloudflare：域名开着代理（橙色云），外面连的是 Cloudflare，不是你的服务器。</p>` : "";
}

// ---------- drawing ----------

function drawRegions() {
  const s = state; let html = "", g = "";
  // Bars for every probe that reached the port; one that stopped earlier is hatched and doesn't set the scale
  const span = r => r.res.status === "finished" ? r.res.timings.total : (r.res.timings.dns || 0) + r.res.timings.tcp + (r.res.timings.tls || 0);
  const drawn = r => r?.c && REACHED.has(r.c.k) && r.res.timings?.tcp != null;
  const max = Math.max(200, ...s.rows.filter(drawn).map(span));
  const tcps = s.rows.filter(r => r?.c && r.res.timings?.tcp != null).map(r => r.res.timings.tcp).sort((a, b) => a - b);
  const tcpMed = tcps[Math.floor(tcps.length / 2)] || 0;
  REGIONS.forEach((x, i) => {
    if (x.g !== g) { g = x.g; html += `<div class="grp">${esc(g)}</div>`; }
    const row = s.rows[i];
    let st = `<span class="rg-st m blink">排队中…</span>`, bar = `<div class="bar"></div>`, segs = "", tot = `<div class="rg-tot wait">–</div>`, sub = "&nbsp;";
    if (!row && (s.gpError || s.gpDone)) st = `<span class="rg-st m">${s.gpError ? "未运行" : "这个地区暂时没有可用的探针"}</span>`;
    if (row) {
      const p = row.probe;
      sub = esc([p.city, p.network].filter(Boolean).join(" · "));
      if (!row.c) st = `<span class="rg-st m blink">检测中…</span>`;
      else {
        const [cls, text] = rowStatus(row, s);
        const ip = row.res.resolvedAddress ? `<span class="ip">${esc(row.res.resolvedAddress)}</span>` : "";
        st = `<span class="rg-st ${cls}" title="${esc(row.c.raw || "")}">${esc(text)}${ip}</span>`;
        const t = row.res.timings || {};
        if (drawn(row)) {
          const part = (v, c) => v ? `<i class="${c}" data-w="${(v / max * 100).toFixed(2)}"></i>` : "";
          bar = `<div class="bar">${part(t.dns, "s-dns")}${part(t.tcp, "s-tcp")}${part(t.tls, "s-tls")}${part(t.firstByte, "s-fb")}${part(t.download, "s-dl")}</div>`;
          const hot = t.tcp > 1000 && t.tcp > tcpMed * 3;
          segs = [["DNS", t.dns], ["TCP", t.tcp, hot], ["TLS", t.tls], ["首字节", t.firstByte], ["下载", t.download]]
            .filter(([, v]) => v != null).map(([n, v, h]) => `<span${h ? ` class="hot" title="握手超过 1 秒：握手包丢了在重传"` : ""}>${n} ${v}</span>`).join(" · ");
          tot = `<div class="rg-tot">${span(row)}<small class="m"> ms</small></div>`;
          if (row.res.status !== "finished") segs = esc(failStage(row.c.k)) + " · " + segs;
        } else {
          bar = `<div class="bar fail"></div>`;
          segs = esc([failStage(row.c.k), t.dns != null && `DNS ${t.dns}`, t.tcp != null && `TCP ${t.tcp}`].filter(Boolean).join(" · "));
          tot = `<div class="rg-tot wait">${t.total != null ? `${(t.total / 1000).toFixed(1)}<small> s</small>` : "✕"}</div>`;
        }
        if (!good(row.c, s) || row.res.timings?.tcp > 1000) segs += ` <button type="button" class="link trace" data-trace="${i}"${row.trace === "" ? " disabled" : ""}>${row.trace === "" ? "追踪中…" : "追踪路由"}</button>`;
      }
    }
    const trace = row?.trace ? `<pre class="tr">${esc(row.trace)}</pre>` : "";
    html += `<div class="rg"><div class="rg-name"><b>${esc(x.name)}</b><small>${sub}</small></div><div class="rg-mid">${st}${bar}<div class="segs">${segs}</div></div>${tot}${trace}</div>`;
  });
  $("regions").innerHTML = html;
  for (const el of $("regions").querySelectorAll("[data-w]")) el.style.width = el.dataset.w + "%";   // the CSP forbids style attributes, not CSSOM
  const n = s.rows.filter(r => r?.c).length;
  $("gpProgress").textContent = s.gpError ? "" : `${n} / ${REGIONS.length}`;
  $("gpNote").innerHTML = (s.gpError ? `<span class="st-warn">${esc(s.gpError)}</span> ` : "") + `外部检测由 <a href="https://globalping.io" target="_blank" rel="noopener">Globalping</a> 的志愿者探针完成，从你的浏览器直接调用。`;
}
const failStage = k => ({ dns: "停在：DNS 解析", refused: "停在：TCP 握手（被拒绝）", timeout: "停在：TCP 握手（没有回应）", unreach: "停在：路由",
  reset: "停在：连接建立后被重置", tls: "停在：TLS 握手", nothttp: "TCP 通 · 对方说的不是 HTTP", nottls: "TCP 通 · 对方不是 TLS", slow: "TCP 通 · 等不到响应" })[k] || "";

function drawLocal() {
  const s = state, l = s.local, ms = v => `${Math.round(v)} ms`;
  const url = `https://${isV6(s.t.host) ? `[${s.t.host}]` : s.t.host}:${s.t.port}`;
  let h = "";
  if (l.k === "blocked") h = `<p><span class="st-warn">浏览器不允许连这个端口</span></p><p class="m">${s.t.port} 在浏览器的禁用端口清单里，请求根本发不出去。只能看上面的外部检测。</p>`;
  else if (l.k === "ok") {
    const setup = l.warm != null ? Math.max(0, l.ms - l.warm) : null;
    h = `<p><span class="st-ok">网页能打开</span></p><dl class="kv">
      <dt>首次请求</dt><dd class="mono">${ms(l.ms)}</dd>
      ${setup != null ? `<dt>建立连接</dt><dd class="mono">≈ ${ms(setup)} <span class="m">（DNS + TCP + TLS，两次请求之差）</span></dd><dt>请求往返</dt><dd class="mono">${ms(l.warm)} <span class="m">（复用连接）</span></dd>` : ""}
    </dl><p class="m">跨站请求拿不到更细的分段。如果这是你自己的网站，加上响应头 <span class="mono">Timing-Allow-Origin: *</span> 就能看到 DNS、TCP、TLS 各自的耗时。</p>`;
  } else if (l.k === "answered") h = `<p><span class="st-warn">有回应</span> <span class="mono m">${ms(l.ms)}</span></p><p class="m">连接很快就结束了：端口开着但不是 HTTPS 网页，或者对方拒绝了连接。浏览器分不清这两种情况。${s.plainWeb ? "这个服务是不加密的 HTTP，网页里只能用 HTTPS 去连，所以只能判断有没有回应。" : ""}</p>`;
  else h = `<p><span class="st-bad">不通</span> <span class="mono m">${LOCAL_TIMEOUT / 1000} 秒没有回应</span></p><p class="m">从你这里连 ${esc(url)} 没有任何回应。</p>`;
  $("local").innerHTML = h;
  drawVerdict();
}

function drawDns() {
  const s = state; if (!s.dns) return;
  const cell = q => q.fail ? `<span class="m">你这里连不上这个解析服务</span>` : q.status === 3 ? `<span class="st-bad">域名不存在</span>` : q.status && q.status !== 0 ? `<span class="st-bad">解析失败（${q.status === 2 ? "SERVFAIL" : "代码 " + q.status}）</span>` : q.ans.length ? `<span class="mono">${q.ans.map(esc).join("<br>")}</span>` : `<span class="m">无</span>`;
  let h = `<dl class="kv">`;
  for (const d of s.dns) h += `<dt>${esc(d.rv.name)}</dt><dd>${cell(d.a)}${d.aaaa.ans?.length ? `<br>${cell(d.aaaa)}` : ""}</dd>`;
  h += `</dl>`;
  const cname = s.dns.find(d => d.a.cname?.length)?.a.cname;
  if (cname) h += `<p class="m">别名（CNAME）：<span class="mono">${cname.map(esc).join(" → ")}</span></p>`;
  const ips = dnsIps(s);
  h += ips.map(ipNote).join("");
  const sets = s.dns.filter(d => !d.a.fail && d.a.ans).map(d => [...d.a.ans].sort().join());
  if (new Set(sets).size > 1) h += `<p class="flag">各家解析服务的答案不同。用了 CDN 或按地区解析时是正常的；如果刚改过记录，说明还没全部生效（TTL ${s.dns.find(d => d.a.ttl)?.a.ttl ?? "?"} 秒）。</p>`;
  // A domestic resolver answering differently from every probe abroad: poisoned, or geo DNS
  const abroad = new Set(s.rows.filter((r, i) => r && !REGIONS[i].cn).map(r => r.res.resolvedAddress).filter(Boolean));
  const ali = s.dns[0].a.ans || [];
  if (abroad.size && ali.length && !ali.some(ip => abroad.has(ip))) h += `<p class="flag">阿里 DNS 的答案和国外探针解析到的地址（${[...abroad].slice(0, 2).map(esc).join("、")}）完全不同：按地区解析的 CDN 会这样，被 DNS 污染也会这样。看下面中国三网能不能连上。</p>`;
  if (s.home && !ips.some(ip => ipKind(ip) === "cf") && myIp.v4 &&!ips.includes(myIp.v4) && s.dns.some(d => d.a.ans?.length) && ips.some(ip => isV4(ip))) {
    h += `<p class="m">你现在的公网 IPv4 是 <span class="mono">${esc(myIp.v4)}</span>，和 DNS 里的不一样。如果服务就在你这里（家里的 NAS），说明 DDNS 没有更新；开着代理时，这里显示的可能是代理的 IP。</p>`;
  }
  $("dns").innerHTML = h;
}

// ---------- verdict: can they reach it, and what to check next ----------

function drawVerdict() {
  const s = state;
  const rows = s.rows.filter(r => r?.c);
  const v = verdict(s, rows);
  $("vDot").className = "dot " + (v.cls || "");
  $("vTitle").textContent = v.title;
  $("vSub").textContent = v.sub || " ";
  $("vSteps").innerHTML = (v.steps || []).map(x => `<li>${x}</li>`).join("");
}

function verdict(s, rows) {
  const total = REGIONS.length;
  const ips = dnsIps(s), allIps = s.t.isIp ? [s.t.host] : ips;
  const port = s.t.port;
  const steps = [];
  // Problems visible before any probe answers
  const priv = allIps.find(ip => ipKind(ip) === "private"), cg = allIps.find(ip => ipKind(ip) === "cgnat");
  const cf = allIps.some(ip => ipKind(ip) === "cf");
  const cfPortOk = [...CF_HTTP, ...CF_HTTPS].includes(port);
  if (!s.gpDone && !s.gpError) {
    return { title: "检测中…", sub: `已有 ${rows.length} / ${total} 个地区返回结果`, steps: [] };
  }
  if (s.gpError && !rows.length) {
    return { cls: "warn", title: "外部检测没有运行", sub: s.gpError, steps: localSteps(s, null) };
  }
  if (priv) return { cls: "bad", title: "DNS 里填的是内网地址，外面的人连不上", sub: `${s.t.host} 解析到 ${priv}。`,
    steps: ["把 DNS 记录改成你的<b>公网 IP</b>（路由器状态页的 WAN 口地址，或者用 DDNS 自动更新）。", "在家里访问可以继续用内网地址，不需要经过 DNS。"] };

  const ok = rows.filter(r => good(r.c, s)), reached = rows.filter(r => REACHED.has(r.c.k));
  const kinds = {}; rows.filter(r => !good(r.c, s)).forEach(r => kinds[r.c.k] = (kinds[r.c.k] || 0) + 1);
  const top = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0];
  const cnRows = rows.filter((r, i) => r && REGIONS[s.rows.indexOf(r)]?.cn), wRows = rows.filter(r => !cnRows.includes(r));
  const cnOk = cnRows.filter(r => good(r.c, s)).length, wOk = wRows.filter(r => good(r.c, s)).length;

  if (cf && !cfPortOk) steps.push(`域名开着 <b>Cloudflare 代理（橙色云）</b>，外面连的是 Cloudflare，它只转发这些端口：HTTP ${CF_HTTP.join("、")}，HTTPS ${CF_HTTPS.join("、")}。${port} 不在其中，所以一定连不上：在 Cloudflare 里把这条记录改成「仅 DNS」（灰云），或者改用 Cloudflare Tunnel。`);
  if (!s.t.isIp && s.ipv === "6" && rows.length && rows.every(r => r.c.k === "dns")) steps.push("这个域名没有 IPv6（AAAA）记录，或探针那边解析不到。换回 IPv4 再测，或者先加上 AAAA 记录。");

  let title, cls, sub;
  if (ok.length === rows.length) {
    cls = "ok"; title = rows.length === total ? "全球都能连上" : `能连上（${rows.length} 个地区全部连通）`;
    const tcpMed = median(rows.map(r => r.res.timings?.tcp).filter(x => x != null));
    sub = tcpMed != null ? `${rows.length} 个地区全部连通，TCP 握手中位数 ${tcpMed} ms。` : `${rows.length} 个地区都连上了。`;
  } else if (!ok.length) {
    cls = "bad";
    ({ title, sub } = noneTitle(top, s, reached.length));
    steps.push(...failSteps(top, s, cf));
  } else if (cnRows.length && !cnOk && wOk >= wRows.length * 0.7) {
    cls = "warn"; title = "国外能连上，中国大陆连不上";
    sub = `中国电信、联通、移动都失败（${cnRows.map(r => rowStatus(r, s)[1]).join("；")}），其他 ${wOk} 个地区正常。`;
    const cnIps = cnRows.map(r => r.res.resolvedAddress).filter(Boolean), wIps = wRows.map(r => r.res.resolvedAddress).filter(Boolean);
    if (!s.t.isIp && cnIps.length && cnIps.some(ip => !wIps.includes(ip) && !ips.includes(ip))) steps.push(`中国大陆的探针把域名解析到了 <span class="mono">${esc(cnIps.find(ip => !wIps.includes(ip)))}</span>，和其他地区不同：可能被 <b>DNS 污染</b>。`);
    steps.push("常见原因：IP 或域名被墙；连接被重置多半是按域名（SNI）阻断，超时多半是 IP 被封或跨境线路严重丢包。可以换一个 IP 或域名对比测试。",
      "服务器在国内的话：域名没有备案时，云服务商会拦截 80、443 端口。",
      "主要用户在国内：考虑国内节点，或带国内节点的 CDN。");
  } else if (cnRows.length && cnOk === cnRows.length && !wOk) {
    cls = "warn"; title = "只有中国大陆能连上";
    sub = `中国三网正常，其他 ${wRows.length} 个地区都失败。`;
    steps.push("服务器或防火墙可能只放行了国内 IP（按地区封锁），检查防火墙、安全组的地区规则。", "也可能是运营商国际出口的问题：国内宽带的服务对外常常这样，用海外节点中转或 CDN 解决。");
  } else {
    cls = "warn"; title = `部分地区连不上（${ok.length} / ${rows.length} 能连）`;
    const bad = rows.filter(r => !good(r.c, s)).map(r => REGIONS[s.rows.indexOf(r)].name);
    sub = `失败的地区：${bad.join("、")}。`;
    steps.push("个别地区失败，多半是那条线路的问题，不是你的服务配置。点失败那一行的「追踪路由」，看断在哪一跳。");
  }

  // Details that apply whatever the headline
  const slow = rows.filter(r => r.res.timings?.tcp > 1000);
  if (slow.length && ok.length) steps.push(`${slow.map(r => REGIONS[s.rows.indexOf(r)].name).join("、")} 的 TCP 握手超过 1 秒。正常应该是一次往返，说明握手包丢了要重传：那条线路丢包严重。`);
  const cert = rows.find(r => r.res.tls && r.res.tls.authorized === false);
  if (cert) steps.push(`<b>证书不受信任</b>：${esc(cert.res.tls.error || "")}。浏览器会报警告，App 和 curl 会直接失败。用 Let's Encrypt 等免费证书；80 端口被封的话，用 DNS 验证方式申请。`);
  const exp = rows.map(r => r.res.tls?.expiresAt).find(Boolean);
  if (exp) { const days = Math.floor((new Date(exp) - Date.now()) / 864e5); if (days < 14) steps.push(days < 0 ? `<b>证书已经过期</b>（${exp.slice(0, 10)}）。` : `证书 ${days} 天后过期（${exp.slice(0, 10)}），检查自动续期是否正常。`); }
  const codes = [...new Set(rows.filter(r => r.c.k === "http5" || CF_CODES[r.c.code]).map(r => r.c.code))];
  for (const c of codes) if (CF_CODES[c]) steps.push(`<b>${c}</b>：${CF_CODES[c][1]}`); else steps.push(`服务器返回 <b>${c}</b>：连接没问题，是服务本身出错了，看它的日志。`);
  if (ok.length && rows.some(r => r.c.k === "nothttp") && s.web) steps.push("这个端口上应答的不是网页服务。端口转发可能指到了别的服务，或者这个服务本来就不是网页（那就是正常的）。");
  if (rows.some(r => r.c.k === "nottls") && s.web) steps.push("这个端口不是 HTTPS。用 <span class=\"mono\">http://</span> 开头的地址再测一次。");
  steps.push(...localSteps(s, ok.length ? (ok.length === rows.length ? "all" : "some") : "none"));
  return { cls, title, sub, steps };
}

function noneTitle(top, s, reached) {
  const t = { timeout: "外面连不上：连接超时", refused: "能找到主机，但端口没有服务在监听", dns: "域名解析失败", unreach: "外面连不上：网络不可达",
    reset: "外面连不上：连接被重置", tls: "TCP 能连上，但 TLS 握手失败", nothttp: "端口开着，但应答的不是网页", nottls: "端口开着，但不是 HTTPS", slow: "连上了，但服务不响应" }[top] || "外面连不上";
  const sub = { timeout: "所有地区连这个端口都没有任何回应：数据包被丢掉了。", refused: "所有地区都收到了「拒绝连接」：IP 是通的，但这个端口上没有程序在接收连接。",
    dns: "各地的探针都解析不出这个域名。", reset: "连接一建立就被对方或中间设备掐断。" }[top] || "";
  return { title: t, sub };
}

function failSteps(top, s, cf) {
  const p = s.t.port, v6 = s.ipv === "6" || isV6(s.t.host);
  if (top === "timeout") return [
    `先在服务所在的机器上确认服务能打开（访问 <span class="mono">localhost:${p}</span>）。`,
    `<b>端口转发</b>：路由器里把外部端口 ${p} 转到设备的内网 IP 和端口。设备的内网 IP 变过的话，转发会失效，给它设个固定 IP。`,
    "<b>防火墙</b>：NAS 自带的防火墙、Windows 防火墙、云服务器的安全组，都要放行这个端口。",
    v6 ? "<b>IPv6</b>：光猫和路由器的 IPv6 防火墙默认挡住所有入站连接，要单独放行这个端口。" : "<b>有没有公网 IP</b>：路由器状态页的 WAN 口 IP 和你的公网 IP 不一样，或者是 100.64–100.127 开头，说明没有公网 IPv4（运营商级 NAT），端口转发不会生效。可以找运营商要公网 IP、改用 IPv6，或者用内网穿透（Cloudflare Tunnel、Tailscale、frp）。",
    ...(ISP_BLOCKED.includes(p) ? [`国内家用宽带通常封了入站的 ${ISP_BLOCKED.join("、")} 端口。换一个不常用的高位端口（比如 ${p === 443 ? "52443" : "58080"}）再测。`] : []),
  ];
  if (top === "refused") return [
    "服务没有运行，或者只监听了 <span class=\"mono\">127.0.0.1</span>：改成监听 <span class=\"mono\">0.0.0.0</span>（所有网卡）。",
    "端口转发指向的内网端口或设备不对：外部端口和内部端口可以不同，确认内部端口是服务真正监听的那个。",
    "防火墙设成「拒绝」（而不是「丢弃」）时也会这样，检查防火墙规则。",
  ];
  if (top === "dns") return ["确认域名没有过期，并且有 A（IPv4）或 AAAA（IPv6）记录。", "刚注册或刚改了 NS 的域名，生效可能需要几小时。", "用 DDNS 的话，确认 DDNS 客户端在运行，并且更新成功。"];
  if (top === "reset") return ["连接一建立就被重置：防火墙、入侵检测，或者运营商的阻断设备。只有中国大陆这样的话，多半是按域名（SNI）阻断。"];
  if (top === "tls") return ["证书或 TLS 配置有问题：检查证书是否完整（包括中间证书）、是否过期、域名是否匹配，以及是否只开了过时的 TLS 版本。"];
  if (top === "unreach") return ["探针那边找不到去这个地址的路由：地址可能写错了，或者这段地址没有在公网上宣告。IPv6 尤其常见。"];
  return [];
}

function localSteps(s, outside) {
  const l = s.local; if (!l || !outside) return [];
  const here = l.k === "ok";     // "answered" may just be a refusal, so it proves nothing
  if (outside === "none" && here) return ["<b>你这里能连上，外面却不行</b>：多半是你和服务在同一个网络里（流量没出门），或者你开着代理。以外部检测为准。"];
  if (outside === "all" && l.k === "timeout") return ["<b>外面能连，你这里连不上</b>：如果你和服务在同一个网络里，可能是路由器不支持 NAT 回环，在家请用内网地址访问；也可能是你的代理规则把它挡住了。"];
  return [];
}
const median = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;

// ---------- trace route from one region, on request ----------

$("regions").addEventListener("click", async e => {
  const b = e.target.closest("[data-trace]"); if (!b) return;
  const s = state, i = +b.dataset.trace, row = s.rows[i]; if (!row) return;
  row.trace = ""; drawRegions();
  const p = row.probe;
  try {
    const r = await fetch(GP + "/measurements", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "mtr", target: s.t.host, locations: [{ country: p.country, city: p.city, asn: p.asn, limit: 1 }],
        measurementOptions: { protocol: "TCP", port: s.t.port, packets: 3, ...(s.t.isIp ? {} : { ipVersion: +s.ipv }) } }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || r.status);
    let m;
    for (let k = 0; k < 60; k++) { await new Promise(res => setTimeout(res, 1000)); m = await (await fetch(`${GP}/measurements/${j.id}`)).json(); if (m.status !== "in-progress") break; }
    row.trace = m.results?.[0]?.result?.rawOutput || "没有结果";
  } catch (err) { row.trace = "追踪失败：" + err.message; }
  drawRegions();
});

// ---------- start ----------

renderPresets();
loadQuota();
const qs = new URLSearchParams(location.search);
if (qs.get("t")) {
  $("target").value = qs.get("t");
  if (qs.get("p")) { $("port").value = qs.get("p"); const p = PRESETS.find(x => x.port === +qs.get("p")); if (p) { preset = p; renderPresets(); } }
  if (qs.get("from") === "friend") start();
}
