// A shared result in a link: /<lang>/r/<code>. The code is "<version>~<body>"; a new format gets a new version, and
// old links keep opening. Used by the page (bundled into app.js) and by the Worker, which titles the link's preview.
// The body is made by 1ms.dog's shared codec (public/assets/share/codec.js, copied byte for byte from 1ms-shell):
//   version 2  "z" + base64url(deflate-raw(JSON)), or "u" + base64url(JSON) when the browser can't compress
//   version 1  base64url(deflate-raw(JSON)), made before 2026-11-08 (CompressionStream only: older browsers failed)
// The result holds what the page showed: the target, each region's outcome and times, the browser's own check and our
// server's answer. Never the visitor's own IP.
import { pack, unpack, CodecError } from "../public/assets/share/codec.js";

export const CODE_VERSION = "2";

export async function encodeResult(obj) {
  return CODE_VERSION + "~" + await pack(JSON.stringify(obj));
}

// The result, or null when the code can't be read (garbled, cut short, a version this code doesn't know). Throws
// CodecError("inflate") when the code is fine but this browser can't decompress it (the Worker always can).
export async function decodeResult(code) {
  const m = /^([12])~([A-Za-z0-9_-]{8,16000})$/.exec(code || "");
  if (!m) return null;
  let text;
  try { text = await unpack(m[2], m[1] === "1" ? { legacy: true } : undefined); }
  catch (e) { if (e instanceof CodecError && e.reason === "inflate") throw e; return null; }
  try {
    const r = JSON.parse(text);
    return r && Array.isArray(r.t) && typeof r.t[0] === "string" && Array.isArray(r.r) && Array.isArray(r.v) ? r : null;
  } catch (e) { return null; }
}

// "/r/<code>" or "/<lang folder>/r/<code>" → { slug, code }
export function sharePath(path) {
  const m = /^\/(?:([a-z]{2}(?:-[a-z]{2})?)\/)?r\/([^/]+)$/.exec(path);
  return m ? { slug: m[1] || "", code: m[2] } : null;
}
