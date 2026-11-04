// Reach Check: can other people reach this service, and if not, where does it stop?
// Outside view: Globalping probes (one HTTP measurement from every region, called straight from the browser, so each
// visitor spends their own hourly allowance). Inside view: this browser, by timing two HTTPS requests. DNS: public DoH
// resolvers that answer browsers (CORS). Strings come from window.L1MS (assets/l.<lang>.*.js, built from src/i18n/).
(() => {
const GP = "https://api.globalping.io/v1";
const L = window.L1MS || {}, D = JSON.parse(document.getElementById("data").textContent);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const t = (k, v) => { let s = L[k] ?? k; if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };
// advice strings: **bold** and `code`, with the values escaped before they go in
const tm = (k, v) => { const e = {}; for (const x in v || {}) e[x] = esc(v[x]); return t(k, e).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, '<span class="mono">$1</span>'); };
const list = a => a.join(t("sep"));
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const K = { theme: "reachcheck:theme", lang: "reachcheck:lang" };

// theme and language
const TH = ["system", "light", "dark"], thBtn = $("theme");
const applyTheme = th => {
  if (th === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", th);
  thBtn.dataset.th = th; thBtn.title = t("th_" + th); thBtn.setAttribute("aria-label", t("th_" + th));
};
applyTheme(TH.includes(store.get(K.theme)) ? store.get(K.theme) : "system");
thBtn.onclick = () => { const n = TH[(TH.indexOf(thBtn.dataset.th) + 1) % 3]; store.set(K.theme, n); applyTheme(n); };
$("lang").onchange = e => { const l = e.target.value; store.set(K.lang, l); location.href = D.paths[l] + location.search; };

// Other 1ms.dog tools: their address comes from the shell's <meta name="<id>">; self-hosted there is none, so no link.
// Links keep this page's language folder.
const tool = id => { const m = document.querySelector(`meta[name="${id}"]`); return m && m.content ? m.content.replace(/\/+$/, "") + D.paths[D.lang] : ""; };
const EXT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 10v3.5H2.5V4H6"/></svg>';
const toolLink = (id, key) => { const u = tool(id); return u ? `<a class="xl" href="${esc(u)}" target="_blank" rel="noopener">${esc(t(key))}${EXT}</a>` : ""; };
// an IP address as a value: links to ASN Lookup (who owns it), except private ones
const ipVal = ip => { const u = tool("asn"); return u && ["public", "cf"].includes(ipKind(ip)) ? `<a class="dv" href="${esc(u)}ip/${esc(ip)}" target="_blank" rel="noopener" title="${esc(t("lk_asn"))}">${esc(ip)}</a>` : esc(ip); };

// the help dialog: one answer at a time; a picker with previous / next on phones
const all = s => [...document.querySelectorAll(s)];
const openDlg = id => { $(id).hidden = false; document.documentElement.style.overflow = "hidden"; $(id).querySelector("[data-close]").focus(); };
const closeDlg = () => { all(".scrim").forEach(s => { s.hidden = true; }); document.documentElement.style.overflow = ""; };
all("[data-close]").forEach(b => { b.onclick = closeDlg; });
all(".scrim").forEach(s => s.addEventListener("click", e => { if (e.target === s) closeDlg(); }));
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDlg(); });
let helpIdx = 0;
const helpQs = all("#helpNav [data-hq]");
$("helpSel").innerHTML = helpQs.map((b, i) => `<option value="${i}">${i + 1} / ${helpQs.length} · ${esc(b.textContent)}</option>`).join("");
const showHelp = i => {
  helpIdx = Math.max(0, Math.min(helpQs.length - 1, i));
  helpQs.forEach(b => b.setAttribute("aria-selected", +b.dataset.hq === helpIdx));
  all("#helpC [data-hqb]").forEach(a => { a.hidden = +a.dataset.hqb !== helpIdx; });
  $("helpSel").value = helpIdx;
  all("[data-hstep]").forEach(b => { b.disabled = helpIdx + +b.dataset.hstep < 0 || helpIdx + +b.dataset.hstep >= helpQs.length; });
  $("helpC").scrollTop = 0;
};
$("helpBtn").onclick = () => { showHelp(helpIdx); openDlg("help"); };
helpQs.forEach(b => { b.onclick = () => showHelp(+b.dataset.hq); });
$("helpSel").onchange = e => showHelp(+e.target.value);
all("[data-hstep]").forEach(b => { b.onclick = () => showHelp(helpIdx + +b.dataset.hstep); });

