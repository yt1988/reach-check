// The Reach Check Worker. Files in ./public are served before it runs, so it only sees paths that are not files:
//   /r/<code>, /<lang>/r/<code>   a shared result: that language's page with the verdict and the target in its title
//                         (what chat apps show as the link's preview), not indexed; the page itself reads the code and
//                         shows the result; a code it can't read (garbled, cut short, a version it doesn't know) is a
//                         404, so search engines drop the dead link
//   anything else         a bare 404; 1ms-shell puts the shared 1ms.dog 404 page in front of it

import { decodeResult, sharePath } from "./code.mjs";
import en from "./i18n/en.mjs";
import zhCN from "./i18n/zh-CN.mjs";
import zhTW from "./i18n/zh-TW.mjs";
import ja from "./i18n/ja.mjs";
import ko from "./i18n/ko.mjs";
import es from "./i18n/es.mjs";
import fr from "./i18n/fr.mjs";
import de from "./i18n/de.mjs";
import pt from "./i18n/pt.mjs";
import ru from "./i18n/ru.mjs";

// each language's strings by its folder ("" is English, at the root)
const STR = { "": en, "zh-cn": zhCN, "zh-tw": zhTW, ja, ko, es, fr, de, pt, ru };
// the verdicts a link may name: their titles take numbers only, so the Worker can fill them
const TITLES = new Set(["v_all", "v_all_n", "v_cnfail", "v_cnonly", "v_part", "v_priv", "v_gpoff", "n_timeout", "n_refused", "n_dns",
  "n_unreach", "n_reset", "n_tls", "n_nothttp", "n_nottls", "n_slow", "n_other"]);
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => k in v ? v[k] : m);
// a sentence with a number in it: key_one, key_few… where the language has that form for n, else the key itself
const pick = (S, slug, k, n) => {
  const lang = slug ? slug.replace(/-\w+$/, m => m.toUpperCase()) : "en";
  return S[`${k}_${new Intl.PluralRules(lang).select(n)}`] ?? S[k];
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed\n", { status: 405 });
    const sp = sharePath(url.pathname), r = sp && sp.slug in STR && await decodeResult(sp.code);
    if (r && TITLES.has(r.v[0]) && env.ASSETS) return shared(req, env, url, sp, r);
    return new Response(req.method === "HEAD" ? null : "Not found\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" },
    });
  },
};

// A shared result: the language's page as it is, with the title, description and their Open Graph and Twitter copies
// naming the verdict and the target. r: the result the code holds.
async function shared(req, env, url, { slug }, r) {
  const home = "/" + (slug ? slug + "/" : ""), S = STR[slug];
  const [key, ok, n] = r.v, target = `${r.t[0]}:${r.t[1]}`;
  const title = `${fill(pick(S, slug, key, key === "v_part" ? ok : n), { ok, n })} · ${target}`;
  const desc = fill(pick(S, slug, "share_desc", ok), { ok, n, target }) + " · " + S.app_name;
  const page = await env.ASSETS.fetch(new Request(new URL(home, url), { headers: req.headers }));
  if (!page.ok) return page;
  const attr = (val, name = "content") => ({ element: e => e.setAttribute(name, val) });
  const out = new HTMLRewriter()
    .on("title", { element: e => e.setInnerContent(title) })
    .on('meta[name="description"]', attr(desc))
    .on('meta[property="og:title"]', attr(title)).on('meta[name="twitter:title"]', attr(title))
    .on('meta[property="og:description"]', attr(desc)).on('meta[name="twitter:description"]', attr(desc))
    .on('meta[property="og:url"]', attr(url.origin + url.pathname))
    .on('meta[name="robots"]', attr("noindex, follow"))
    .transform(page);
  const h = new Headers(out.headers);
  h.delete("etag");
  h.set("cache-control", "public, max-age=3600");
  h.set("x-robots-tag", "noindex");
  return new Response(req.method === "HEAD" ? null : out.body, { status: 200, headers: h });
}
