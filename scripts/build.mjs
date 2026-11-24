#!/usr/bin/env node
// Builds the static site in public/ from src/:
//   index.html, <lang>/index.html                the page per language
//   assets/app.<hash>.js, assets/app.<hash>.css  the page's code and styles, shared by every language
//   assets/l.<lang>.<hash>.js                    the strings the browser code needs, per language
//   sitemap.xml, robots.txt, llms.txt, _headers  SEO and security headers
// No dependencies: the code and styles are copied as they are.
// Usage: node scripts/build.mjs          write the files
//        node scripts/build.mjs --check  exit 1 if anything in public/ is out of date (CI)
import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";

const SITE = (process.env.SITE_URL || "https://reach.1ms.dog").replace(/\/+$/, "");
const pub = new URL("../public/", import.meta.url), src = new URL("../src/", import.meta.url);
// language, URL folder, og:locale; the first is the root
export const LANGS = [["en", "", "en_US"], ["zh-CN", "zh-cn", "zh_CN"], ["zh-TW", "zh-tw", "zh_TW"], ["ja", "ja", "ja_JP"], ["ko", "ko", "ko_KR"],
  ["es", "es", "es_ES"], ["fr", "fr", "fr_FR"], ["de", "de", "de_DE"], ["pt", "pt", "pt_BR"], ["ru", "ru", "ru_RU"]];

// Runs before first paint: apply the saved theme. On the English page, send visitors to their language's (a saved
// choice first, then the browser languages), keeping the query (an invite link's target); crawlers and English readers stay.
const PREPAINT = `(function(){var d=document.documentElement,th=null,s=null;try{th=localStorage.getItem("reachcheck:theme");s=localStorage.getItem("reachcheck:lang")}catch(e){}if(th==="light"||th==="dark")d.setAttribute("data-theme",th);if(!d.hasAttribute("data-root"))return;var P=JSON.parse(d.getAttribute("data-paths")||"{}"),l=null;try{var q=new URLSearchParams(location.search).get("lang");if(P[q])l=q}catch(e){}if(!l&&P[s])l=s;for(var ls=navigator.languages||[navigator.language||"en"],i=0;!l&&!s&&i<ls.length;i++){var x=String(ls[i]).toLowerCase(),b=x.split("-")[0];l=b==="zh"?(/tw|hk|mo|hant/.test(x)?"zh-TW":"zh-CN"):P[b]?b:null}if(l&&l!=="en"&&location.pathname===P.en)location.replace(P[l]+location.search+location.hash)})();`;

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hash = s => createHash("sha256").update(s).digest("hex").slice(0, 10);
const sha = s => createHash("sha256").update(s).digest("base64");

export async function loadI18n() {
  const out = {};
  for (const f of (await readdir(new URL("i18n/", src))).filter(f => f.endsWith(".mjs")))
    out[f.slice(0, -4)] = (await import(new URL("i18n/" + f, src).href + "?" + Date.now())).default;
  return out;
}

// Strings only the build uses (the page already shows them); everything else goes to the browser. A key the page's code
// reads at runtime must not be here (strings.test.mjs checks that): drawRegions() writes h_regions into the table's
// heading after every check, so it ships.
export const BUILD_ONLY = new Set(["name", "seo_title", "seo_desc", "seo_kw", "og_sub", "h1", "intro", "lang_label", "f_target", "f_target_ph", "f_port", "f_ipv",
  "go", "lg_dns", "lg_tcp", "lg_tls", "lg_fb", "lg_dl", "a_theme", "docs", "faq_h", "a_close", "a_prev", "a_next",
  "src_gp", "src_dns", "foot_src",
  // country and continent pages
  "rg_crumbs", "rg_nav", "rg_start", "rg_single", "rg_cities_h", "rg_about_h", "home_countries", "rg_h1", "rg_title", "rg_desc", "rg_intro", "rg_stats_h", "rg_line", "rg_few", "rg_neighbors_h", "rg_data",
  "L_probes", "L_cities", "L_home", "L_networks", "L_continent", "L_countries", "ct_eu", "ct_na", "ct_as", "ct_sa", "ct_oc", "ct_af",
  "ct_h1", "ct_title", "ct_desc", "ct_intro", "ct_about_h", "ct_countries_h",
  "ct_note_eu", "ct_note_na", "ct_note_as", "ct_note_sa", "ct_note_oc", "ct_note_af"]);