// One probe per region: mainland China by carrier (eyeball networks), then each continent's main hubs.
// `loc` is a Globalping location filter; names come from the browser (Intl.DisplayNames) plus a city or carrier,
// except Taiwan's, which is written out per the 1ms.dog tool contract.
const REGIONS = [
  { g: "cn", cc: "CN", carrier: 4134, loc: { country: "CN", asn: 4134 } },
  { g: "cn", cc: "CN", carrier: 4837, loc: { country: "CN", asn: 4837 } },
  { g: "cn", cc: "CN", carrier: 9808, loc: { country: "CN", asn: 9808 } },
  { g: "apac", cc: "HK", loc: { country: "HK" } },
  { g: "apac", cc: "TW", loc: { country: "TW" } },
  { g: "apac", cc: "JP", city: "Tokyo", loc: { city: "Tokyo" } },
  { g: "apac", cc: "KR", loc: { country: "KR" } },
  { g: "apac", cc: "SG", loc: { country: "SG" } },
  { g: "apac", cc: "IN", loc: { country: "IN" } },
  { g: "apac", cc: "AU", loc: { country: "AU" } },
  { g: "emea", cc: "GB", city: "London", loc: { city: "London" } },
  { g: "emea", cc: "DE", city: "Frankfurt", loc: { city: "Frankfurt" } },
  { g: "emea", cc: "RU", loc: { country: "RU" } },
  { g: "emea", cc: "AE", loc: { country: "AE" } },
  { g: "emea", cc: "ZA", loc: { country: "ZA" } },
  { g: "am", cc: "US", city: "LosAngeles", loc: { city: "Los Angeles" } },
  { g: "am", cc: "US", city: "NewYork", loc: { city: "New York" } },
  { g: "am", cc: "BR", city: "SaoPaulo", loc: { city: "Sao Paulo" } },
];
REGIONS.forEach(x => x.cn = x.g === "cn");
const TW = { "zh-CN": "中国台湾", "zh-TW": "中國台灣", en: "Taiwan, China", ja: "中国台湾", ko: "중국 대만", es: "Taiwán, China", fr: "Taïwan, Chine", de: "Taiwan, China", pt: "Taiwan, China", ru: "Тайвань, Китай" };
const regionName = (cc, lang) => cc === "TW" ? (TW[lang] || TW.en) : new Intl.DisplayNames([lang], { type: "region" }).of(cc);
const regionOf = cc => { try { return regionName(cc, D.lang); } catch (e) { return cc; } };
const nameOf = x => x.carrier ? t("c_" + x.carrier) : x.city ? `${regionOf(x.cc)} · ${t("city_" + x.city)}` : regionOf(x.cc);

// Presets: the port, whether it should answer as a web page (and over TLS), what to expect otherwise
const PRESETS = [
  { label: "p_web", port: 443, proto: "HTTPS", web: true },
  { label: "p_web_http", port: 80, proto: "HTTP", web: true },
  { label: "p_dsm", port: 5001, proto: "HTTPS", web: true, home: true },
  { brand: "Jellyfin / Emby", port: 8096, proto: "HTTP", web: true, home: true },
  { brand: "Plex", port: 32400, proto: "HTTP", web: true, home: true },
  { brand: "Home Assistant", port: 8123, proto: "HTTP", web: true, home: true },
  { brand: "SSH", port: 22, proto: "HTTP", web: false, what: "what_ssh", home: true },
  { label: "p_rdp", port: 3389, proto: "HTTP", web: false, what: "what_rdp", home: true },
  { brand: "Minecraft", port: 25565, proto: "HTTP", web: false, what: "what_mc", home: true },
  { label: "p_udp", udp: true },
];
const presetName = p => p.brand || t(p.label);

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
const CF_CODES = [520, 521, 522, 523, 524, 525, 526, 530];

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
    s = s.replace(/\/.*$/, p => { path = p; return ""; });
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

let preset = PRESETS[0], run = 0, state;

