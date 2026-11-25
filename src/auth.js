// Endpoint tokens (1ms.dog docs/tool-contract.md, "端点鉴权"): the shell puts a short-lived token in
// <meta name="ms-auth">. We send it as a bearer; a 401 means it expired (or the tab sat too long), so we ask
// /_ms/token once for a fresh one and retry that request once. No meta (self-hosted) means no header at all.
export function tokenFromDoc(doc = globalThis.document) {
  const el = doc && doc.querySelector ? doc.querySelector('meta[name="ms-auth"]') : null;
  return (el && el.getAttribute("content")) || "";
}

function storeToken(tok, doc) {
  const el = doc && doc.querySelector ? doc.querySelector('meta[name="ms-auth"]') : null;
  if (el && tok) el.setAttribute("content", tok);
  return tok;
}

export async function refreshToken(fetchImpl = globalThis.fetch, doc = globalThis.document) {
  try {
    const r = await fetchImpl("/_ms/token", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) return "";
    const text = (await r.text()).trim();
    if (text.startsWith("v1.")) return storeToken(text, doc);
    try { return storeToken(JSON.parse(text).token || "", doc); } catch (e) { return ""; }
  } catch (e) { return ""; }
}

// fetch with the token if there is one; on 401, refresh once and retry once. Only one retry, ever.
export async function authFetch(url, init = {}, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const doc = opts.doc || globalThis.document;
  const token = opts.token != null ? opts.token : tokenFromDoc(doc);
  const call = t => fetchImpl(url, { ...init, headers: { ...(init.headers || {}), ...(t ? { Authorization: "Bearer " + t } : {}) } });
  let r = await call(token);
  if (r.status === 401) {
    const fresh = await refreshToken(fetchImpl, doc);
    if (fresh) r = await call(fresh);
  }
  return r;
}