// Data sources named in the page link to their sites
const SOURCES = { gp: ["Globalping", "https://globalping.io"] };
const links = s => esc(s).replace(/\{(\w+)\}/g, (m, k) => SOURCES[k] ? `<a href="${SOURCES[k][1]}" target="_blank" rel="noopener">${SOURCES[k][0]}</a>` : m);

const pathOf = slug => "/" + (slug ? slug + "/" : "");

// ---------- country and continent pages (docs/regions.md in 1ms.dog) ----------
const TWNAME = { "zh-CN": "中国台湾", "zh-TW": "中國台灣", en: "Taiwan, China", ja: "中国台湾", ko: "중국 대만", es: "Taiwán, China", fr: "Taïwan, Chine", de: "Taiwan, China", pt: "Taiwan, China", ru: "Тайвань, Китай" };
const cname = (cc, lang) => cc === "TW" ? (TWNAME[lang] || TWNAME.en) : (() => { try { return new Intl.DisplayNames([lang], { type: "region" }).of(cc) || cc; } catch (e) { return cc; } })();
const contName = (code, T) => T("ct_" + code.toLowerCase());
const pctOf = c => Math.round((c.eyeball / c.probes) * 100);
// URL slugs, fixed for both tools (docs/regions.md): /<lang>/<continent>[/<country>]/
const CONT_SLUG = { EU: "europe", NA: "north-america", AS: "asia", SA: "south-america", OC: "oceania", AF: "africa" };

// Hand-written network notes (no Globalping inventory numbers on any page). Public reviews these five samples before
// the remaining countries are written.
const NOTES_FILE = JSON.parse(await readFile(new URL("regions-notes.json", src), "utf8"));
const NOTES = {};
const NOTE_LANG = { "zh-CN": "zh" };
const noteOf = (cc, lang) => { const n = NOTES_FILE.notes && NOTES_FILE.notes[cc]; return (n && (n[NOTE_LANG[lang] || lang])) || ""; };

const cityName = (n, d) => { const k = "city_" + String(n).replace(/[^A-Za-z]/g, ""); return k in d ? d[k] : n; };
const flag = cc => "/flags/" + (cc === "TW" ? "cn" : cc.toLowerCase()) + ".svg";

function crumbs(items) {
  return items.map((x, i) => i === items.length - 1
    ? `<span aria-current="page">${esc(x.name)}</span>`
    : `<a href="${x.href}">${esc(x.name)}</a><span class="crumb-sep" aria-hidden="true">›</span>`).join("");
}

function regionNav(regions, lang, base, current, T, skip) {
  const globe = `<p class="rg-nav-h"><span role="img" aria-label="${esc(T("rg_nav"))}"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4M8 1.8c1.8 1.7 2.7 3.8 2.7 6.2S9.8 12.5 8 14.2C6.2 12.5 5.3 10.4 5.3 8S6.2 3.5 8 1.8z"/></svg></span>${esc(T("rg_nav"))}</p>`;
  return globe + regions.continents.filter(c => c.code !== skip).map(c => `<div class="rg-nav-g"><a class="rg-nav-t" href="${base}${CONT_SLUG[c.code]}/" aria-label="${esc(T("ct_countries_h").replace("{continent}", contName(c.code, T)))}">${esc(contName(c.code, T))}<span class="m">${c.countries.length}</span></a><div class="rg-nav-l">${
    c.countries.map(x => `<a href="${base}${CONT_SLUG[c.code]}/${x.cc.toLowerCase()}/" data-n="${esc(cname(x.cc, lang))}" data-e="${esc(cname(x.cc, "en"))}" data-c="${x.cc}"${x.cc === current ? ' aria-current="page"' : ""}><img src="${flag(x.cc)}" alt="" width="16" height="12" loading="lazy">${esc(cname(x.cc, lang))}</a>`).join("")
  }</div></div>`).join("");
}