// The port field and its list of usual services (443 · Website, 5001 · Synology DSM…), drawn by the page so it sits
// under the field in the page's colors. Typing narrows the list to the ports that start with what was typed; the port
// typed picks its service, named under the fields.
const PORTS = PRESETS.filter(p => !p.udp);
let portActive = -1, portTyped = false;   // the list narrows only once something is typed, not to the port already there
function renderPresets() {
  const v = portTyped ? $("port").value.trim() : "", shown = PORTS.filter(p => !v || String(p.port).startsWith(v) || +v === p.port);
  const list = shown.length ? shown : PORTS;
  portActive = Math.min(portActive, list.length - 1);
  $("portList").innerHTML = list.map((p, i) => `<li role="option" id="po${i}" data-port="${p.port}" aria-selected="${i === portActive}"><b>${p.port}</b><span>${esc(presetName(p))}</span></li>`).join("");
  $("port").setAttribute("aria-activedescendant", portActive >= 0 ? "po" + portActive : "");
}
const portOpen = open => {
  $("portList").hidden = !open; $("port").setAttribute("aria-expanded", open);
  if (open) { portActive = -1; portTyped = false; renderPresets(); }
};
const pickPort = port => {
  $("port").value = port; portOpen(false);
  $("port").dispatchEvent(new Event("input"));
};
$("port").addEventListener("input", e => {
  preset = PRESETS.find(p => p.port === +$("port").value && !p.udp) || null;
  $("portNote").textContent = preset ? presetName(preset) : "";
  if (!$("portList").hidden && e.isTrusted) { portTyped = true; renderPresets(); }
});
$("port").addEventListener("focus", () => portOpen(true));
$("port").addEventListener("click", () => portOpen(true));
$("portBtn").addEventListener("click", () => { portOpen($("portList").hidden); $("port").focus(); });
$("port").addEventListener("keydown", e => {
  const items = [...$("portList").children];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if ($("portList").hidden) portOpen(true);
    portActive = (portActive + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    renderPresets(); $("po" + portActive)?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter" && !$("portList").hidden && portActive >= 0) { e.preventDefault(); pickPort(items[portActive].dataset.port); }
  // Escape closes the list; in a search field it would also clear the port, so not that
  else if (e.key === "Escape") { if (!$("portList").hidden) e.preventDefault(); portOpen(false); }
  else if (e.key === "Tab") portOpen(false);
});
// mousedown, not click: picking an item must happen before the field loses focus and the list closes
$("portList").addEventListener("mousedown", e => { const li = e.target.closest("li[data-port]"); if (li) { e.preventDefault(); pickPort(li.dataset.port); } });
document.addEventListener("pointerdown", e => { if (!e.target.closest(".combo")) portOpen(false); });

async function loadQuota() {
  try {
    const j = await (await fetch(GP + "/limits")).json();
    showQuota(j.rateLimit.measurements.create.remaining, j.rateLimit.measurements.create.reset);
  } catch { $("quota").textContent = ""; }
}
function showQuota(left, reset) {
  if (state) state.quota = { left, reset };
  const cost = REGIONS.length;
  $("quota").textContent = left >= cost ? t("quota_ok", { left, cost }) : t("quota_out", { min: Math.ceil(reset / 60) });
}

// "Ask a friend": copies a link that runs the same check in the friend's browser
let inviteUrl = "";
$("inviteBtn").title = t("invite_tip");
$("inviteBtn").addEventListener("click", () => {
  const b = $("inviteBtn");
  navigator.clipboard?.writeText(inviteUrl).then(() => { b.textContent = t("copied"); setTimeout(() => b.textContent = t("b_invite"), 1500); },
    () => prompt(t("invite_tip"), inviteUrl));
});

// ---------- run ----------

$("f").addEventListener("submit", e => { e.preventDefault(); start(); });

function start() {
  const raw = $("target").value.trim();
  const tg = parseTarget(raw, $("port").value);
  if (!tg) { $("portNote").textContent = t("bad_target"); return; }
  tg.raw = raw;
  if (!tg.port) tg.port = preset?.port || 443;
  const pr = PRESETS.find(p => p.port === tg.port && !p.udp);
  const proto = tg.scheme === "https" ? "HTTPS" : tg.scheme === "http" ? "HTTP" : pr ? pr.proto : [443, 8443, 5001].includes(tg.port) ? "HTTPS" : "HTTP";
  const web = tg.scheme ? true : pr ? pr.web : true;
  const id = ++run;
  state = { id, t: tg, proto, web, whatKey: pr?.what || "", home: !!pr?.home, plainWeb: proto === "HTTP" && web && (!!pr || tg.scheme === "http"),
    ipv: $("ipv").value, rows: REGIONS.map(() => null), gpDone: false, local: null, quota: state?.quota, ts: Date.now() };
  if (recv) { recv.remove(); recv = null; }

  const q = `?t=${encodeURIComponent(raw)}&p=${tg.port}`;
  history.replaceState(null, "", D.paths[D.lang] + q);    // also leaves a shared result's /r/ link
  $("verdict").hidden = $("table").hidden = false;
  $("go").disabled = true;
  showOut(tg);
  $("shareBtn").hidden = true;
  drawRegions(); drawVerdict();

  const jobs = [runGlobalping(state), runLocal(state)];
  Promise.allSettled(jobs).then(() => { if (state.id === id) { $("go").disabled = false; drawVerdict(); $("shareBtn").hidden = false; loadQuota(); } });
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
  } catch { return gpFail(s, t("gp_unreach")); }
  const reset = +r.headers.get("x-ratelimit-reset");
  if (r.headers.get("x-ratelimit-remaining") != null) showQuota(+r.headers.get("x-ratelimit-remaining"), reset);
  if (r.status === 429) return gpFail(s, t("gp_429", { min: Math.ceil((reset || 3600) / 60) }));
  if (!r.ok) return gpFail(s, t("gp_err", { msg: j?.error?.message || r.status }));

  const t0 = Date.now();
  while (s.id === run && Date.now() - t0 < 45000) {
    await new Promise(res => setTimeout(res, 700));
    let m; try { m = await (await fetch(`${GP}/measurements/${j.id}`)).json(); } catch { continue; }
    place(s, m.results || []);
    drawRegions(); drawVerdict();
    if (m.status !== "in-progress") break;
  }
  s.gpDone = true;
  drawRegions(); drawVerdict();
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
    s.rows[k] = { ...s.rows[k], probe: res.probe, res: res.result, c: res.result.status === "in-progress" ? null : classify(res.result) };
  });
}

// What one probe saw, as one of: ok, http5, nothttp, nottls, refused, timeout, dns, unreach, reset, tls, slow, other
function classify(r) {
  const raw = r.rawOutput || "";
  if (r.status === "finished") return { k: r.statusCode >= 500 ? "http5" : "ok", code: r.statusCode };
  const k = /ECONNREFUSED/.test(raw) ? "refused"
    : /establishing the TCP connection|connect ETIMEDOUT/i.test(raw) ? "timeout"
    : /ENOTFOUND|EAI_AGAIN|ENODATA|SERVFAIL|NXDOMAIN|query(A|Aaaa)/i.test(raw) ? "dns"
    : /EHOSTUNREACH|ENETUNREACH/.test(raw) ? "unreach"
    : /does not match the HTTP|Expected HTTP|Parse Error/i.test(raw) ? "nothttp"
    : /wrong version number|packet length too long|unknown protocol/i.test(raw) ? "nottls"
    : /ECONNRESET|socket hang up|other side closed/i.test(raw) ? "reset"
    : /certificate|CERT_|self[- ]signed|altnames|unable to verify|handshake|ssl|tls alert/i.test(raw) ? "tls"
    : /timed out/i.test(raw) ? "slow" : "other";
  // tcp: the handshake completed, so something on that port accepted the connection before it went wrong
  return { k, raw, tcp: r.timings?.tcp != null };
}

// Which outcomes mean "something on that port answered"
const REACHED = new Set(["ok", "http5", "nothttp", "nottls", "tls", "reset"]);
// A service that isn't a web page (SSH, games) often answers an HTTP request by closing the connection: for those, a
// completed handshake is enough to call the port open
const openish = (c, s) => !s.web && (c.k === "nothttp" || c.k === "nottls" || (c.k === "reset" && c.tcp));
const good = (c, s) => c && (c.k === "ok" || openish(c, s));

