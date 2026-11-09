(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // public/assets/share/codec.js
  var CodecError = class extends Error {
    constructor(reason) {
      super(`codec: ${reason}`);
      this.name = "CodecError";
      this.reason = reason;
    }
  };
  var hasStream = (name) => typeof globalThis[name] === "function";
  var tryFormat = (Ctor) => {
    try {
      new Ctor("deflate-raw");
      return true;
    } catch (e) {
      return false;
    }
  };
  var deflateOk;
  var inflateOk;
  var canDeflate = () => deflateOk !== void 0 ? deflateOk : deflateOk = hasStream("CompressionStream") && tryFormat(globalThis.CompressionStream);
  var canInflate = () => inflateOk !== void 0 ? inflateOk : inflateOk = hasStream("DecompressionStream") && tryFormat(globalThis.DecompressionStream);
  var utf8 = (s) => new TextEncoder().encode(s);
  var text = (b) => new TextDecoder().decode(b);
  function b64u(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(str) {
    if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new CodecError("base64");
    const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  async function pipe(bytes, stream) {
    const out = stream.readable;
    const w = stream.writable.getWriter();
    w.write(bytes).catch(() => {
    });
    w.close().catch(() => {
    });
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  async function pack(str) {
    const raw = utf8(str);
    if (canDeflate()) {
      try {
        return "z" + b64u(await pipe(raw, new CompressionStream("deflate-raw")));
      } catch (e) {
      }
    }
    return "u" + b64u(raw);
  }
  async function unpack(code, opts) {
    const legacy = !!(opts && opts.legacy);
    const s = String(code || "");
    const kind = legacy ? "z" : s.charAt(0);
    const body = legacy ? s : s.slice(1);
    if (kind === "u") return text(unb64u(body));
    if (kind !== "z") throw new CodecError("format");
    if (!canInflate()) throw new CodecError("inflate");
    try {
      return text(await pipe(unb64u(body), new DecompressionStream("deflate-raw")));
    } catch (e) {
      throw e instanceof CodecError ? e : new CodecError("corrupt");
    }
  }

  // src/code.mjs
  var CODE_VERSION = "2";
  async function encodeResult(obj) {
    return CODE_VERSION + "~" + await pack(JSON.stringify(obj));
  }
  async function decodeResult(code) {
    const m = /^([12])~([A-Za-z0-9_-]{8,16000})$/.exec(code || "");
    if (!m) return null;
    let text2;
    try {
      text2 = await unpack(m[2], m[1] === "1" ? { legacy: true } : void 0);
    } catch (e) {
      if (e instanceof CodecError && e.reason === "inflate") throw e;
      return null;
    }
    try {
      const r = JSON.parse(text2);
      return r && Array.isArray(r.t) && typeof r.t[0] === "string" && Array.isArray(r.r) && Array.isArray(r.v) ? r : null;
    } catch (e) {
      return null;
    }
  }
  function sharePath(path) {
    const m = /^\/(?:([a-z]{2}(?:-[a-z]{2})?)\/)?r\/([^/]+)$/.exec(path);
    return m ? { slug: m[1] || "", code: m[2] } : null;
  }

  // src/app.js
  (() => {
    const GP = "https://api.globalping.io/v1";
    const API = "https://reach-api.1ms.dog:2096/v1/probe";
    const L = window.L1MS || {}, D = JSON.parse(document.getElementById("data").textContent);
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s != null ? s : "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const t = (k, v) => {
      var _a;
      let s = (_a = L[k]) != null ? _a : k;
      if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]);
      return s;
    };
    const PR = new Intl.PluralRules(D.lang), pk = (k, n) => `${k}_${PR.select(n)}` in L ? `${k}_${PR.select(n)}` : k;
    const tm = (k, v) => {
      const e = {};
      for (const x in v || {}) e[x] = esc(v[x]);
      return t(k, e).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, '<span class="mono">$1</span>');
    };
    const list = (a) => a.join(t("sep"));
    const store = { get(k) {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    }, set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (e) {
      }
    } };
    const K = { theme: "reachcheck:theme", lang: "reachcheck:lang" };
    const TH = ["system", "light", "dark"], thBtn = $("theme");
    const applyTheme = (th) => {
      if (th === "system") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", th);
      thBtn.dataset.th = th;
      thBtn.title = t("th_" + th);
      thBtn.setAttribute("aria-label", t("th_" + th));
    };
    applyTheme(TH.includes(store.get(K.theme)) ? store.get(K.theme) : "system");
    thBtn.onclick = () => {
      const n = TH[(TH.indexOf(thBtn.dataset.th) + 1) % 3];
      store.set(K.theme, n);
      applyTheme(n);
    };
    $("lang").onchange = (e) => {
      const l = e.target.value;
      store.set(K.lang, l);
      location.href = D.paths[l] + location.search;
    };
    const tool = (id) => {
      const m = document.querySelector(`meta[name="${id}"]`);
      return m && m.content ? m.content.replace(/\/+$/, "") + D.paths[D.lang] : "";
    };
    const EXT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 10v3.5H2.5V4H6"/></svg>';
    const toolLink = (id, key) => {
      const u = tool(id);
      return u ? `<a class="xl" href="${esc(u)}" target="_blank" rel="noopener">${esc(t(key))}${EXT}</a>` : "";
    };
    const ipVal = (ip) => {
      const u = tool("asn");
      return u && ["public", "cf"].includes(ipKind(ip)) ? `<a class="dv" href="${esc(u)}ip/${esc(ip)}" target="_blank" rel="noopener" title="${esc(t("lk_asn"))}">${esc(ip)}</a>` : esc(ip);
    };
    function showPing(s) {
      const u = s.udp || s.t.isIp && ["private", "cgnat"].includes(ipKind(s.t.host)) ? "" : tool("ping"), el = $("pingLink");
      el.hidden = !u;
      el.innerHTML = u ? `<a class="xl" href="${esc(u)}?t=${encodeURIComponent(s.t.host)}" target="_blank" rel="noopener">${esc(t("lk_ping"))}${EXT}</a>` : "";
    }
    const all = (s) => [...document.querySelectorAll(s)];
    const openDlg = (id) => {
      $(id).hidden = false;
      document.documentElement.style.overflow = "hidden";
      $(id).querySelector("[data-close]").focus();
    };
    const closeDlg = () => {
      all(".scrim").forEach((s) => {
        s.hidden = true;
      });
      document.documentElement.style.overflow = "";
    };
    all("[data-close]").forEach((b) => {
      b.onclick = closeDlg;
    });
    all(".scrim").forEach((s) => s.addEventListener("click", (e) => {
      if (e.target === s) closeDlg();
    }));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDlg();
    });
    let helpIdx = 0;
    const helpQs = all("#helpNav [data-hq]");
    $("helpSel").innerHTML = helpQs.map((b, i) => `<option value="${i}">${i + 1} / ${helpQs.length} \xB7 ${esc(b.textContent)}</option>`).join("");
    const showHelp = (i) => {
      helpIdx = Math.max(0, Math.min(helpQs.length - 1, i));
      helpQs.forEach((b) => b.setAttribute("aria-selected", +b.dataset.hq === helpIdx));
      all("#helpC [data-hqb]").forEach((a) => {
        a.hidden = +a.dataset.hqb !== helpIdx;
      });
      $("helpSel").value = helpIdx;
      all("[data-hstep]").forEach((b) => {
        b.disabled = helpIdx + +b.dataset.hstep < 0 || helpIdx + +b.dataset.hstep >= helpQs.length;
      });
      $("helpC").scrollTop = 0;
    };
    $("helpBtn").onclick = () => {
      showHelp(helpIdx);
      openDlg("help");
    };
    helpQs.forEach((b) => {
      b.onclick = () => showHelp(+b.dataset.hq);
    });
    $("helpSel").onchange = (e) => showHelp(+e.target.value);
    all("[data-hstep]").forEach((b) => {
      b.onclick = () => showHelp(helpIdx + +b.dataset.hstep);
    });
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
      { g: "am", cc: "BR", city: "SaoPaulo", loc: { city: "Sao Paulo" } }
    ];
    REGIONS.forEach((x) => x.cn = x.g === "cn");
    const TW = { "zh-CN": "\u4E2D\u56FD\u53F0\u6E7E", "zh-TW": "\u4E2D\u570B\u53F0\u7063", en: "Taiwan, China", ja: "\u4E2D\u56FD\u53F0\u6E7E", ko: "\uC911\uAD6D \uB300\uB9CC", es: "Taiw\xE1n, China", fr: "Ta\xEFwan, Chine", de: "Taiwan, China", pt: "Taiwan, China", ru: "\u0422\u0430\u0439\u0432\u0430\u043D\u044C, \u041A\u0438\u0442\u0430\u0439" };
    const regionName = (cc, lang) => cc === "TW" ? TW[lang] || TW.en : new Intl.DisplayNames([lang], { type: "region" }).of(cc);
    const regionOf = (cc) => {
      try {
        return regionName(cc, D.lang);
      } catch (e) {
        return cc;
      }
    };
    const nameOf = (x) => x.carrier ? t("c_" + x.carrier) : x.city ? `${regionOf(x.cc)} \xB7 ${t("city_" + x.city)}` : regionOf(x.cc);
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
      // UDP: the server sends each port the hello it is likeliest to answer (server/probe.go, hellos)
      { label: "p_quic", port: 443, udp: true },
      { label: "p_dns", port: 53, udp: true },
      { brand: "Minecraft Bedrock", port: 19132, udp: true },
      { label: "p_steam", port: 27015, udp: true },
      { brand: "Palworld", port: 8211, udp: true },
      { brand: "WireGuard", port: 51820, udp: true }
    ];
    const presetName = (p) => p.brand || t(p.label);
    const udpMode = () => $("proto").value === "udp";
    const presetOf = (port) => PRESETS.find((p) => p.port === +port && !!p.udp === udpMode());
    const BAD_PORTS = /* @__PURE__ */ new Set([
      0,
      1,
      7,
      9,
      11,
      13,
      15,
      17,
      19,
      20,
      21,
      22,
      23,
      25,
      37,
      42,
      43,
      53,
      69,
      77,
      79,
      87,
      95,
      101,
      102,
      103,
      104,
      109,
      110,
      111,
      113,
      115,
      117,
      119,
      123,
      135,
      137,
      139,
      143,
      161,
      179,
      389,
      427,
      465,
      512,
      513,
      514,
      515,
      526,
      530,
      531,
      532,
      540,
      548,
      554,
      556,
      563,
      587,
      601,
      636,
      989,
      990,
      993,
      995,
      1719,
      1720,
      1723,
      2049,
      3659,
      4045,
      4190,
      5060,
      5061,
      6e3,
      6566,
      6665,
      6666,
      6667,
      6668,
      6669,
      6679,
      6697,
      10080
    ]);
    const CF_HTTP = [80, 8080, 8880, 2052, 2082, 2086, 2095], CF_HTTPS = [443, 2053, 2083, 2087, 2096, 8443];
    const CF_V4 = [
      "173.245.48.0/20",
      "103.21.244.0/22",
      "103.22.200.0/22",
      "103.31.4.0/22",
      "141.101.64.0/18",
      "108.162.192.0/18",
      "190.93.240.0/20",
      "188.114.96.0/20",
      "197.234.240.0/22",
      "198.41.128.0/17",
      "162.158.0.0/15",
      "104.16.0.0/13",
      "104.24.0.0/14",
      "172.64.0.0/13",
      "131.0.72.0/22"
    ];
    const CF_CODES = [520, 521, 522, 523, 524, 525, 526, 530];
    const ISP_BLOCKED = [80, 443, 8080, 8443];
    const LOCAL_TIMEOUT = 1e4;
    const ip4n = (ip) => ip.split(".").reduce((a, b) => a * 256 + +b, 0);
    const isV4 = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
    const isV6 = (s) => s.includes(":") && /^[0-9a-f:.]+$/i.test(s);
    const inCidr = (ip, cidr) => {
      const [n, b] = cidr.split("/");
      const m = 2 ** (32 - b);
      return Math.floor(ip4n(ip) / m) === Math.floor(ip4n(n) / m);
    };
    function ipKind(ip) {
      if (isV4(ip)) {
        if (["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16"].some((c) => inCidr(ip, c))) return "private";
        if (inCidr(ip, "100.64.0.0/10")) return "cgnat";
        if (inCidr(ip, "198.18.0.0/15")) return "fakeip";
        if (CF_V4.some((c) => inCidr(ip, c))) return "cf";
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
    function parseTarget(raw, portField) {
      let s = raw.trim(), scheme = "", path = "/", host = "", port = 0;
      const m = s.match(/^([a-z]+):\/\//i);
      if (m) {
        scheme = m[1].toLowerCase();
        try {
          const u = new URL(s);
          host = u.hostname.replace(/^\[|\]$/g, "");
          port = +u.port || (scheme === "https" ? 443 : 80);
          path = u.pathname + u.search;
        } catch {
          return null;
        }
      } else {
        s = s.replace(/\/.*$/, (p) => {
          path = p;
          return "";
        });
        const b = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
        if (b) {
          host = b[1];
          port = +b[2] || 0;
        } else if (isV6(s)) host = s;
        else {
          const [h, p] = s.split(":");
          host = h;
          port = +p || 0;
        }
      }
      if (+portField) port = +portField;
      host = host.toLowerCase();
      if (!host || !(isV4(host) || isV6(host) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\.?$/i.test(host))) return null;
      return { host, port, path: path || "/", scheme, isIp: isV4(host) || isV6(host) };
    }
    let preset = PRESETS[0], run = 0, state;
    const ports = () => PRESETS.filter((p) => !!p.udp === udpMode());
    let portActive = -1, portTyped = false;
    function renderPresets() {
      const each = ports(), v = portTyped ? $("port").value.trim() : "", shown = each.filter((p) => !v || String(p.port).startsWith(v) || +v === p.port);
      const list2 = shown.length ? shown : each;
      portActive = Math.min(portActive, list2.length - 1);
      $("portList").innerHTML = list2.map((p, i) => `<li role="option" id="po${i}" data-port="${p.port}" aria-selected="${i === portActive}"><b>${p.port}</b><span>${esc(presetName(p))}</span></li>`).join("");
      $("port").setAttribute("aria-activedescendant", portActive >= 0 ? "po" + portActive : "");
    }
    const portOpen = (open) => {
      $("portList").hidden = !open;
      $("port").setAttribute("aria-expanded", open);
      if (open) {
        portActive = -1;
        portTyped = false;
        renderPresets();
      }
    };
    const pickPort = (port) => {
      $("port").value = port;
      portOpen(false);
      $("port").dispatchEvent(new Event("input"));
    };
    $("port").addEventListener("input", (e) => {
      preset = presetOf($("port").value) || null;
      $("portNote").textContent = preset ? presetName(preset) : "";
      if (!$("portList").hidden && e.isTrusted) {
        portTyped = true;
        renderPresets();
      }
    });
    $("proto").addEventListener("change", () => {
      renderPresets();
      $("port").dispatchEvent(new Event("input"));
    });
    $("port").addEventListener("focus", () => portOpen(true));
    $("port").addEventListener("click", () => portOpen(true));
    $("portBtn").addEventListener("click", () => {
      portOpen($("portList").hidden);
      $("port").focus();
    });
    $("port").addEventListener("keydown", (e) => {
      var _a;
      const items = [...$("portList").children];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if ($("portList").hidden) portOpen(true);
        portActive = (portActive + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        renderPresets();
        (_a = $("po" + portActive)) == null ? void 0 : _a.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && !$("portList").hidden && portActive >= 0) {
        e.preventDefault();
        pickPort(items[portActive].dataset.port);
      } else if (e.key === "Escape") {
        if (!$("portList").hidden) e.preventDefault();
        portOpen(false);
      } else if (e.key === "Tab") portOpen(false);
    });
    $("portList").addEventListener("mousedown", (e) => {
      const li = e.target.closest("li[data-port]");
      if (li) {
        e.preventDefault();
        pickPort(li.dataset.port);
      }
    });
    document.addEventListener("pointerdown", (e) => {
      if (!e.target.closest(".combo")) portOpen(false);
    });
    async function loadQuota() {
      try {
        const j = await (await fetch(GP + "/limits")).json();
        showQuota(j.rateLimit.measurements.create.remaining, j.rateLimit.measurements.create.reset);
      } catch {
        $("quota").textContent = "";
      }
    }
    function showQuota(left, reset) {
      if (state) state.quota = { left, reset };
      const cost = REGIONS.length;
      $("quota").textContent = left >= cost ? t(pk("quota_ok", left), { left, cost }) : t("quota_out", { min: Math.ceil(reset / 60) });
    }
    let inviteUrl = "";
    $("inviteBtn").title = t("invite_tip");
    $("inviteBtn").addEventListener("click", () => {
      var _a;
      const b = $("inviteBtn");
      (_a = navigator.clipboard) == null ? void 0 : _a.writeText(inviteUrl).then(
        () => {
          b.textContent = t("copied");
          setTimeout(() => b.textContent = t("b_invite"), 1500);
        },
        () => prompt(t("invite_tip"), inviteUrl)
      );
    });
    $("f").addEventListener("submit", (e) => {
      e.preventDefault();
      start();
    });
    function start() {
      const raw = $("target").value.trim();
      const tg = parseTarget(raw, $("port").value);
      if (!tg) {
        $("portNote").textContent = t("bad_target");
        return;
      }
      tg.raw = raw;
      if (!tg.port) tg.port = (preset == null ? void 0 : preset.port) || 443;
      const udp = udpMode();
      const pr = PRESETS.find((p) => p.port === tg.port && !p.udp);
      const proto = tg.scheme === "https" ? "HTTPS" : tg.scheme === "http" ? "HTTP" : pr ? pr.proto : [443, 8443, 5001].includes(tg.port) ? "HTTPS" : "HTTP";
      const web = tg.scheme ? true : pr ? pr.web : true;
      const id = ++run;
      state = {
        id,
        t: tg,
        proto,
        web,
        whatKey: (pr == null ? void 0 : pr.what) || "",
        home: !!(pr == null ? void 0 : pr.home),
        plainWeb: proto === "HTTP" && web && (!!pr || tg.scheme === "http"),
        ipv: $("ipv").value,
        rows: REGIONS.map(() => null),
        gpDone: false,
        local: null,
        srv: null,
        udp,
        quota: state == null ? void 0 : state.quota,
        ts: Date.now()
      };
      if (recv) {
        recv.remove();
        recv = null;
      }
      const q = `?t=${encodeURIComponent(raw)}&p=${tg.port}${udp ? "&u=1" : ""}`;
      history.replaceState(null, "", D.paths[D.lang] + q);
      $("verdict").hidden = $("table").hidden = false;
      $("go").disabled = true;
      showOut(tg);
      $("shareBtn").hidden = true;
      $("inviteBtn").hidden = udp;
      drawRegions();
      drawVerdict();
      showPing(state);
      const jobs = udp ? [runServer(state)] : [runGlobalping(state), runLocal(state), runServer(state)];
      Promise.allSettled(jobs).then(() => {
        if (state.id === id) {
          $("go").disabled = false;
          drawVerdict();
          $("shareBtn").hidden = udp;
          if (!udp) loadQuota();
        }
      });
    }
    async function runServer(s) {
      const q = new URLSearchParams({ host: s.t.host, port: s.t.port });
      if (s.udp) q.set("mode", "udp");
      if (!s.t.isIp) q.set("ipv", s.ipv);
      const c = new AbortController(), timer = setTimeout(() => c.abort(), 3e4);
      try {
        s.srv = await (await fetch(`${API}?${q}`, { signal: c.signal, credentials: "omit", cache: "no-store" })).json();
      } catch {
        s.srv = { k: "down" };
      } finally {
        clearTimeout(timer);
      }
      if (s === state) {
        drawRegions();
        drawVerdict();
      }
    }
    const SVC = {
      ssh: "SSH",
      smtp: "SMTP",
      ftp: "FTP",
      pop3: "POP3",
      imap: "IMAP",
      mysql: "MySQL",
      redis: "Redis",
      vnc: "VNC",
      http: "HTTP",
      telnet: "Telnet",
      rsync: "rsync",
      amqp: "AMQP"
    };
    const svcName = (v) => SVC[v.svc] || v.svc;
    const srvPrivIp = (v) => {
      var _a;
      return (v == null ? void 0 : v.k) === "private" ? ((_a = (v.addrs || []).find((a) => a.kind !== "public")) == null ? void 0 : _a.ip) || "" : "";
    };
    function srvStatus(v, s) {
      var _a, _b;
      const min = Math.ceil((v.retry || 60) / 60);
      if (s.udp && v.k === "answered") return ["ok", t("pl_answered"), v.via ? t("su_answered", { via: t("via_" + v.via) }) : t("su_answered_x")];
      if (s.udp && v.k === "closed") return ["bad", t("pl_closed"), t("su_closed")];
      if (s.udp && v.k === "silent") return ["warn", t("pl_silent"), t("su_silent")];
      switch (v.k) {
        case "banner":
          return v.svc ? ["ok", svcName(v), t("sv_banner", { svc: svcName(v) })] : ["ok", t("pl_open"), t("sv_banner_x")];
        case "tls":
          return [((_a = v.tls) == null ? void 0 : _a.ok) ? "ok" : "warn", ((_b = v.tls) == null ? void 0 : _b.version) || "TLS", t("sv_tls")];
        case "tlsfail":
          return ["warn", t("pl_tls"), t("sv_tlsfail", { err: v.err || "" })];
        case "http":
          return ["ok", "HTTP", t("sv_http")];
        case "answer":
          return ["ok", t("pl_open"), t("sv_answer")];
        case "silent":
          return ["ok", t("pl_open"), t("sv_silent")];
        case "closed":
          return ["warn", t("pl_reset"), t("sv_closed")];
        case "refused":
        case "timeout":
        case "unreach":
        case "dns":
        case "other":
          return ["bad", t("pl_" + v.k), t("st_" + v.k)];
        case "private":
          return ["bad", t("pl_priv"), t("sv_priv")];
        case "limit":
          return ["m", t("pl_limit"), t(v.which === "dest" ? "sv_limit_dest" : v.which === "visitor" || v.which === "targets" ? "sv_limit" : "sv_limit_site", { min })];
      }
      return ["m", t("pl_limit"), t("sv_down")];
    }
    async function runGlobalping(s) {
      var _a;
      const opts = { protocol: s.proto, port: s.t.port, request: { method: "HEAD", path: s.t.path.split("?")[0] || "/" } };
      if (s.t.path.includes("?")) opts.request.query = s.t.path.split("?")[1];
      if (!s.t.isIp) opts.ipVersion = +s.ipv;
      let r, j;
      try {
        r = await fetch(GP + "/measurements", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "http", target: s.t.host, inProgressUpdates: true, locations: REGIONS.map((x) => ({ ...x.loc, limit: 1 })), measurementOptions: opts })
        });
        j = await r.json();
      } catch {
        return gpFail(s, t("gp_unreach"));
      }
      const reset = +r.headers.get("x-ratelimit-reset");
      if (r.headers.get("x-ratelimit-remaining") != null) showQuota(+r.headers.get("x-ratelimit-remaining"), reset);
      if (r.status === 429) return gpFail(s, t("gp_429", { min: Math.ceil((reset || 3600) / 60) }));
      if (!r.ok) return gpFail(s, t("gp_err", { msg: ((_a = j == null ? void 0 : j.error) == null ? void 0 : _a.message) || r.status }));
      const t0 = Date.now();
      while (s.id === run && Date.now() - t0 < 45e3) {
        await new Promise((res) => setTimeout(res, 700));
        let m;
        try {
          m = await (await fetch(`${GP}/measurements/${j.id}`)).json();
        } catch {
          continue;
        }
        place(s, m.results || []);
        drawRegions();
        drawVerdict();
        if (m.status !== "in-progress") break;
      }
      s.gpDone = true;
      drawRegions();
      drawVerdict();
    }
    function gpFail(s, msg) {
      s.gpDone = true;
      s.gpError = msg;
      drawRegions();
      drawVerdict();
    }
    function place(s, results) {
      const used = /* @__PURE__ */ new Set();
      const fits = (loc, p) => Object.entries(loc).every(([k, v]) => k === "city" ? p.city === v : k === "asn" ? p.asn === v : p[k] === v);
      results.forEach((res, i) => {
        let k = REGIONS.findIndex((x, n) => !used.has(n) && n === i && fits(x.loc, res.probe));
        if (k < 0) k = REGIONS.findIndex((x, n) => !used.has(n) && fits(x.loc, res.probe));
        if (k < 0) k = i;
        used.add(k);
        s.rows[k] = { ...s.rows[k], probe: res.probe, res: res.result, c: res.result.status === "in-progress" ? null : classify(res.result) };
      });
    }
    function classify(r) {
      var _a;
      const raw = r.rawOutput || "";
      if (r.status === "finished") return { k: r.statusCode >= 500 ? "http5" : "ok", code: r.statusCode };
      const k = /Private IP ranges are not allowed/i.test(raw) ? "priv" : /ECONNREFUSED/.test(raw) ? "refused" : /establishing the TCP connection|connect ETIMEDOUT/i.test(raw) ? "timeout" : /ENOTFOUND|EAI_AGAIN|ENODATA|SERVFAIL|NXDOMAIN|query(A|Aaaa)/i.test(raw) ? "dns" : /EHOSTUNREACH|ENETUNREACH/.test(raw) ? "unreach" : /does not match the HTTP|Expected HTTP|Parse Error/i.test(raw) ? "nothttp" : /wrong version number|packet length too long|unknown protocol/i.test(raw) ? "nottls" : /ECONNRESET|socket hang up|other side closed/i.test(raw) ? "reset" : /certificate|CERT_|self[- ]signed|altnames|unable to verify|handshake|ssl|tls alert/i.test(raw) ? "tls" : /timed out/i.test(raw) ? "slow" : "other";
      return { k, raw, tcp: ((_a = r.timings) == null ? void 0 : _a.tcp) != null };
    }
    const REACHED = /* @__PURE__ */ new Set(["ok", "http5", "nothttp", "nottls", "tls", "reset"]);
    const openish = (c, s) => !s.web && (c.k === "nothttp" || c.k === "nottls" || c.k === "reset" && c.tcp);
    const good = (c, s) => c && (c.k === "ok" || openish(c, s));
    const BAD = { refused: "bad", timeout: "bad", dns: "bad", unreach: "bad", reset: "bad", tls: "warn", slow: "warn", priv: "bad", other: "bad" };
    function rowStatus(row, s) {
      const c = row.c, r = row.res;
      if (c.k === "ok" || c.k === "http5") {
        const certBad = r.tls && r.tls.authorized === false;
        const parts = [t("st_http", { code: c.code })];
        if (CF_CODES.includes(c.code)) parts.push(t(`cf${c.code}_s`));
        if (certBad) parts.push(t("st_certbad"));
        return [c.k === "http5" || certBad ? "warn" : "ok", parts.join(" \xB7 ")];
      }
      if (c.k === "nothttp") return s.web ? ["warn", t("st_open_web")] : ["ok", s.whatKey ? t("st_open_what", { what: t(s.whatKey) }) : t("st_open")];
      if (c.k === "nottls") return s.web ? ["warn", t("st_nottls_web")] : ["ok", t("st_open")];
      if (openish(c, s)) return ["ok", t("st_open")];
      return [BAD[c.k] || "bad", t("st_" + c.k)];
    }
    function pillOf(row, s) {
      const c = row.c;
      if (c.k === "ok" || c.k === "http5") return t("st_http", { code: c.code });
      if (c.k === "nothttp") return t(s.web ? "pl_web" : "pl_open");
      if (c.k === "nottls") return t(s.web ? "pl_nottls" : "pl_open");
      if (openish(c, s)) return t("pl_open");
      return t("pl_" + c.k);
    }
    async function runLocal(s) {
      const { host, port, path } = s.t;
      if (BAD_PORTS.has(port)) {
        s.local = { k: "blocked" };
        return drawLocal();
      }
      const url = `https://${isV6(host) ? `[${host}]` : host}:${port}${path.startsWith("/") ? path : "/" + path}`;
      const once = async () => {
        const c = new AbortController(), timer = setTimeout(() => c.abort(), LOCAL_TIMEOUT), t0 = performance.now();
        try {
          await fetch(url, { mode: "no-cors", cache: "no-store", credentials: "omit", signal: c.signal });
          return { ok: true, ms: performance.now() - t0 };
        } catch {
          return { ok: false, timeout: c.signal.aborted, ms: performance.now() - t0 };
        } finally {
          clearTimeout(timer);
        }
      };
      const a = await once();
      if (!a.ok) {
        s.local = { k: a.timeout ? "timeout" : "answered", ms: a.ms };
        return drawLocal();
      }
      const b = await once();
      s.local = { k: "ok", ms: a.ms, warm: b.ok ? b.ms : null };
      drawLocal();
    }
    const dnsIps = (s) => [...new Set(s.rows.map((r) => {
      var _a;
      return (_a = r == null ? void 0 : r.res) == null ? void 0 : _a.resolvedAddress;
    }).filter(Boolean))];
    const failStage = (k) => ({ dns: "fs_dns", refused: "fs_refused", timeout: "fs_timeout", unreach: "fs_unreach", reset: "fs_reset", tls: "fs_tls", nothttp: "fs_nothttp", nottls: "fs_nottls", slow: "fs_slow" })[k];
    const SCALE_MS = 3e3;
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
    const dot = (cls, text2, busy) => `<span class="sdot ${cls}${busy ? " blink" : ""}" role="img" title="${esc(text2)}" aria-label="${esc(text2)}"></span>`;
    function drawRegions() {
      const s = state;
      let html = "", g = "", first = true;
      $("table").classList.toggle("udp", !!s.udp);
      $("tblH").textContent = t(s.udp ? "h_srv" : "h_regions");
      if (s.udp) {
        $("regions").innerHTML = srvRow(s);
        sizeBars();
        $("gpProgress").textContent = "";
        $("gpNote").hidden = true;
        return;
      }
      const span = (r) => r.res.status === "finished" ? r.res.timings.total : (r.res.timings.dns || 0) + r.res.timings.tcp + (r.res.timings.tls || 0);
      const drawn = (r) => {
        var _a;
        return (r == null ? void 0 : r.c) && REACHED.has(r.c.k) && ((_a = r.res.timings) == null ? void 0 : _a.tcp) != null;
      };
      const tcps = s.rows.filter((r) => {
        var _a;
        return (r == null ? void 0 : r.c) && ((_a = r.res.timings) == null ? void 0 : _a.tcp) != null;
      }).map((r) => r.res.timings.tcp).sort((a, b) => a - b);
      const tcpMed = tcps[Math.floor(tcps.length / 2)] || 0;
      REGIONS.forEach((x, i) => {
        if (first) {
          first = false;
          html += localRow(s) + (s.shared && !s.srv ? "" : srvRow(s));
        }
        if (x.g !== g) {
          g = x.g;
          html += `<div class="grp">${esc(t("g_" + g))}</div>`;
        }
        const row = s.rows[i];
        let pl = dot("m", t("r_queue"), true), bar = `<div class="bar"></div>`, tot = `<span class="rg-tot wait">\u2013</span>`, more = "", hot = false;
        if (!(row == null ? void 0 : row.probe) && (s.gpError || s.gpDone)) pl = dot("m", t(s.gpError ? "r_notrun" : "r_noprobe"));
        if ((row == null ? void 0 : row.probe) && !row.c) pl = dot("m", t("r_testing"), true);
        if (row == null ? void 0 : row.c) {
          const p = row.probe, tg = row.res.timings || {}, [cls, text2] = rowStatus(row, s);
          hot = tg.tcp > 1e3 && tg.tcp > tcpMed * 3;
          pl = dot(cls, pillOf(row, s) + (hot ? " \xB7 " + t("hot_tip") : ""));
          if (drawn(row)) {
            bar = barOf([[tg.dns, "s-dns"], [tg.tcp, "s-tcp"], [tg.tls, "s-tls"], [tg.firstByte, "s-fb"], [tg.download, "s-dl"]]);
            tot = `<span class="rg-tot">${span(row)}<small class="m"> ms</small></span>`;
          } else {
            bar = `<div class="bar fail"></div>`;
            tot = `<span class="rg-tot wait">${tg.total != null ? `${(tg.total / 1e3).toFixed(1)}<small> s</small>` : "\u2715"}</span>`;
          }
          if (row.open) {
            const segs = [["sg_dns", tg.dns], ["sg_tcp", tg.tcp, hot], ["sg_tls", tg.tls], ["sg_fb", tg.firstByte], ["sg_dl", tg.download]].filter(([, v]) => v != null).map(([n2, v, h]) => `<span${h ? ` class="hot" title="${esc(t("hot_tip"))}"` : ""}>${esc(t(n2))} ${v} ms</span>`).join(" \xB7 ");
            const where = [p.city, p.network].filter(Boolean).map(esc).join(" \xB7 ") + (row.res.resolvedAddress ? ` \u2192 ${ipVal(row.res.resolvedAddress)}` : "");
            const stage = row.res.status !== "finished" && !good(row.c, s) && failStage(row.c.k) ? esc(t(failStage(row.c.k))) + " \xB7 " : "";
            more = `<div class="rg-more"><p class="${cls}" title="${esc(row.c.raw || "")}">${esc(text2)}</p><p class="m">${where}</p><p class="segs">${stage}${segs} <button type="button" class="link trace" data-trace="${i}"${row.trace === "" ? " disabled" : ""}>${esc(t(row.trace === "" ? "tracing" : "trace"))}</button></p>` + (row.trace ? `<pre class="tr">${esc(row.trace)}</pre>` : "") + `</div>`;
          }
        }
        const can = !!(row == null ? void 0 : row.c);
        html += `<div class="rg${(row == null ? void 0 : row.open) ? " open" : ""}"${can ? ` data-row="${i}" role="button" tabindex="0" aria-expanded="${!!row.open}"` : ""}><span class="rg-name">${can ? '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>' : '<i class="chev"></i>'}${esc(nameOf(x))}</span>${pl}${bar}${tot}${more}</div>`;
      });
      $("regions").innerHTML = html;
      sizeBars();
      const n = s.rows.filter((r) => r == null ? void 0 : r.c).length;
      $("gpProgress").textContent = s.gpError ? "" : `${n} / ${REGIONS.length}`;
      $("gpNote").hidden = !s.gpError;
      $("gpNote").innerHTML = s.gpError ? `<span class="st-warn">${esc(s.gpError)}</span>` : "";
    }
    const sizeBars = () => {
      for (const el of $("regions").querySelectorAll("[data-w]")) el.style.width = el.dataset.w + "%";
    };
    const chev = (can) => can ? '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>' : '<i class="chev"></i>';
    function srvRow(s) {
      var _a, _b;
      const v = s.srv;
      let pl = dot("m", t("r_testing"), true), bar = `<div class="bar"></div>`, tot = `<span class="rg-tot wait">\u2013</span>`, more = "";
      if (v) {
        const [cls, short, text2] = srvStatus(v, s);
        pl = dot(cls, short);
        const total = s.udp ? v.ms : v.tcp != null ? v.tcp + (v.tlsMs || 0) : null;
        if (total != null) {
          bar = s.udp ? barOf([[v.ms, "s-fb"]]) : barOf([[v.tcp, "s-tcp"], [v.tlsMs, "s-tls"]]);
          tot = `<span class="rg-tot">${total}<small class="m"> ms</small></span>`;
        } else if (!["limit", "down", "bad"].includes(v.k)) bar = `<div class="bar fail"></div>`;
        if (s.srvOpen) {
          const p = [`<p class="${cls === "m" ? "" : cls}">${esc(text2)}</p>`];
          for (const said of [v.banner, v.detail]) if (said) p.push(`<p class="mono sv-said">${esc(said)}</p>`);
          const x = v.tls;
          if (x) {
            p.push(`<p class="segs">${[x.version, x.alpn && "ALPN " + x.alpn, x.cipher].filter(Boolean).map(esc).join(" \xB7 ")}</p>`);
            p.push(`<p class="${x.ok ? "ok" : "warn"}">${esc(t("tr_" + (x.ok ? "ok" : x.problem || "invalid"), { err: x.err || "" }))}</p>`);
            if ((_a = x.names) == null ? void 0 : _a.length) p.push(`<p class="m">${esc(t("sv_names", { names: list(x.names) }))}</p>`);
            if ((_b = x.chain) == null ? void 0 : _b.length) p.push(`<ol class="chain">${x.chain.map((c) => `<li>${esc(c.subject)} <span class="m">\xB7 ${esc(t("sv_by", { issuer: c.issuer }))} \xB7 ${esc(t("sv_until", { date: c.until }))}</span></li>`).join("")}</ol>`);
          }
          const ips = v.ip ? [v.ip] : (v.addrs || []).map((a) => a.ip);
          if (ips.length) p.push(`<p class="m">${esc(t("city_Tokyo"))} \u2192 ${ips.map(ipVal).join(esc(t("sep")))}${v.cached ? " \xB7 " + esc(t("sv_cached")) : ""}</p>`);
          more = `<div class="rg-more">${p.join("")}</div>`;
        }
      }
      const can = !!v;
      return (s.udp ? "" : `<div class="grp">${esc(t("h_srv"))}</div>`) + `<div class="rg${s.srvOpen ? " open" : ""}"${can ? ` data-row="srv" role="button" tabindex="0" aria-expanded="${!!s.srvOpen}"` : ""}><span class="rg-name">${chev(can)}${esc(t("r_srv"))}</span>${pl}${bar}${tot}${more}</div>`;
    }
    function drawLocal() {
      drawRegions();
      drawVerdict();
    }
    function localRow(s) {
      const l = s.local, ms = (v) => `${Math.round(v)} ms`;
      let pl = dot("m", t("r_testing"), true), bar = `<div class="bar"></div>`, tot = `<span class="rg-tot wait">\u2013</span>`, more = "";
      if (l) {
        const setup = l.k === "ok" && l.warm != null ? Math.max(0, l.ms - l.warm) : null;
        const cls = { ok: "ok", answered: "warn", timeout: "bad", blocked: "m" }[l.k];
        pl = dot(cls, t({ ok: "ks_ok", answered: "ks_ans", timeout: "ks_none", blocked: "ks_blocked" }[l.k]));
        if (l.k === "ok") {
          bar = setup != null ? barOf([[setup, "s-setup"], [l.warm, "s-fb"]]) : barOf([[l.ms, "s-setup"]]);
        } else if (l.k !== "blocked") bar = `<div class="bar fail"></div>`;
        if (l.k === "ok" || l.k === "answered") tot = `<span class="rg-tot">${Math.round(l.ms)}<small class="m"> ms</small></span>`;
        else if (l.k === "timeout") tot = `<span class="rg-tot wait">${(LOCAL_TIMEOUT / 1e3).toFixed(1)}<small> s</small></span>`;
        if (s.localOpen) {
          const url = `https://${isV6(s.t.host) ? `[${s.t.host}]` : s.t.host}:${s.t.port}`;
          const tao = esc(t("lc_tao")).replace("{h}", '<span class="mono">Timing-Allow-Origin: *</span>');
          const body = l.k === "ok" ? `<p class="ok">${esc(t("lc_ok"))}</p><p class="segs">${esc(t("lc_first"))} ${ms(l.ms)}` + (setup != null ? ` \xB7 ${esc(t("lc_setup"))} \u2248 ${ms(setup)} \xB7 ${esc(t("lc_req"))} ${ms(l.warm)}` : "") + `</p><p class="m">${tao}</p>` : l.k === "answered" ? `<p class="warn">${esc(t("lc_ans"))}</p><p class="m">${esc(t("lc_ans_p"))}${s.plainWeb ? " " + esc(t("lc_plain")) : ""}</p>` : l.k === "timeout" ? `<p class="bad">${esc(t("lc_none"))}</p><p class="m">${esc(t("lc_none_p", { url }))}</p>` : `<p>${esc(t("lc_blocked"))}</p><p class="m">${esc(t("lc_blocked_p", { port: s.t.port }))}</p>`;
          const links = [toolLink("check", "lk_check"), toolLink("ipv6", "lk_ipv6")].filter(Boolean).join(" ");
          more = `<div class="rg-more">${body}${links ? `<p class="links">${links}</p>` : ""}</div>`;
        }
      }
      const can = !!l;
      return `<div class="grp">${esc(t("h_local"))}</div><div class="rg${s.localOpen ? " open" : ""}"${can ? ` data-row="local" role="button" tabindex="0" aria-expanded="${!!s.localOpen}"` : ""}><span class="rg-name">${can ? '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>' : '<i class="chev"></i>'}${esc(t("r_browser"))}</span>${pl}${bar}${tot}${more}</div>`;
    }
    function drawVerdict() {
      const s = state;
      const v = verdict(s, s.rows.filter((r) => r == null ? void 0 : r.c));
      $("vDot").className = "dot " + (v.cls || "");
      $("vTitle").textContent = v.title;
      $("vSub").textContent = v.sub || "\xA0";
      const rows = s.rows.filter((r) => r == null ? void 0 : r.c), done = s.gpDone || s.gpError;
      const cn = rows.filter((r) => REGIONS[s.rows.indexOf(r)].cn), ok = rows.filter((r) => good(r.c, s));
      const tone = (a, n) => !n ? "" : a === n ? "ok" : a ? "warn" : "bad";
      const cnOk = cn.filter((r) => good(r.c, s)).length, l = s.local;
      const ms = (l == null ? void 0 : l.k) === "ok" || (l == null ? void 0 : l.k) === "answered" ? ` <span class="m">\xB7 ${esc(t("lc_first"))} ${Math.round(l.ms)} ms</span>` : "";
      const fact = (label, val, cls, extra = "") => `<div class="fact"><span class="fl">${esc(t(label))}</span><span class="fv"><b class="${cls}">${esc(val)}</b>${extra}</span></div>`;
      $("kpis").hidden = !!s.udp;
      $("kpis").innerHTML = fact("fa_world", done && rows.length ? t(pk("fa_ok", ok.length), { ok: ok.length, n: rows.length }) : "\u2026", done ? tone(ok.length, rows.length) : "") + fact("fa_cn", done && cn.length ? t(pk("fa_ok", cnOk), { ok: cnOk, n: cn.length }) : "\u2026", done ? tone(cnOk, cn.length) : "") + fact(
        "fa_you",
        l ? t({ ok: "ks_ok", answered: "ks_ans", timeout: "ks_none", blocked: "ks_blocked" }[l.k]) : "\u2026",
        l ? { ok: "ok", answered: "warn", timeout: "bad", blocked: "" }[l.k] : "",
        ms
      );
      const steps = v.steps || [];
      $("vSteps").innerHTML = steps.slice(0, SHOWN_STEPS).map((x) => `<li>${x}</li>`).join("");
      const rest = steps.slice(SHOWN_STEPS);
      $("vMore").hidden = !rest.length;
      $("vMore").querySelector("summary").textContent = t(pk("more_steps", rest.length), { n: rest.length });
      $("vMoreSteps").innerHTML = rest.map((x) => `<li>${x}</li>`).join("");
      $("vMoreSteps").start = SHOWN_STEPS + 1;
    }
    const SHOWN_STEPS = 4;
    const median = (a) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
    function verdict(s, rows) {
      var _a, _b, _c;
      if (s.udp) return udpVerdict(s);
      const total = REGIONS.length, port = s.t.port;
      const ips = dnsIps(s), allIps = s.t.isIp ? [s.t.host] : ips;
      const idx = (r) => s.rows.indexOf(r), rname = (r) => nameOf(REGIONS[idx(r)]);
      if (!s.gpDone && !s.gpError) return { title: t("v_wait"), sub: t(pk("v_wait_sub", rows.length), { n: rows.length, of: total }) };
      if (s.gpError && !rows.length) return { key: "v_gpoff", cls: "warn", title: t("v_gpoff"), sub: s.gpError, steps: localSteps(s, null) };
      const priv = allIps.find((ip) => ipKind(ip) === "private") || srvPrivIp(s.srv);
      if (priv || rows.some((r) => r.c.k === "priv")) return privVerdict(s, priv);
      const steps = [];
      const cf = allIps.some((ip) => ipKind(ip) === "cf");
      const ok = rows.filter((r) => good(r.c, s));
      const kinds = {};
      rows.filter((r) => !good(r.c, s)).forEach((r) => kinds[r.c.k] = (kinds[r.c.k] || 0) + 1);
      const top = (_a = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]) == null ? void 0 : _a[0];
      const cnRows = rows.filter((r) => REGIONS[idx(r)].cn), wRows = rows.filter((r) => !REGIONS[idx(r)].cn);
      const cnOk = cnRows.filter((r) => good(r.c, s)).length, wOk = wRows.filter((r) => good(r.c, s)).length;
      if (cf && ![...CF_HTTP, ...CF_HTTPS].includes(port)) steps.push(tm("cf_port", { http: list(CF_HTTP), https: list(CF_HTTPS), port }));
      if (!s.t.isIp && s.ipv === "6" && rows.length && rows.every((r) => r.c.k === "dns")) steps.push(tm("no_aaaa"));
      for (const ip of allIps) if (["cgnat", "fakeip"].includes(ipKind(ip))) steps.push(tm("ip_" + ipKind(ip), { ip }));
      let title, cls, sub, key;
      if (ok.length === rows.length) {
        cls = "ok";
        key = rows.length === total ? "v_all" : "v_all_n";
        title = t(pk(key, rows.length), { n: rows.length });
        const med = median(rows.map((r) => {
          var _a2;
          return (_a2 = r.res.timings) == null ? void 0 : _a2.tcp;
        }).filter((x) => x != null));
        sub = med != null ? t(pk("v_all_sub", rows.length), { n: rows.length, ms: med }) : t(pk("v_all_sub2", rows.length), { n: rows.length });
      } else if (!ok.length) {
        cls = "bad";
        key = "n_" + (top || "other");
        title = t(key);
        sub = L["ns_" + top] ? t("ns_" + top) : "";
        steps.push(...failSteps(top, s));
      } else if (cnRows.length && !cnOk && wOk >= wRows.length * 0.7) {
        cls = "warn";
        key = "v_cnfail";
        title = t(key);
        sub = t(pk("v_cnfail_sub", wOk), { why: list([...new Set(cnRows.map((r) => rowStatus(r, s)[1]))]), n: wOk });
        const cnIps = cnRows.map((r) => r.res.resolvedAddress).filter(Boolean), wIps = wRows.map((r) => r.res.resolvedAddress).filter(Boolean);
        const odd = !s.t.isIp && wIps.length && cnIps.find((ip) => !wIps.includes(ip));
        if (odd) steps.push(tm("cn_poison", { ip: odd }));
        steps.push(tm("cn_1"), tm("cn_2"), tm("cn_3"));
      } else if (cnRows.length && cnOk === cnRows.length && !wOk) {
        cls = "warn";
        key = "v_cnonly";
        title = t(key);
        sub = t(pk("v_cnonly_sub", wRows.length), { n: wRows.length });
        steps.push(tm("cnonly_1"), tm("cnonly_2"));
      } else {
        cls = "warn";
        key = "v_part";
        title = t(pk(key, ok.length), { ok: ok.length, n: rows.length });
        sub = t("v_part_sub", { list: list(rows.filter((r) => !good(r.c, s)).map(rname)) });
        steps.push(tm("part_1"));
      }
      const slow = rows.filter((r) => {
        var _a2;
        return ((_a2 = r.res.timings) == null ? void 0 : _a2.tcp) > 1e3;
      });
      if (slow.length && ok.length) steps.push(tm("slow", { list: list(slow.map(rname)) }));
      const sv = s.srv, pb = (sv == null ? void 0 : sv.tls) && !sv.tls.ok ? sv.tls.problem : "";
      if ((sv == null ? void 0 : sv.svc) && sv.banner && (sv.svc !== "http" || !s.web)) steps.push(tm("sv_step_svc", { svc: svcName(sv), banner: sv.banner }));
      if (pb === "chain") steps.push(tm("sv_step_chain"));
      else if (pb === "name") steps.push(tm("sv_step_name", { names: list(sv.tls.names || []), host: s.t.host }));
      else if (pb === "self") steps.push(tm("sv_step_self"));
      const cert = rows.find((r) => r.res.tls && r.res.tls.authorized === false);
      if (cert && !["chain", "name", "self"].includes(pb)) steps.push(tm("cert_bad", { err: cert.res.tls.error || "" }));
      else if (!cert && (pb === "untrusted" || pb === "invalid")) steps.push(tm("cert_bad", { err: sv.tls.err || "" }));
      const exp = rows.map((r) => {
        var _a2;
        return (_a2 = r.res.tls) == null ? void 0 : _a2.expiresAt;
      }).find(Boolean);
      if (!exp && pb === "expired") steps.push(tm("cert_expired", { date: ((_c = (_b = sv.tls.chain) == null ? void 0 : _b[0]) == null ? void 0 : _c.until) || "" }));
      if (exp) {
        const days = Math.floor((new Date(exp) - Date.now()) / 864e5);
        if (days < 14) steps.push(days < 0 ? tm("cert_expired", { date: exp.slice(0, 10) }) : tm(pk("cert_soon", days), { days, date: exp.slice(0, 10) }));
      }
      for (const c of new Set(rows.filter((r) => r.c.k === "http5" || CF_CODES.includes(r.c.code)).map((r) => r.c.code)))
        steps.push(CF_CODES.includes(c) ? tm("cf_code", { code: c, text: t(`cf${c}_l`) }) : tm("http5", { code: c }));
      if (ok.length && s.web && rows.some((r) => r.c.k === "nothttp")) steps.push(tm("nothttp_web"));
      if (s.web && rows.some((r) => r.c.k === "nottls")) steps.push(tm("nottls_web"));
      steps.push(...localSteps(s, ok.length ? ok.length === rows.length ? "all" : "some" : "none"));
      return { key, ok: ok.length, n: rows.length, cls, title, sub, steps };
    }
    function privVerdict(s, ip) {
      const k = ip ? ipKind(ip) : "", first = ["cgnat", "fakeip"].includes(k) ? [tm("ip_" + k, { ip })] : [];
      return {
        key: "v_priv",
        cls: "bad",
        title: t("v_priv"),
        sub: ip ? t("v_priv_sub", { host: s.t.host, ip }) : t("v_priv_sub2", { host: s.t.host }),
        steps: [...first, tm("v_priv_1"), tm("v_priv_2")]
      };
    }
    function udpVerdict(s) {
      const v = s.srv, port = s.t.port;
      if (!v) return { title: t("v_wait"), sub: t("v_wait_srv") };
      if (v.k === "answered") return { key: "u_ok", cls: "ok", title: t("u_ok"), sub: t("u_ok_sub", { ms: v.ms }), steps: [tm("u_ok_1")] };
      if (v.k === "closed") return { key: "u_closed", cls: "bad", title: t("u_closed"), sub: t("u_closed_sub", { port }), steps: [tm("u_closed_1", { port }), tm("u_closed_2")] };
      if (v.k === "silent") return { key: "u_silent", cls: "warn", title: t("u_silent"), sub: t("u_silent_sub", { port }), steps: [tm("u_silent_1"), tm("u_silent_2"), tm("u_silent_3")] };
      if (v.k === "private") return privVerdict(s, srvPrivIp(v));
      if (v.k === "dns") return { key: "n_dns", cls: "bad", title: t("n_dns"), sub: "", steps: [tm("fd_1"), tm("fd_2"), tm("fd_3")] };
      return { key: "u_none", cls: "warn", title: t("u_none"), sub: srvStatus(v, s)[2] };
    }
    function failSteps(top, s) {
      const p = s.t.port, v6 = s.ipv === "6" || isV6(s.t.host);
      if (top === "timeout") return [
        tm("ft_1", { port: p }),
        tm("ft_2", { port: p }),
        tm("ft_3"),
        tm(v6 ? "ft_v6" : "ft_cgnat"),
        ...ISP_BLOCKED.includes(p) ? [tm("ft_isp", { ports: list(ISP_BLOCKED), alt: p === 443 ? 52443 : 58080 })] : []
      ];
      if (top === "refused") return [tm("fr_1"), tm("fr_2"), tm("fr_3")];
      if (top === "dns") return [tm("fd_1"), tm("fd_2"), tm("fd_3")];
      if (top === "reset") return [tm("f_reset")];
      if (top === "tls") return [tm("f_tls")];
      if (top === "unreach") return [tm("f_unreach")];
      return [];
    }
    function localSteps(s, outside) {
      const l = s.local;
      if (!l || !outside) return [];
      if (outside === "none" && l.k === "ok") return [tm("ls_here")];
      if (outside === "all" && l.k === "timeout") return [tm("ls_out")];
      return [];
    }
    const toggleRow = (el) => {
      if (el.dataset.row === "local") {
        state.localOpen = !state.localOpen;
        return drawRegions();
      }
      if (el.dataset.row === "srv") {
        state.srvOpen = !state.srvOpen;
        return drawRegions();
      }
      const row = state.rows[+el.dataset.row];
      if (row) {
        row.open = !row.open;
        drawRegions();
      }
    };
    $("regions").addEventListener("click", (e) => {
      const el = e.target.closest("[data-row]");
      if (el && !e.target.closest("a, button, pre")) toggleRow(el);
    });
    $("regions").addEventListener("keydown", (e) => {
      const el = e.target.closest("[data-row]");
      if (el && e.target === el && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        toggleRow(el);
      }
    });
    $("regions").addEventListener("click", async (e) => {
      var _a, _b, _c, _d;
      const b = e.target.closest("[data-trace]");
      if (!b) return;
      const s = state, row = s.rows[+b.dataset.trace];
      if (!(row == null ? void 0 : row.probe)) return;
      row.trace = "";
      drawRegions();
      const p = row.probe;
      try {
        const r = await fetch(GP + "/measurements", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "mtr",
            target: s.t.host,
            locations: [{ country: p.country, city: p.city, asn: p.asn, limit: 1 }],
            measurementOptions: { protocol: "TCP", port: s.t.port, packets: 3, ...s.t.isIp ? {} : { ipVersion: +s.ipv } }
          })
        });
        const j = await r.json();
        if (!r.ok) throw new Error(((_a = j == null ? void 0 : j.error) == null ? void 0 : _a.message) || r.status);
        let m;
        for (let k = 0; k < 60; k++) {
          await new Promise((res) => setTimeout(res, 1e3));
          m = await (await fetch(`${GP}/measurements/${j.id}`)).json();
          if (m.status !== "in-progress") break;
        }
        row.trace = ((_d = (_c = (_b = m.results) == null ? void 0 : _b[0]) == null ? void 0 : _c.result) == null ? void 0 : _d.rawOutput) || t("trace_none");
      } catch (err) {
        row.trace = t("trace_fail", { msg: err.message });
      }
      if (s === state) drawRegions();
    });
    let recv = null;
    function showOut(tg) {
      inviteUrl = `${location.origin}${D.paths.en}?t=${encodeURIComponent(tg.raw)}&p=${tg.port}&from=friend`;
    }
    function pack2(s) {
      const v = verdict(s, s.rows.filter((r) => r == null ? void 0 : r.c)), n = (x) => x == null ? null : Math.round(x);
      return {
        t: [s.t.host, s.t.port, s.t.path, s.t.scheme, s.ipv, s.proto, s.web ? 1 : 0, s.whatKey, s.home ? 1 : 0, s.plainWeb ? 1 : 0, s.t.raw],
        ts: s.ts,
        v: [v.key || "v_gpoff", v.ok || 0, v.n || 0],
        e: s.gpError || "",
        r: s.rows.map((row) => {
          if (!(row == null ? void 0 : row.c)) return null;
          const r = row.res, p = row.probe, tg = r.timings || {};
          return [
            row.c.k,
            row.c.code || 0,
            [tg.dns, tg.tcp, tg.tls, tg.firstByte, tg.download, tg.total].map(n),
            r.status === "finished" ? 1 : 0,
            r.resolvedAddress || "",
            p.city || "",
            p.network || "",
            p.asn || 0,
            p.country || "",
            r.tls ? [r.tls.authorized ? 1 : 0, r.tls.expiresAt || "", r.tls.error || ""] : 0
          ];
        }),
        l: s.local ? [s.local.k, n(s.local.ms), n(s.local.warm)] : 0,
        d: 0,
        s: srvPack(s.srv)
      };
    }
    function srvPack(v) {
      if (!v || ["limit", "down", "bad"].includes(v.k)) return 0;
      const { host, port, mode, cached, which, retry, ...rest } = v;
      return rest;
    }
    function unpack2(o) {
      const [host, port, path, scheme, ipv, proto, web, whatKey, home, plainWeb, raw] = o.t;
      return {
        id: ++run,
        shared: true,
        t: { host, port, path, scheme, raw: raw || host, isIp: isV4(host) || isV6(host) },
        ipv,
        proto,
        web: !!web,
        whatKey,
        home: !!home,
        plainWeb: !!plainWeb,
        ts: o.ts,
        gpDone: true,
        gpError: o.e || "",
        rows: REGIONS.map((x, i) => {
          const a = o.r[i];
          if (!a) return null;
          const [k, code, tg, fin, ip, city, network, asn, country, tls] = a, [dns, tcp, tlsT, firstByte, download, total] = tg;
          return {
            probe: { city, network, asn, country },
            res: {
              status: fin ? "finished" : "failed",
              statusCode: code,
              resolvedAddress: ip,
              timings: { dns, tcp, tls: tlsT, firstByte, download, total },
              tls: tls ? { authorized: !!tls[0], expiresAt: tls[1], error: tls[2] } : void 0
            },
            c: { k, code, tcp: tcp != null }
          };
        }),
        local: o.l ? { k: o.l[0], ms: o.l[1], warm: o.l[2] } : null,
        srv: o.s || null
      };
    }
    const resultLink = async (s) => `${location.origin}${D.paths[D.lang]}r/${await encodeResult(pack2(s))}`;
    const cardName = (x) => x.carrier ? t("c_" + x.carrier) : x.city && REGIONS.filter((r) => r.cc === x.cc && !r.carrier).length > 1 ? `${t("city_" + x.city)}, ${x.cc}` : regionOf(x.cc);
    const ROW = 46, TOT_W = 110;
    function cardLayout(ctx, kit, v, target) {
      const { W, P, F, fit, wrap } = kit, w = W - P * 2;
      let ts = fit(ctx, v.title, w, 46, 34), title = [v.title];
      if (ctx.measureText(v.title).width > w) {
        ts = 40;
        ctx.font = `700 40px ${F}`;
        title = wrap(ctx, v.title, w, 2);
      }
      ctx.font = `600 28px ${F}`;
      const tw = ctx.measureText(target + "   ").width;
      ctx.font = `400 26px ${F}`;
      const inline = v.sub && tw + ctx.measureText(v.sub).width <= w, sub = v.sub && !inline ? wrap(ctx, v.sub, w, 3) : [];
      const names = REGIONS.map(cardName);
      let cols = 1, ns = 24;
      out: for (const c of [3, 2]) for (const z of [24, 22]) {
        ctx.font = `500 ${z}px ${F}`;
        if (names.every((n) => ctx.measureText(n).width <= w / c - 28 - TOT_W)) {
          cols = c;
          ns = z;
          break out;
        }
      }
      const tY = kit.top + 24, lineY = tY + (title.length - 1) * Math.round(ts * 1.2) + 52;
      const gridY = lineY + sub.length * 36 + 70;
      return { title, ts, inline, sub, names, cols, ns, tY, lineY, gridY, H: gridY + Math.ceil(REGIONS.length / cols) * ROW + 60 };
    }
    async function shareResult() {
      const s = state, link = await resultLink(s), v = verdict(s, s.rows.filter((r) => r == null ? void 0 : r.c));
      const target = `${s.t.host}:${s.t.port}`;
      const { share } = await import("/assets/share/share.js?v=9");
      share({
        lang: D.lang,
        name: t("app_name"),
        file: "reach-check",
        show: [],
        never: ["ip"],
        link: () => link,
        home: location.origin + D.paths[D.lang],
        text: () => `${v.title} \xB7 ${target}`,
        height: (ctx, kit) => cardLayout(ctx, kit, v, target).H,
        ts: s.ts,
        draw: (ctx, kit) => {
          const { P, W, F, v: css, clip } = kit, col = (c) => css(c === "ok" ? "ok" : c === "warn" ? "warn" : c === "bad" ? "bad" : "muted");
          const L2 = cardLayout(ctx, kit, v, target);
          ctx.fillStyle = col(v.cls);
          ctx.font = `700 ${L2.ts}px ${F}`;
          L2.title.forEach((line, i) => ctx.fillText(line, P, L2.tY + i * Math.round(L2.ts * 1.2)));
          ctx.fillStyle = css("fg");
          ctx.font = `600 28px ${F}`;
          ctx.fillText(clip(ctx, target, W - P * 2), P, L2.lineY);
          const tw = ctx.measureText(target + "   ").width;
          ctx.fillStyle = css("muted");
          ctx.font = `400 26px ${F}`;
          if (L2.inline) ctx.fillText(v.sub, P + tw, L2.lineY);
          L2.sub.forEach((line, i) => ctx.fillText(line, P, L2.lineY + (i + 1) * 36));
          const cw = (W - P * 2) / L2.cols;
          REGIONS.forEach((x, i) => {
            const row = s.rows[i], cx = P + i % L2.cols * cw, cy = L2.gridY + Math.floor(i / L2.cols) * ROW;
            const [cls] = (row == null ? void 0 : row.c) ? rowStatus(row, s) : ["", ""], tot = (row == null ? void 0 : row.c) && row.res.status === "finished" ? `${row.res.timings.total} ms` : (row == null ? void 0 : row.c) ? "\u2715" : "\u2013";
            ctx.fillStyle = col(cls);
            ctx.beginPath();
            ctx.arc(cx + 9, cy - 8, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = css("fg");
            ctx.font = `500 ${L2.ns}px ${F}`;
            ctx.fillText(clip(ctx, L2.names[i], cw - 28 - TOT_W), cx + 28, cy);
            ctx.fillStyle = css("muted");
            ctx.font = `500 22px ${F}`;
            ctx.textAlign = "right";
            ctx.fillText(tot, cx + cw - 24, cy);
            ctx.textAlign = "left";
          });
        }
      }).open();
    }
    $("shareBtn").addEventListener("click", () => shareResult());
    window.msReport = () => state && state.gpDone ? { summary: `${verdict(state, state.rows.filter((r) => r == null ? void 0 : r.c)).title} \xB7 ${state.t.host}:${state.t.port}`, data: pack2(state) } : null;
    renderPresets();
    loadQuota();
    const sp = sharePath(location.pathname);
    if (sp) {
      decodeResult(sp.code).catch(() => {
        $("verdict").hidden = false;
        $("vDot").className = "dot warn";
        $("inviteBtn").hidden = true;
        $("vTitle").textContent = t("v_oldbrowser");
        $("vSub").textContent = t("v_oldbrowser_sub");
      }).then(async (o) => {
        if (!o) return;
        state = unpack2(o);
        $("target").value = state.t.raw;
        $("port").value = state.t.port;
        $("ipv").value = state.ipv;
        $("proto").value = "tcp";
        $("port").dispatchEvent(new Event("input"));
        $("verdict").hidden = $("table").hidden = false;
        showOut(state.t);
        drawRegions();
        drawVerdict();
        showPing(state);
        $("shareBtn").hidden = false;
        const { received } = await import("/assets/share/share.js?v=9");
        recv = received({ lang: D.lang, ts: state.ts, at: $("verdict"), test: () => start() });
      });
    } else {
      const qs = new URLSearchParams(location.search);
      if (qs.get("t")) {
        $("target").value = qs.get("t");
        if (qs.get("u") === "1") $("proto").value = "udp";
        if (qs.get("p")) {
          $("port").value = qs.get("p");
          $("port").dispatchEvent(new Event("input"));
        }
        if (qs.get("from") === "friend") start();
      }
    }
  })();
})();