export async function build({ check = false } = {}) {
  const I = await loadI18n(), en = I.en;
  const langs = LANGS.filter(([l]) => I[l]);
  for (const [l] of langs) for (const k of Object.keys(en)) if (!(k in I[l])) throw new Error(`i18n/${l}.mjs is missing "${k}"`);
  const tpl = await readFile(new URL("page.html", src), "utf8");

  // the page's code, with the result-link code it imports (src/code.mjs and 1ms.dog's codec, shared with the Worker),
  // as one script for ES2019 browsers: Chrome 70 and Safari 13 era in-app browsers can't parse ?. or ??, and one
  // unparsable token stops the whole page. The share dialog (/assets/share/share.js) stays out: loaded when needed.
  // (Safari 13, not 12: for 12 esbuild rewrites template literals into .concat(), which 1ms-shell's check reads for
  // the sister-tool links, `meta[name="${id}"]`; ?. and ?? are gone either way)
  const js = (await bundle({ entryPoints: [fileURLToPath(new URL("app.js", src))], bundle: true, format: "iife",
    target: ["es2019", "chrome70", "safari13", "firefox68", "edge79"], legalComments: "none", write: false,
    external: ["/assets/share/share.js*"] })).outputFiles[0].text;
  const css = (await readFile(new URL("fonts.css", src), "utf8")) + "\n" + await readFile(new URL("base.css", src), "utf8") + "\n" + await readFile(new URL("style.css", src), "utf8");
  const jsName = `app.${hash(js)}.js`, cssName = `app.${hash(css)}.css`;
  const files = { ["assets/" + jsName]: js, ["assets/" + cssName]: css };

  const regions = JSON.parse(await readFile(new URL("regions.json", src), "utf8"));
  const stringsName = {};
  for (const [lang, slug, locale] of langs) {
    const d = I[lang], T = k => { if (!(k in d)) throw new Error(`i18n/${lang}.mjs has no "${k}"`); return d[k]; };
    const strings = Object.fromEntries(Object.keys(en).filter(k => !BUILD_ONLY.has(k)).map(k => [k, T(k)]));
    const sjs = `window.L1MS=${JSON.stringify(strings).replace(/</g, "\\u003c")};\n`;
    const sName = `l.${lang.toLowerCase()}.${hash(sjs)}.js`;
    stringsName[lang] = sName;
    files["assets/" + sName] = sjs;

    const url = SITE + pathOf(slug), title = T("seo_title"), desc = T("seo_desc");
    const alts = langs.map(([l, sl]) => `<link rel="alternate" hreflang="${l}" href="${SITE + pathOf(sl)}">`).join("\n") + `\n<link rel="alternate" hreflang="x-default" href="${SITE}/">`;
    const docs = T("docs").map(([q, a]) => ({ q, h: a.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join(""), t: a.replace(/\n+/g, " ") }));
    const faq = { "@type": "FAQPage", mainEntity: docs.map(x => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.t } })) };
    const app = { "@type": "WebApplication", name: T("app_name") + " · 1ms.dog", url, applicationCategory: "UtilitiesApplication",
      operatingSystem: "Any", browserRequirements: "Requires JavaScript", description: desc, inLanguage: lang, isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } };
    const graph = { "@context": "https://schema.org", "@graph": [app, faq] };
    const head = [
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(desc)}">`,
      `<meta name="keywords" content="${esc(T("seo_kw"))}">`,
      `<meta name="robots" content="index, follow">`,
      `<meta name="application-name" content="${esc(T("app_name"))}">`,
      `<meta name="theme-color" content="#f6f6f7" media="(prefers-color-scheme: light)">`,
      `<meta name="theme-color" content="#1c1c1c" media="(prefers-color-scheme: dark)">`,
      `<link rel="canonical" href="${url}">`, alts,
      `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="1ms.dog">`,
      `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(T("og_sub"))}">`, `<meta property="og:url" content="${url}">`,
      `<meta property="og:locale" content="${locale}">`,
      `<link rel="icon" href="/favicon.ico" sizes="any">`, `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">`,
      `<meta property="og:image" content="${SITE}/og/${lang.toLowerCase()}.png">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`,
      `<meta property="og:image:alt" content="${esc(title)}">`,
      `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:image" content="${SITE}/og/${lang.toLowerCase()}.png">`,
      `<meta name="twitter:title" content="${esc(title)}">`, `<meta name="twitter:description" content="${esc(T("og_sub"))}">`,
      `<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, "\\u003c")}</script>`,
    ].join("\n");

    const allCountries = regions.continents.flatMap(c => c.countries.map(x => ({ ...x, cont: c.code })));
    const group = c => `<div class="rg-nav-g"><a class="rg-nav-t" href="${pathOf(slug)}${CONT_SLUG[c.code]}/" aria-label="${esc(T("ct_countries_h").replace("{continent}", contName(c.code, T)))}">${esc(contName(c.code, T))}<span class="m">${c.countries.length}</span></a><div class="rg-nav-l">${
      c.countries.map(x => `<a href="${pathOf(slug)}${CONT_SLUG[c.code]}/${x.cc.toLowerCase()}/" data-n="${esc(cname(x.cc, lang))}" data-e="${esc(cname(x.cc, "en"))}" data-c="${x.cc}"><img src="${flag(x.cc)}" alt="" width="16" height="12" loading="lazy">${esc(cname(x.cc, lang))}</a>`).join("")
    }</div></div>`;
    const countryIndex = `<section class="card sec country-index">
  <h2>${esc(T("home_countries"))}</h2>
  <div class="rg-filter" data-total="${allCountries.length}" data-scope="home">
    <input id="countryFilter" type="search" placeholder="${esc(T("rg_filter"))}" aria-label="${esc(T("rg_filter"))}" autocomplete="off" spellcheck="false">
    <span class="m" id="cfCount">${allCountries.length} / ${allCountries.length}</span>
    <button class="link" id="cfClear" type="button" hidden>${esc(T("rg_clear"))}</button>
  </div>
  ${regions.continents.map(group).join("")}
  <p class="m rg-nores" id="cfNores" hidden>${esc(T("rg_no_match"))}</p>
</section>`;
    const helpNav = docs.map((x, i) => `<button type="button" role="tab" data-hq="${i}" aria-selected="${i === 0}">${esc(x.q)}</button>`).join("");
    const helpC = docs.map((x, i) => `<article data-hqb="${i}"${i ? " hidden" : ""}><h3>${esc(x.q)}</h3>${x.h}</article>`).join("");
    const langOpts = langs.map(([l]) => `<option value="${l}"${l === lang ? " selected" : ""}>${esc(I[l].name)}</option>`).join("");
    const paths = Object.fromEntries(langs.map(([l, sl]) => [l, pathOf(sl)]));
    const html = tpl
      .replace(/(<(\w+)\b[^>]*\sdata-i="(\w+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tag, k, inner, close) => open + esc(T(k)) + close)
      .replace(/\{\{a:(\w+)\}\}/g, (m, k) => esc(T(k)))   // translated attribute values (aria-label, placeholders)
      .replace("{{lang}}", lang).replace("{{pathsAttr}}", esc(JSON.stringify(paths))).replace("{{rootAttr}}", slug ? "" : " data-root")
      .replace("{{prepaint}}", PREPAINT).replace("{{head}}", head).replace("{{css}}", cssName).replace("{{js}}", jsName).replace("{{strings}}", sName)
      .replace("{{homeHref}}", pathOf(slug)).replace("{{appName}}", esc(T("app_name"))).replace("{{langOpts}}", langOpts).replace("{{h1}}", esc(T("h1")))
      .replace("{{helpNav}}", helpNav).replace("{{helpC}}", helpC)
      .replace("{{srcGp}}", links(T("src_gp"))).replace("{{footSrc}}", links(T("foot_src")))
      .replace("{{countryIndex}}", countryIndex)
      .replace("{{data}}", JSON.stringify({ lang, paths }).replace(/</g, "\\u003c"));
    if (/\{\{[\w:]+\}\}/.test(html)) throw new Error("unfilled placeholder in " + pathOf(slug) + ": " + /\{\{[\w:]+\}\}/.exec(html)[0]);
    files[pathOf(slug).slice(1) + "index.html"] = html;
  }

  // ---------- country and continent pages ----------
  const rtpl = await readFile(new URL("region.html", src), "utf8");
  const rjs = (await bundle({ entryPoints: [fileURLToPath(new URL("region.js", src))], bundle: true, format: "iife",
    target: ["es2019", "chrome70", "safari13", "firefox68", "edge79"], legalComments: "none", write: false })).outputFiles[0].text;
  const rjsName = `region.${hash(rjs)}.js`;
  files["assets/" + rjsName] = rjs;
  const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : m));
  const pathsOf = () => Object.fromEntries(langs.map(([l, sl]) => [l, pathOf(sl)]));
  const sitemapExtra = [];

  for (const [lang, slug, locale] of langs) {
    const d = I[lang], T = k => { if (!(k in d)) throw new Error(`i18n/${lang}.mjs has no "${k}"`); return d[k]; };
    const base = pathOf(slug), paths = pathsOf();
    const langOpts = langs.map(([l]) => `<option value="${l}"${l === lang ? " selected" : ""}>${esc(I[l].name)}</option>`).join("");
    const altLinks = tail => langs.map(([l, sl]) => `<link rel="alternate" hreflang="${l}" href="${SITE + pathOf(sl) + tail}">`).join("\n") +
      `\n<link rel="alternate" hreflang="x-default" href="${SITE}/${tail}">`;
    const headFor = (tail, title, desc, ld) => {
      const url = SITE + base + tail;
      return [
        `<title>${esc(title)}</title>`,
        `<meta name="description" content="${esc(desc)}">`,
        `<meta name="robots" content="index, follow">`,
        `<meta name="theme-color" content="#f6f6f7" media="(prefers-color-scheme: light)">`,
        `<meta name="theme-color" content="#1c1c1c" media="(prefers-color-scheme: dark)">`,
        `<link rel="canonical" href="${url}">`, altLinks(tail),
        `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="1ms.dog">`,
        `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(desc)}">`, `<meta property="og:url" content="${url}">`,
        `<meta property="og:locale" content="${locale}">`, `<meta property="og:image" content="${SITE}/og/${lang.toLowerCase()}.png">`,
        `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:image" content="${SITE}/og/${lang.toLowerCase()}.png">`,
        `<link rel="icon" href="/favicon.ico" sizes="any">`, `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">`,
        `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`,
      ].join("\n");
    };
    const filterHTML = (scope, total) => `<div class="rg-filter" data-scope="${scope}" data-total="${total}">
  <input id="filter" type="search" placeholder="${esc(T("rg_filter"))}" aria-label="${esc(T("rg_filter"))}" autocomplete="off" spellcheck="false">
  <span class="m" id="fcount">${total} / ${total}</span>
  <button class="link" id="fclear" type="button" hidden>${esc(T("rg_clear"))}</button>
</div>
<p class="m rg-nores" id="nores" hidden>${esc(T("rg_no_match"))}</p>`;
    const ldOf = (name, url, desc, crumbItems) => ({ "@context": "https://schema.org", "@graph": [
      { "@type": "WebApplication", name, url, applicationCategory: "UtilitiesApplication", operatingSystem: "Any",
        browserRequirements: "Requires JavaScript", description: desc, inLanguage: lang, isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } },
      { "@type": "BreadcrumbList", itemListElement: crumbItems.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: SITE + c.href })) },
    ] });
    const render = p => {
      let html = rtpl
        .replace(/(<(\w+)\b[^>]*\sdata-i="(\w+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tag, k) => open + esc(T(k)) + `</${tag}>`)
        .replace(/\{\{a:(\w+)\}\}/g, (m, k) => esc(T(k)))
        .replace("{{lang}}", lang).replace("{{pathsAttr}}", esc(JSON.stringify(paths))).replace("{{prepaint}}", PREPAINT)
        .replace("{{head}}", headFor(p.tail, p.title, p.desc, p.ld))
        .replace("{{css}}", cssName).replace("{{js}}", rjsName).replace("{{strings}}", stringsName[lang])
        .replace("{{homeHref}}", base).replace("{{appName}}", esc(T("app_name"))).replace("{{langOpts}}", langOpts)
        .replace("{{crumbs}}", crumbs(p.crumbs)).replace("{{h1}}", esc(p.h1)).replace("{{intro}}", esc(p.intro))
        .replace("{{body}}", p.body).replace("{{nav}}", p.filter + regionNav(regions, lang, base, p.current, T, p.navSkip))
        .replace("{{footSrc}}", links(T("foot_src")))
        .replace("{{data}}", JSON.stringify(p.data).replace(/</g, "\\u003c"));
      if (/\{\{[\w:]+\}\}/.test(html)) throw new Error("unfilled placeholder in " + p.tail + ": " + /\{\{[\w:]+\}\}/.exec(html)[0]);
      return html;
    };

    for (const cont of regions.continents) {
      const cnameT = contName(cont.code, T);
      for (const c of cont.countries) {
        const name = cname(c.cc, lang), tail = `${CONT_SLUG[cont.code]}/${c.cc.toLowerCase()}/`;
        const title = fill(T("rg_title"), { country: name }), desc = fill(T("rg_desc"), { country: name });
        const i = cont.countries.indexOf(c), nb = [cont.countries[i - 1], cont.countries[i + 1]].filter(Boolean);
        const neighbors = nb.map(x => `<a class="xl" href="${base}${CONT_SLUG[cont.code]}/${x.cc.toLowerCase()}/">${esc(cname(x.cc, lang))}</a>`).join("");
        const body = `<section class="card sec">
  <h2>${esc(fill(T("rg_about_h"), { country: name }))}</h2>
  <p>${esc(noteOf(c.cc, lang))}</p>
  <p class="m">${esc(T("L_continent"))}: ${esc(cnameT)}</p>
  <p class="links" data-other hidden></p>
</section>`;
        const crumbItems = [{ name: T("app_name"), href: base }, { name: cnameT, href: `${base}${CONT_SLUG[cont.code]}/` }, { name, href: base + tail }];
        files[pathOf(slug).slice(1) + tail + "index.html"] = render({ tail, title, desc, h1: fill(T("rg_h1"), { country: name }),
          intro: fill(T("rg_intro"), { country: name }), body, current: c.cc, crumbs: crumbItems,
          ld: ldOf(title, SITE + base + tail, desc, crumbItems), filter: filterHTML("nav-all", 86),
          data: { lang, paths, suffix: tail, slots: 5, locations: [{ country: c.cc, limit: 5 }] } });
        sitemapExtra.push({ tail, priority: c.probes >= 20 ? "0.7" : "0.5" });
      }
    }

    for (const cont of regions.continents) {
      const name = contName(cont.code, T), tail = `${CONT_SLUG[cont.code]}/`;
      const reps = cont.countries.slice(0, 10);
      const title = fill(T("ct_title"), { continent: name, countries: cont.countries.length });
      const desc = fill(T("ct_desc"), { continent: name });
      const cards = cont.countries.map(x => `<a class="cc" href="${base}${CONT_SLUG[cont.code]}/${x.cc.toLowerCase()}/" data-n="${esc(cname(x.cc, lang))}" data-e="${esc(cname(x.cc, "en"))}" data-c="${x.cc}"><img src="${flag(x.cc)}" alt="" width="16" height="12" loading="lazy"><span class="cc-n">${esc(cname(x.cc, lang))}</span></a>`).join("");
      const body = `<section class="card sec">
  <h2>${esc(fill(T("ct_about_h"), { continent: name }))}</h2>
  <div class="kpis">
    <div class="kpi"><b>${cont.countries.length}</b><span>${esc(T("L_countries"))}</span></div>
  </div>
  <p>${esc(T("ct_note_" + cont.code.toLowerCase()))}</p>
  <p class="links" data-other hidden></p>
</section>
<section class="card sec">
  <h2>${esc(fill(T("ct_countries_h"), { continent: name }))}</h2>
  ${filterHTML("cards", cont.countries.length)}
  <div class="cc-grid">${cards}</div>
</section>`;
      const crumbItems = [{ name: T("app_name"), href: base }, { name, href: base + tail }];
      files[pathOf(slug).slice(1) + tail + "index.html"] = render({ tail, title, desc, h1: fill(T("ct_h1"), { continent: name }),
        intro: fill(T("ct_intro"), { continent: name, countries: reps.length }), body, current: cont.code, navSkip: cont.code, crumbs: crumbItems,
        ld: ldOf(title, SITE + base + tail, desc, crumbItems), filter: "",
        data: { lang, paths, suffix: tail, slots: reps.length, locations: reps.map(x => ({ country: x.cc, limit: 1, label: cname(x.cc, lang) })) } });
      sitemapExtra.push({ tail, priority: "0.8" });
    }
  }

  const uniq = [...new Map(sitemapExtra.map(e => [e.tail, e])).values()];
  const smAlt = tail => langs.map(([l, s]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE + pathOf(s) + tail}"/>`).join("\n") +
    `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/${tail}"/>`;
  const smRegion = uniq.flatMap(e => langs.map(([, s]) => `  <url>\n    <loc>${SITE + pathOf(s) + e.tail}</loc>\n    <priority>${e.priority}</priority>\n${smAlt(e.tail)}\n  </url>`)).join("\n");

  files["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    langs.map(([, s]) => `  <url>\n    <loc>${SITE + pathOf(s)}</loc>\n` +
      langs.map(([l, s2]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE + pathOf(s2)}"/>`).join("\n") +
      `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/>\n  </url>`).join("\n") + (smRegion ? "\n" + smRegion : "") + "\n</urlset>\n";
  files["robots.txt"] = `User-agent: *\nAllow: /\nDisallow: /r/\n\nSitemap: ${SITE}/sitemap.xml\n`;
  files["llms.txt"] = `# ${en.app_name} · 1ms.dog

> Free reachability check: can other people reach a website, NAS or game server, and if not, where does the
> connection stop? From the visitor's browser, one Globalping HTTP(S) measurement runs against the address and port
> from 18 regions (China Telecom, China Unicom and China Mobile; Hong Kong; Taiwan, China; Tokyo; Korea; Singapore; India;
> Australia; London; Frankfurt; Russia; the UAE; South Africa; Los Angeles; New York; São Paulo), with DNS, TCP, TLS,
> first-byte and download times per region. Each result is classed as a web answer, open but not HTTP, refused,
> timed out, DNS failure, reset, TLS failure or no response, and the page names the likely cause and next steps
> (port forwarding, firewalls, CGNAT, ports blocked by home broadband, Cloudflare's proxy ports, certificates,
> blocking in mainland China). The browser also times two HTTPS requests itself, and 1ms.dog's server in Tokyo connects
> once: it reads the service's greeting (SSH, SMTP…) or its TLS certificate chain, and checks UDP ports with a standard
> hello (QUIC, DNS, Minecraft Bedrock, Steam). It keeps no log; private addresses are never checked.

- Page: ${SITE}/ (also ${langs.slice(1).map(([, s]) => "/" + s + "/").join(", ")})
- Check an address directly: ${SITE}/?t=<domain, IP or URL>&p=<port>&from=friend
- Source code: https://github.com/yt1988/reach-check
`;
  // The only inline script is the pre-paint snippet, identical on every page: one hash covers the site.
  // connect-src is https: because the browser check connects to whatever address the visitor enters.
  const csp = ["default-src 'self'", `script-src 'self' 'sha256-${sha(PREPAINT)}'`, "style-src 'self'", "font-src 'self'", "img-src 'self' data: blob:",
    "connect-src 'self' https:", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
  files["_headers"] = `# Generated by scripts/build.mjs
/*
  Content-Security-Policy: ${csp}
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
/assets/*
  Cache-Control: public, max-age=604800
/assets/app.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/l.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/fonts/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/share/*
  ! Cache-Control
  Cache-Control: public, max-age=0, must-revalidate
/og/*
  Cache-Control: public, max-age=604800
/flags/*
  Cache-Control: public, max-age=604800
/llms.txt
  Access-Control-Allow-Origin: *
  Content-Type: text/plain; charset=utf-8
`;

  // generated files that are no longer produced (old hashes) are stale too
  let gen = [];
  try { gen = (await readdir(new URL("assets/", pub))).filter(f => /^(app|l)\..+\.(js|css)$/.test(f)).map(f => "assets/" + f); } catch (e) {}
  const stale = [];
  for (const [f, body] of Object.entries(files)) {
    let cur = null; try { cur = await readFile(new URL(f, pub), "utf8"); } catch (e) {}
    if (cur !== body) stale.push(f);
  }
  const orphans = gen.filter(f => !(f in files));
  if (check) return [...stale, ...orphans];
  for (const f of stale) { await mkdir(new URL(".", new URL(f, pub)), { recursive: true }); await writeFile(new URL(f, pub), files[f]); }
  for (const f of orphans) await rm(new URL(f, pub));
  return [...stale, ...orphans];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes("--check");
  const changed = await build({ check });
  if (check && changed.length) { console.error("public/ is out of date: " + changed.join(", ") + "\nRun npm run build and commit public/."); process.exit(1); }
  console.log(check ? "public/ is up to date" : changed.length ? "wrote " + changed.length + " files" : "nothing to do");
}