const BAD = { refused: "bad", timeout: "bad", dns: "bad", unreach: "bad", reset: "bad", tls: "warn", slow: "warn", other: "bad" };
function rowStatus(row, s) {
  const c = row.c, r = row.res;
  if (c.k === "ok" || c.k === "http5") {
    const certBad = r.tls && r.tls.authorized === false;
    const parts = [t("st_http", { code: c.code })];
    if (CF_CODES.includes(c.code)) parts.push(t(`cf${c.code}_s`));
    if (certBad) parts.push(t("st_certbad"));
    return [c.k === "http5" || certBad ? "warn" : "ok", parts.join(" · ")];
  }
  if (c.k === "nothttp") return s.web ? ["warn", t("st_open_web")] : ["ok", s.whatKey ? t("st_open_what", { what: t(s.whatKey) }) : t("st_open")];
  if (c.k === "nottls") return s.web ? ["warn", t("st_nottls_web")] : ["ok", t("st_open")];
  if (openish(c, s)) return ["ok", t("st_open")];
  return [BAD[c.k] || "bad", t("st_" + c.k)];
}

// The short label in a region's line; the full sentence (rowStatus) is in its details
function pillOf(row, s) {
  const c = row.c;
  if (c.k === "ok" || c.k === "http5") return t("st_http", { code: c.code });
  if (c.k === "nothttp") return t(s.web ? "pl_web" : "pl_open");
  if (c.k === "nottls") return t(s.web ? "pl_nottls" : "pl_open");
  if (openish(c, s)) return t("pl_open");
  return t("pl_" + c.k);
}

// ---------- inside: this browser ----------

async function runLocal(s) {
  const { host, port, path } = s.t;
  if (BAD_PORTS.has(port)) { s.local = { k: "blocked" }; return drawLocal(); }
  const url = `https://${isV6(host) ? `[${host}]` : host}:${port}${path.startsWith("/") ? path : "/" + path}`;
  const once = async () => {
    const c = new AbortController(), timer = setTimeout(() => c.abort(), LOCAL_TIMEOUT), t0 = performance.now();
    try { await fetch(url, { mode: "no-cors", cache: "no-store", credentials: "omit", signal: c.signal }); return { ok: true, ms: performance.now() - t0 }; }
    catch { return { ok: false, timeout: c.signal.aborted, ms: performance.now() - t0 }; }
    finally { clearTimeout(timer); }
  };
  const a = await once();
  if (!a.ok) { s.local = { k: a.timeout ? "timeout" : "answered", ms: a.ms }; return drawLocal(); }
  const b = await once();       // same connection again: one round trip plus the server's time
  s.local = { k: "ok", ms: a.ms, warm: b.ok ? b.ms : null };
  drawLocal();
}

// The addresses the probes connected to: what DNS gave them (or the IP that was typed)
const dnsIps = s => [...new Set(s.rows.map(r => r?.res?.resolvedAddress).filter(Boolean))];

// ---------- drawing ----------

const failStage = k => ({ dns: "fs_dns", refused: "fs_refused", timeout: "fs_timeout", unreach: "fs_unreach", reset: "fs_reset", tls: "fs_tls", nothttp: "fs_nothttp", nottls: "fs_nottls", slow: "fs_slow" })[k];

// Every bar on one fixed scale, set before the first result arrives, so a bar never shrinks when slower results
// come in. A time past the scale fills the bar, which then fades out at its end.
const SCALE_MS = 3000;
function barOf(segs) {
  let cum = 0, h = "";
  for (const [v, c] of segs) {
    if (!v) continue;
    const a = Math.min(cum, SCALE_MS), b = Math.min(cum + v, SCALE_MS);
    cum += v;
    if (b > a) h += `<i class="${c}" data-w="${((b - a) / SCALE_MS * 100).toFixed(2)}"></i>`;
  }
  return `<div class="bar${cum > SCALE_MS ? " over" : ""}">${h}</div>`;
}
// A row's status as a dot (green: connects; amber: something's off; red: no; grey: waiting); its words in the tooltip
// and in the row's details
const dot = (cls, text, busy) => `<span class="sdot ${cls}${busy ? " blink" : ""}" role="img" title="${esc(text)}" aria-label="${esc(text)}"></span>`;

