// A shared result in a link: /<lang>/r/<code>, code = "1~" + base64url(deflate-raw(JSON)). The first segment is the
// format's version: a new format gets a new number, and old links keep opening. Used by the page (the build puts this
// file in front of app.js, without the exports) and by the Worker, which titles the link's preview.
// The result holds what the page showed: the target, each region's outcome and times, the browser's own check and the
// DNS answers. Never the visitor's own IP.

export const CODE_VERSION = "1";

const b64url = bytes => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64url = s => { const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(bin, c => c.charCodeAt(0)); };
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

export async function encodeResult(obj) {
  return CODE_VERSION + "~" + b64url(await pipe(new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream("deflate-raw")));
}

// null when the code can't be read: garbled, cut short, or a version this code doesn't know
export async function decodeResult(code) {
  const m = /^1~([A-Za-z0-9_-]{8,6000})$/.exec(code || "");
  if (!m) return null;
  try {
    const r = JSON.parse(new TextDecoder().decode(await pipe(unb64url(m[1]), new DecompressionStream("deflate-raw"))));
    return r && Array.isArray(r.t) && typeof r.t[0] === "string" && Array.isArray(r.r) && Array.isArray(r.v) ? r : null;
  } catch (e) { return null; }
}

// "/r/<code>" or "/<lang folder>/r/<code>" → { slug, code }
export function sharePath(path) {
  const m = /^\/(?:([a-z]{2}(?:-[a-z]{2})?)\/)?r\/([^/]+)$/.exec(path);
  return m ? { slug: m[1] || "", code: m[2] } : null;
}
