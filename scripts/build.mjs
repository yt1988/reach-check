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
  "src_gp", "src_dns", "foot_src"]);

// Data sources named in the page link to their sites
const SOURCES = { gp: ["Globalping", "https://globalping.io"] };
const links = s => esc(s).replace(/\{(\w+)\}/g, (m, k) => SOURCES[k] ? `<a href="${SOURCES[k][1]}" target="_blank" rel="noopener">${SOURCES[k][0]}</a>` : m);

const pathOf = slug => "/" + (slug ? slug + "/" : "");

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

  for (const [lang, slug, locale] of langs) {
    const d = I[lang], T = k => { if (!(k in d)) throw new Error(`i18n/${lang}.mjs has no "${k}"`); return d[k]; };
    const strings = Object.fromEntries(Object.keys(en).filter(k => !BUILD_ONLY.has(k)).map(k => [k, T(k)]));
    const sjs = `window.L1MS=${JSON.stringify(strings).replace(/</g, "\\u003c")};\n`;
    const sName = `l.${lang.toLowerCase()}.${hash(sjs)}.js`;
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
      .replace("{{data}}", JSON.stringify({ lang, paths }).replace(/</g, "\\u003c"));
    if (/\{\{[\w:]+\}\}/.test(html)) throw new Error("unfilled placeholder in " + pathOf(slug) + ": " + /\{\{[\w:]+\}\}/.exec(html)[0]);
    files[pathOf(slug).slice(1) + "index.html"] = html;
  }

  files["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    langs.map(([, s]) => `  <url>\n    <loc>${SITE + pathOf(s)}</loc>\n` +
      langs.map(([l, s2]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE + pathOf(s2)}"/>`).join("\n") +
      `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/>\n  </url>`).join("\n") + "\n</urlset>\n";
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