function drawRegions() {
  const s = state; let html = "", g = "", first = true;
  // Bars for every probe that reached the port; one that stopped earlier is hatched and doesn't set the scale
  const span = r => r.res.status === "finished" ? r.res.timings.total : (r.res.timings.dns || 0) + r.res.timings.tcp + (r.res.timings.tls || 0);
  const drawn = r => r?.c && REACHED.has(r.c.k) && r.res.timings?.tcp != null;
  const tcps = s.rows.filter(r => r?.c && r.res.timings?.tcp != null).map(r => r.res.timings.tcp).sort((a, b) => a - b);
  const tcpMed = tcps[Math.floor(tcps.length / 2)] || 0;
  // One line per region: name, a short status, the time bar, the total. A click opens the details: the full status,
  // the probe's network, the address it reached, each step's time, and trace route.
  REGIONS.forEach((x, i) => {
    if (first) { first = false; html += localRow(s); }
    if (x.g !== g) { g = x.g; html += `<div class="grp">${esc(t("g_" + g))}</div>`; }
    const row = s.rows[i];
    let pl = dot("m", t("r_queue"), true), bar = `<div class="bar"></div>`, tot = `<span class="rg-tot wait">–</span>`, more = "", hot = false;
    if (!row?.probe && (s.gpError || s.gpDone)) pl = dot("m", t(s.gpError ? "r_notrun" : "r_noprobe"));
    if (row?.probe && !row.c) pl = dot("m", t("r_testing"), true);
    if (row?.c) {
      const p = row.probe, tg = row.res.timings || {}, [cls, text] = rowStatus(row, s);
      hot = tg.tcp > 1000 && tg.tcp > tcpMed * 3;
      pl = dot(cls, pillOf(row, s) + (hot ? " · " + t("hot_tip") : ""));
      if (drawn(row)) {
        bar = barOf([[tg.dns, "s-dns"], [tg.tcp, "s-tcp"], [tg.tls, "s-tls"], [tg.firstByte, "s-fb"], [tg.download, "s-dl"]]);
        tot = `<span class="rg-tot">${span(row)}<small class="m"> ms</small></span>`;
      } else {
        bar = `<div class="bar fail"></div>`;
        tot = `<span class="rg-tot wait">${tg.total != null ? `${(tg.total / 1000).toFixed(1)}<small> s</small>` : "✕"}</span>`;
      }
      if (row.open) {
        const segs = [["sg_dns", tg.dns], ["sg_tcp", tg.tcp, hot], ["sg_tls", tg.tls], ["sg_fb", tg.firstByte], ["sg_dl", tg.download]]
          .filter(([, v]) => v != null).map(([n, v, h]) => `<span${h ? ` class="hot" title="${esc(t("hot_tip"))}"` : ""}>${esc(t(n))} ${v} ms</span>`).join(" · ");
        const where = [p.city, p.network].filter(Boolean).map(esc).join(" · ") + (row.res.resolvedAddress ? ` → ${ipVal(row.res.resolvedAddress)}` : "");
        const stage = row.res.status !== "finished" && !good(row.c, s) && failStage(row.c.k) ? esc(t(failStage(row.c.k))) + " · " : "";
        more = `<div class="rg-more"><p class="${cls}" title="${esc(row.c.raw || "")}">${esc(text)}</p><p class="m">${where}</p><p class="segs">${stage}${segs}` +
          ` <button type="button" class="link trace" data-trace="${i}"${row.trace === "" ? " disabled" : ""}>${esc(t(row.trace === "" ? "tracing" : "trace"))}</button></p>` +
          (row.trace ? `<pre class="tr">${esc(row.trace)}</pre>` : "") + `</div>`;
      }
    }
    const can = !!row?.c;
    html += `<div class="rg${row?.open ? " open" : ""}"${can ? ` data-row="${i}" role="button" tabindex="0" aria-expanded="${!!row.open}"` : ""}>` +
      `<span class="rg-name">${can ? '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>' : '<i class="chev"></i>'}${esc(nameOf(x))}</span>${pl}${bar}${tot}${more}</div>`;
  });
  $("regions").innerHTML = html;
  for (const el of $("regions").querySelectorAll("[data-w]")) el.style.width = el.dataset.w + "%";   // the CSP forbids style attributes, not CSSOM
  const n = s.rows.filter(r => r?.c).length;
  $("gpProgress").textContent = s.gpError ? "" : `${n} / ${REGIONS.length}`;
  $("gpNote").hidden = !s.gpError;
  $("gpNote").innerHTML = s.gpError ? `<span class="st-warn">${esc(s.gpError)}</span>` : "";
}

// This browser is the table's first row; drawing it is drawing the table
function drawLocal() { drawRegions(); drawVerdict(); }

// Its line: what the browser saw, a bar of connecting then the request, the first request's time. Its details: what
// that outcome can and can't tell, and where to look at the visitor's own connection more closely.
function localRow(s) {
  const l = s.local, ms = v => `${Math.round(v)} ms`;
  let pl = dot("m", t("r_testing"), true), bar = `<div class="bar"></div>`, tot = `<span class="rg-tot wait">–</span>`, more = "";
  if (l) {
    const setup = l.k === "ok" && l.warm != null ? Math.max(0, l.ms - l.warm) : null;
    const cls = { ok: "ok", answered: "warn", timeout: "bad", blocked: "m" }[l.k];
    pl = dot(cls, t({ ok: "ks_ok", answered: "ks_ans", timeout: "ks_none", blocked: "ks_blocked" }[l.k]));
    if (l.k === "ok") {
      bar = setup != null ? barOf([[setup, "s-setup"], [l.warm, "s-fb"]]) : barOf([[l.ms, "s-setup"]]);
    } else if (l.k !== "blocked") bar = `<div class="bar fail"></div>`;
    if (l.k === "ok" || l.k === "answered") tot = `<span class="rg-tot">${Math.round(l.ms)}<small class="m"> ms</small></span>`;
    else if (l.k === "timeout") tot = `<span class="rg-tot wait">${(LOCAL_TIMEOUT / 1000).toFixed(1)}<small> s</small></span>`;
    if (s.localOpen) {
      const url = `https://${isV6(s.t.host) ? `[${s.t.host}]` : s.t.host}:${s.t.port}`;
      const tao = esc(t("lc_tao")).replace("{h}", '<span class="mono">Timing-Allow-Origin: *</span>');
      const body = l.k === "ok" ? `<p class="ok">${esc(t("lc_ok"))}</p><p class="segs">${esc(t("lc_first"))} ${ms(l.ms)}` +
          (setup != null ? ` · ${esc(t("lc_setup"))} ≈ ${ms(setup)} · ${esc(t("lc_req"))} ${ms(l.warm)}` : "") + `</p><p class="m">${tao}</p>`
        : l.k === "answered" ? `<p class="warn">${esc(t("lc_ans"))}</p><p class="m">${esc(t("lc_ans_p"))}${s.plainWeb ? " " + esc(t("lc_plain")) : ""}</p>`
        : l.k === "timeout" ? `<p class="bad">${esc(t("lc_none"))}</p><p class="m">${esc(t("lc_none_p", { url }))}</p>`
        : `<p>${esc(t("lc_blocked"))}</p><p class="m">${esc(t("lc_blocked_p", { port: s.t.port }))}</p>`;
      const links = [toolLink("check", "lk_check"), toolLink("ipv6", "lk_ipv6")].filter(Boolean).join(" ");
      more = `<div class="rg-more">${body}${links ? `<p class="links">${links}</p>` : ""}</div>`;
    }
  }
  const can = !!l;
  return `<div class="grp">${esc(t("h_local"))}</div><div class="rg${s.localOpen ? " open" : ""}"${can ? ` data-row="local" role="button" tabindex="0" aria-expanded="${!!s.localOpen}"` : ""}>` +
    `<span class="rg-name">${can ? '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>' : '<i class="chev"></i>'}${esc(t("r_browser"))}</span>${pl}${bar}${tot}${more}</div>`;
}

