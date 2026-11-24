(() => {
  // src/region.js
  var L = window.L1MS || {};
  var D = JSON.parse(document.getElementById("data").textContent);
  var $ = (id) => document.getElementById(id);
  var all = (s) => [...document.querySelectorAll(s)];
  var t = (k, v) => {
    let s = L[k] || k;
    if (v) for (const [n, x] of Object.entries(v)) s = s.split("{" + n + "}").join(x);
    return s;
  };
  var esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  var GP = "https://api.globalping.io/v1";
  var THEME = "reachcheck:theme";
  var LANG = "reachcheck:lang";
  var root = document.documentElement;
  var setTheme = (th) => {
    if (th === "light" || th === "dark") root.setAttribute("data-theme", th);
    else root.removeAttribute("data-theme");
    try {
      localStorage.setItem(THEME, th);
    } catch (e) {
    }
  };
  $("theme").onclick = () => setTheme(root.getAttribute("data-theme") === "dark" ? "light" : root.getAttribute("data-theme") === "light" ? "system" : "dark");
  $("lang").onchange = (e) => {
    const lang = e.target.value;
    try {
      localStorage.setItem(LANG, lang);
    } catch (e2) {
    }
    location.href = (D.paths[lang] || "/") + (D.suffix || "");
  };
  var run = 0;
  var target = () => {
    let s = $("target").value.trim();
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
    let u;
    try {
      u = new URL(s);
    } catch (e) {
      return null;
    }
    let host = u.hostname.replace(/^\[|\]$/g, "");
    if (!host || !/^[a-z0-9.:-]+$/i.test(host)) return null;
    const port = +($("port").value.trim() || u.port || (u.protocol === "http:" ? 80 : 443));
    if (!(port > 0 && port < 65536)) return null;
    return { host, port };
  };
  var pill = (cls, text) => `<span class="pill ${cls}">${esc(text)}</span>`;
  var statusOf = (r) => {
    if (!r) return ["m", t("rg_wait")];
    if (r.status === "in-progress") return ["m", t("rg_running")];
    if (r.status === "finished") return [r.statusCode >= 500 ? "warn" : "ok", "HTTP " + r.statusCode];
    const raw = r.rawOutput || "";
    if (/Private IP ranges are not allowed/i.test(raw)) return ["bad", t("rg_private")];
    if (/ECONNREFUSED/i.test(raw)) return ["bad", t("rg_refused")];
    if (/ETIMEDOUT|timed out/i.test(raw)) return ["bad", t("rg_timeout")];
    if (/ENOTFOUND|EAI_AGAIN|SERVFAIL|NXDOMAIN|queryA/i.test(raw)) return ["bad", t("rg_dns")];
    if (/certificate|TLS|SSL/i.test(raw)) return ["warn", t("rg_tls")];
    return ["warn", t("rg_failed")];
  };
  function draw(s) {
    const v = $("verdict");
    v.hidden = false;
    const rows = s.rows;
    $("vTitle").textContent = s.error ? t("rg_test_failed") : t("rg_result_h", { done: s.done, all: rows.length });
    $("vSub").textContent = s.error || t("rg_result_sub", { target: s.host + ":" + s.port });
    $("vDot").className = "dot " + (s.error ? "bad" : s.done < rows.length ? "" : s.ok === rows.length ? "ok" : s.ok ? "warn" : "bad");
    $("rows").innerHTML = rows.map((x, i) => {
      const [cls, label] = statusOf(x.res);
      const tm = x.res && x.res.timings && x.res.timings.total != null ? Math.round(x.res.timings.total) + " ms" : "";
      const where = x.city ? `${esc(x.city)}, ${esc(x.country || "")}` : esc(x.label || x.country || "");
      const net = x.network ? `<span class="m">${esc(x.network)}</span>` : "";
      return `<div class="rg-row" data-i="${i}"><span class="rg-where">${where} ${net}</span>${pill(cls, label)}<span class="rg-ms">${tm}</span></div>`;
    }).join("") || `<p class="m">${esc(t("rg_no_probe"))}</p>`;
  }
  async function start(ev) {
    var _a;
    ev.preventDefault();
    const tg = target();
    if (!tg) {
      $("target").focus();
      return;
    }
    const id = ++run;
    const s = {
      id,
      host: tg.host,
      port: tg.port,
      done: 0,
      ok: 0,
      error: "",
      rows: Array.from({ length: D.slots || D.locations.length }, (_, i) => {
        const l = D.locations[i] || D.locations[0] || {};
        return { country: l.country || "", city: l.city || "", label: l.label || D.countryName || "", network: "", res: null };
      })
    };
    draw(s);
    $("go").disabled = true;
    const proto = tg.port === 443 ? "HTTPS" : "HTTP";
    let j;
    try {
      const r = await fetch(GP + "/measurements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "http",
          target: tg.host,
          inProgressUpdates: true,
          locations: D.locations.map(({ label, network, ...loc }) => ({ ...loc, limit: loc.limit || 1 })),
          measurementOptions: { protocol: proto, port: tg.port, request: { method: "HEAD", path: "/" } }
        })
      });
      j = await r.json();
      if (!r.ok) throw new Error(((_a = j == null ? void 0 : j.error) == null ? void 0 : _a.message) || "HTTP " + r.status);
    } catch (e) {
      s.error = t("rg_gp_failed") + (e && e.message ? " (" + e.message + ")" : "");
      draw(s);
      $("go").disabled = false;
      return;
    }
    const t0 = Date.now();
    while (s.id === run && Date.now() - t0 < 45e3) {
      let m;
      try {
        m = await (await fetch(GP + "/measurements/" + j.id)).json();
      } catch (e) {
        await new Promise((r) => setTimeout(r, 700));
        continue;
      }
      place(s, m.results || []);
      draw(s);
      if (m.status !== "in-progress") break;
      await new Promise((r) => setTimeout(r, 700));
    }
    s.done = s.rows.filter((x) => x.res).length;
    draw(s);
    $("go").disabled = false;
  }
  function place(s, results) {
    const used = /* @__PURE__ */ new Set();
    results.forEach((res, i) => {
      const p = res.probe || {};
      let k = s.rows.findIndex((x, n) => !used.has(n) && x.country === p.country && (!x.city || x.city === p.city));
      if (k < 0) k = s.rows.findIndex((x, n) => !used.has(n) && n === i);
      if (k < 0) k = i;
      if (!s.rows[k]) s.rows[k] = { country: p.country || "", city: p.city || "", network: p.network || "", res: null };
      used.add(k);
      s.rows[k] = { ...s.rows[k], country: p.country || s.rows[k].country, city: p.city || s.rows[k].city, network: p.network || s.rows[k].network, res: res.result };
      if (res.result && res.result.status !== "in-progress" && !s.rows[k].counted) {
        s.rows[k].counted = true;
        s.done += 1;
        if (res.result.status === "finished" && res.result.statusCode < 500) s.ok += 1;
      }
    });
  }
  $("f").onsubmit = start;
  var filt = $("filter");
  if (filt) {
    const box = filt.parentElement, scope = box.dataset.scope, total = +box.dataset.total;
    const count = $("fcount"), clear = $("fclear"), nores = $("nores");
    const cards = all(".cc"), navLinks = all(".rg-nav-l a"), groups = all(".rg-nav details");
    const current = document.querySelector('.rg-nav a[aria-current="page"]');
    const currentGroup = current ? current.closest("details") : groups.find((g) => g.open);
    const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
    const hit = (el) => {
      const q = norm(filt.value);
      return !q || norm((el.dataset.n || "") + (el.dataset.e || "") + (el.dataset.c || "")).includes(q);
    };
    const apply = () => {
      let shown = 0;
      if (scope === "cards") {
        cards.forEach((el) => {
          const ok = hit(el);
          el.hidden = !ok;
          if (ok) shown++;
        });
        if (currentGroup) currentGroup.querySelectorAll(".rg-nav-l a").forEach((a) => {
          a.hidden = !hit(a);
        });
      } else {
        navLinks.forEach((a) => {
          const ok = hit(a);
          a.hidden = !ok;
          if (ok) shown++;
        });
        groups.forEach((g) => {
          g.hidden = ![...g.querySelectorAll(".rg-nav-l a")].some((a) => !a.hidden);
        });
      }
      count.textContent = shown + " / " + total;
      clear.hidden = !norm(filt.value);
      nores.hidden = shown > 0;
    };
    filt.oninput = apply;
    clear.onclick = () => {
      filt.value = "";
      apply();
      filt.focus();
    };
    document.addEventListener("keydown", (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        filt.focus();
      } else if (e.key === "Escape" && (document.activeElement === filt || filt.value)) {
        filt.value = "";
        apply();
        filt.blur();
      }
    });
    apply();
  }
  var other = document.querySelector("[data-other]");
  var pingMeta = document.querySelector('meta[name="ping"]');
  if (other && pingMeta && pingMeta.content) {
    const a = document.createElement("a");
    a.className = "xl";
    a.target = "_blank";
    a.rel = "noopener";
    a.href = pingMeta.content.replace(/\/+$/, "") + (D.paths[D.lang] || "/") + D.suffix;
    a.textContent = t("rg_other");
    other.appendChild(a);
    other.hidden = false;
  }
})();