// ---------- verdict: can they reach it, and what to check next ----------

function drawVerdict() {
  const s = state;
  const v = verdict(s, s.rows.filter(r => r?.c));
  $("vDot").className = "dot " + (v.cls || "");
  $("vTitle").textContent = v.title;
  $("vSub").textContent = v.sub || " ";
  // three numbers (outside, mainland China, this browser), then at most four next steps; the rest folded
  const rows = s.rows.filter(r => r?.c), done = s.gpDone || s.gpError;
  const cn = rows.filter(r => REGIONS[s.rows.indexOf(r)].cn), ok = rows.filter(r => good(r.c, s));
  const tone = (a, n) => !n ? "" : a === n ? "ok" : a ? "warn" : "bad";
  const cnOk = cn.filter(r => good(r.c, s)).length, l = s.local;
  const ms = l?.k === "ok" || l?.k === "answered" ? ` <span class="m">· ${esc(t("lc_first"))} ${Math.round(l.ms)} ms</span>` : "";
  const fact = (label, val, cls, extra = "") => `<div class="fact"><span class="fl">${esc(t(label))}</span><span class="fv"><b class="${cls}">${esc(val)}</b>${extra}</span></div>`;
  $("kpis").innerHTML =
    fact("fa_world", done && rows.length ? t("fa_ok", { ok: ok.length, n: rows.length }) : "…", done ? tone(ok.length, rows.length) : "") +
    fact("fa_cn", done && cn.length ? t("fa_ok", { ok: cnOk, n: cn.length }) : "…", done ? tone(cnOk, cn.length) : "") +
    fact("fa_you", l ? t({ ok: "ks_ok", answered: "ks_ans", timeout: "ks_none", blocked: "ks_blocked" }[l.k]) : "…",
      l ? { ok: "ok", answered: "warn", timeout: "bad", blocked: "" }[l.k] : "", ms);
  const steps = v.steps || [];
  $("vSteps").innerHTML = steps.slice(0, SHOWN_STEPS).map(x => `<li>${x}</li>`).join("");
  const rest = steps.slice(SHOWN_STEPS);
  $("vMore").hidden = !rest.length;
  $("vMore").querySelector("summary").textContent = t("more_steps", { n: rest.length });
  $("vMoreSteps").innerHTML = rest.map(x => `<li>${x}</li>`).join("");
  $("vMoreSteps").start = SHOWN_STEPS + 1;
}
const SHOWN_STEPS = 4;

const median = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;

function verdict(s, rows) {
  const total = REGIONS.length, port = s.t.port;
  const ips = dnsIps(s), allIps = s.t.isIp ? [s.t.host] : ips;
  const idx = r => s.rows.indexOf(r), rname = r => nameOf(REGIONS[idx(r)]);
  if (!s.gpDone && !s.gpError) return { title: t("v_wait"), sub: t("v_wait_sub", { n: rows.length, of: total }) };
  if (s.gpError && !rows.length) return { key: "v_gpoff", cls: "warn", title: t("v_gpoff"), sub: s.gpError, steps: localSteps(s, null) };
  const priv = allIps.find(ip => ipKind(ip) === "private");
  if (priv) return { key: "v_priv", cls: "bad", title: t("v_priv"), sub: t("v_priv_sub", { host: s.t.host, ip: priv }), steps: [tm("v_priv_1"), tm("v_priv_2")] };

  const steps = [];
  const cf = allIps.some(ip => ipKind(ip) === "cf");
  const ok = rows.filter(r => good(r.c, s));
  const kinds = {}; rows.filter(r => !good(r.c, s)).forEach(r => kinds[r.c.k] = (kinds[r.c.k] || 0) + 1);
  const top = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0];
  const cnRows = rows.filter(r => REGIONS[idx(r)].cn), wRows = rows.filter(r => !REGIONS[idx(r)].cn);
  const cnOk = cnRows.filter(r => good(r.c, s)).length, wOk = wRows.filter(r => good(r.c, s)).length;

  if (cf && ![...CF_HTTP, ...CF_HTTPS].includes(port)) steps.push(tm("cf_port", { http: list(CF_HTTP), https: list(CF_HTTPS), port }));
  if (!s.t.isIp && s.ipv === "6" && rows.length && rows.every(r => r.c.k === "dns")) steps.push(tm("no_aaaa"));
  for (const ip of allIps) if (["cgnat", "fakeip"].includes(ipKind(ip))) steps.push(tm("ip_" + ipKind(ip), { ip }));

  let title, cls, sub, key;
  if (ok.length === rows.length) {
    cls = "ok"; key = rows.length === total ? "v_all" : "v_all_n"; title = t(key, { n: rows.length });
    const med = median(rows.map(r => r.res.timings?.tcp).filter(x => x != null));
    sub = med != null ? t("v_all_sub", { n: rows.length, ms: med }) : t("v_all_sub2", { n: rows.length });
  } else if (!ok.length) {
    cls = "bad"; key = "n_" + (top || "other"); title = t(key); sub = L["ns_" + top] ? t("ns_" + top) : "";
    steps.push(...failSteps(top, s));
  } else if (cnRows.length && !cnOk && wOk >= wRows.length * 0.7) {
    cls = "warn"; key = "v_cnfail"; title = t(key);
    sub = t("v_cnfail_sub", { why: list([...new Set(cnRows.map(r => rowStatus(r, s)[1]))]), n: wOk });
    const cnIps = cnRows.map(r => r.res.resolvedAddress).filter(Boolean), wIps = wRows.map(r => r.res.resolvedAddress).filter(Boolean);
    const odd = !s.t.isIp && wIps.length && cnIps.find(ip => !wIps.includes(ip));   // an answer no probe abroad got
    if (odd) steps.push(tm("cn_poison", { ip: odd }));
    steps.push(tm("cn_1"), tm("cn_2"), tm("cn_3"));
  } else if (cnRows.length && cnOk === cnRows.length && !wOk) {
    cls = "warn"; key = "v_cnonly"; title = t(key); sub = t("v_cnonly_sub", { n: wRows.length });
    steps.push(tm("cnonly_1"), tm("cnonly_2"));
  } else {
    cls = "warn"; key = "v_part"; title = t(key, { ok: ok.length, n: rows.length });
    sub = t("v_part_sub", { list: list(rows.filter(r => !good(r.c, s)).map(rname)) });
    steps.push(tm("part_1"));
  }

  // Details that apply whatever the headline
  const slow = rows.filter(r => r.res.timings?.tcp > 1000);
  if (slow.length && ok.length) steps.push(tm("slow", { list: list(slow.map(rname)) }));
  const cert = rows.find(r => r.res.tls && r.res.tls.authorized === false);
  if (cert) steps.push(tm("cert_bad", { err: cert.res.tls.error || "" }));
  const exp = rows.map(r => r.res.tls?.expiresAt).find(Boolean);
  if (exp) { const days = Math.floor((new Date(exp) - Date.now()) / 864e5); if (days < 14) steps.push(days < 0 ? tm("cert_expired", { date: exp.slice(0, 10) }) : tm("cert_soon", { days, date: exp.slice(0, 10) })); }
  for (const c of new Set(rows.filter(r => r.c.k === "http5" || CF_CODES.includes(r.c.code)).map(r => r.c.code)))
    steps.push(CF_CODES.includes(c) ? tm("cf_code", { code: c, text: t(`cf${c}_l`) }) : tm("http5", { code: c }));
  if (ok.length && s.web && rows.some(r => r.c.k === "nothttp")) steps.push(tm("nothttp_web"));
  if (s.web && rows.some(r => r.c.k === "nottls")) steps.push(tm("nottls_web"));
  steps.push(...localSteps(s, ok.length ? (ok.length === rows.length ? "all" : "some") : "none"));
  return { key, ok: ok.length, n: rows.length, cls, title, sub, steps };
}

function failSteps(top, s) {
  const p = s.t.port, v6 = s.ipv === "6" || isV6(s.t.host);
  if (top === "timeout") return [tm("ft_1", { port: p }), tm("ft_2", { port: p }), tm("ft_3"), tm(v6 ? "ft_v6" : "ft_cgnat"),
    ...(ISP_BLOCKED.includes(p) ? [tm("ft_isp", { ports: list(ISP_BLOCKED), alt: p === 443 ? 52443 : 58080 })] : [])];
  if (top === "refused") return [tm("fr_1"), tm("fr_2"), tm("fr_3")];
  if (top === "dns") return [tm("fd_1"), tm("fd_2"), tm("fd_3")];
  if (top === "reset") return [tm("f_reset")];
  if (top === "tls") return [tm("f_tls")];
  if (top === "unreach") return [tm("f_unreach")];
  return [];
}

function localSteps(s, outside) {
  const l = s.local; if (!l || !outside) return [];
  if (outside === "none" && l.k === "ok") return [tm("ls_here")];      // "answered" may just be a refusal, so it proves nothing
  if (outside === "all" && l.k === "timeout") return [tm("ls_out")];
  return [];
}

// ---------- trace route from one region, on request ----------

const toggleRow = el => {
  if (el.dataset.row === "local") { state.localOpen = !state.localOpen; return drawRegions(); }
  const row = state.rows[+el.dataset.row]; if (row) { row.open = !row.open; drawRegions(); }
};
$("regions").addEventListener("click", e => { const el = e.target.closest("[data-row]"); if (el && !e.target.closest("a, button, pre")) toggleRow(el); });
$("regions").addEventListener("keydown", e => { const el = e.target.closest("[data-row]"); if (el && e.target === el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleRow(el); } });
$("regions").addEventListener("click", async e => {
  const b = e.target.closest("[data-trace]"); if (!b) return;
  const s = state, row = s.rows[+b.dataset.trace]; if (!row?.probe) return;
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
    row.trace = m.results?.[0]?.result?.rawOutput || t("trace_none");
  } catch (err) { row.trace = t("trace_fail", { msg: err.message }); }
  if (s === state) drawRegions();
});

// ---------- share: the result in a link (src/code.mjs), a card, and someone else's result shown back ----------

let recv = null;
function showOut(tg) { inviteUrl = `${location.origin}${D.paths.en}?t=${encodeURIComponent(tg.raw)}&p=${tg.port}&from=friend`; }

// What the page showed, compactly. Never the visitor's own IP.
function pack(s) {
  const v = verdict(s, s.rows.filter(r => r?.c)), n = x => x == null ? null : Math.round(x);
  return {
    t: [s.t.host, s.t.port, s.t.path, s.t.scheme, s.ipv, s.proto, s.web ? 1 : 0, s.whatKey, s.home ? 1 : 0, s.plainWeb ? 1 : 0, s.t.raw],
    ts: s.ts, v: [v.key || "v_gpoff", v.ok || 0, v.n || 0], e: s.gpError || "",
    r: s.rows.map(row => {
      if (!row?.c) return null;
      const r = row.res, p = row.probe, tg = r.timings || {};
      return [row.c.k, row.c.code || 0, [tg.dns, tg.tcp, tg.tls, tg.firstByte, tg.download, tg.total].map(n), r.status === "finished" ? 1 : 0,
        r.resolvedAddress || "", p.city || "", p.network || "", p.asn || 0, p.country || "",
        r.tls ? [r.tls.authorized ? 1 : 0, r.tls.expiresAt || "", r.tls.error || ""] : 0];
    }),
    l: s.local ? [s.local.k, n(s.local.ms), n(s.local.warm)] : 0,
    d: 0,
  };
}
function unpack(o) {
  const [host, port, path, scheme, ipv, proto, web, whatKey, home, plainWeb, raw] = o.t;
  return {
    id: ++run, shared: true, t: { host, port, path, scheme, raw: raw || host, isIp: isV4(host) || isV6(host) }, ipv, proto, web: !!web, whatKey, home: !!home,
    plainWeb: !!plainWeb, ts: o.ts, gpDone: true, gpError: o.e || "",
    rows: REGIONS.map((x, i) => {
      const a = o.r[i]; if (!a) return null;
      const [k, code, tg, fin, ip, city, network, asn, country, tls] = a, [dns, tcp, tlsT, firstByte, download, total] = tg;
      return { probe: { city, network, asn, country },
        res: { status: fin ? "finished" : "failed", statusCode: code, resolvedAddress: ip, timings: { dns, tcp, tls: tlsT, firstByte, download, total },
          tls: tls ? { authorized: !!tls[0], expiresAt: tls[1], error: tls[2] } : undefined },
        c: { k, code, tcp: tcp != null } };
    }),
    local: o.l ? { k: o.l[0], ms: o.l[1], warm: o.l[2] } : null,
  };
}
const resultLink = async s => `${location.origin}${D.paths[D.lang]}r/${await encodeResult(pack(s))}`;

// The card: the verdict and its line of numbers, then every region as a dot, its name and its total
async function shareResult() {
  const s = state, link = await resultLink(s), v = verdict(s, s.rows.filter(r => r?.c));
  const target = `${s.t.host}:${s.t.port}`;
  const COLS = 3, ROW = 46;
  const { share } = await import("/assets/share/share.js?v=7");
  share({
    lang: D.lang, name: t("app_name"), file: "reach-check", show: [], never: ["ip"],
    link: () => link, home: location.origin + D.paths[D.lang],
    text: () => `${v.title} · ${target}`,
    height: (ctx, kit) => kit.top + 150 + Math.ceil(REGIONS.length / COLS) * ROW + 40,
    foot: () => [target],
    ts: s.ts,
    draw: (ctx, kit) => {
      const { P, W, F, v: css, clip } = kit, col = c => css(c === "ok" ? "ok" : c === "warn" ? "warn" : c === "bad" ? "bad" : "muted");
      let y = kit.top;
      ctx.fillStyle = col(v.cls); ctx.font = `700 46px ${F}`; ctx.fillText(clip(ctx, v.title, W - P * 2), P, y + 10);
      ctx.fillStyle = css("muted"); ctx.font = `400 26px ${F}`; ctx.fillText(clip(ctx, v.sub || target, W - P * 2), P, y + 60);
      y += 130;
      const cw = (W - P * 2) / COLS;
      REGIONS.forEach((x, i) => {
        const row = s.rows[i], cx = P + (i % COLS) * cw, cy = y + Math.floor(i / COLS) * ROW;
        const [cls] = row?.c ? rowStatus(row, s) : ["", ""], tot = row?.c && row.res.status === "finished" ? `${row.res.timings.total} ms` : row?.c ? "✕" : "–";
        ctx.fillStyle = col(cls); ctx.beginPath(); ctx.arc(cx + 9, cy - 8, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = css("fg"); ctx.font = `500 24px ${F}`; ctx.fillText(clip(ctx, nameOf(x), cw - 150), cx + 28, cy);
        ctx.fillStyle = css("muted"); ctx.font = `500 22px ${F}`; ctx.textAlign = "right"; ctx.fillText(tot, cx + cw - 24, cy); ctx.textAlign = "left";
      });
    },
  }).open();
}
$("shareBtn").addEventListener("click", () => shareResult());

// The report dialog (shell) attaches this run, the way a link holds it: no visitor IP
window.msReport = () => state && state.gpDone ? { summary: `${verdict(state, state.rows.filter(r => r?.c)).title} · ${state.t.host}:${state.t.port}`, data: pack(state) } : null;

// ---------- start ----------

// under "from here": the visitor's own connection, checked in full by Network X-Ray
renderPresets();
loadQuota();
const sp = sharePath(location.pathname);
if (sp) {
  // someone else's result: show it as it was, under the banner that offers the visitor's own check of the same target
  decodeResult(sp.code).then(async o => {
    if (!o) return;
    state = unpack(o);
    $("target").value = state.t.raw; $("port").value = state.t.port; $("ipv").value = state.ipv;
    const p = PRESETS.find(x => x.port === state.t.port && !x.udp); $("port").dispatchEvent(new Event("input"));
    $("verdict").hidden = $("table").hidden = false; showOut(state.t);
    drawRegions(); drawVerdict();
    $("shareBtn").hidden = false;
    const { received } = await import("/assets/share/share.js?v=7");
    recv = received({ lang: D.lang, ts: state.ts, at: $("verdict"), test: () => start() });
  });
} else {
  const qs = new URLSearchParams(location.search);
  if (qs.get("t")) {
    $("target").value = qs.get("t");
    if (qs.get("p")) { $("port").value = qs.get("p"); const p = PRESETS.find(x => x.port === +qs.get("p")); $("port").dispatchEvent(new Event("input")); }
    if (qs.get("from") === "friend") start();
  }
}
})();
