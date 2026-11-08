// A result survives the trip through a link, and a code that can't be read is refused (the Worker then answers 404).
// Links of version 1 (2026-11-03 to 11-08: bare deflate-raw) keep opening; version 2 is 1ms.dog's codec, which also
// writes uncompressed ("u…") links where the browser can't compress.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeResult, decodeResult, sharePath } from "../src/code.mjs";

const sample = { t: ["nas.example.com", 5001, "/", "", "4", "HTTPS", 1, "", 1, 0, "nas.example.com:5001"], ts: 1762160000000,
  v: ["v_part", 16, 18], e: "", r: [["timeout", 0, [12, null, null, null, null, 15000], 0, "203.0.113.7", "Wuhan", "China Unicom", 4837, "CN", 0], null],
  l: ["ok", 307, 222], d: 0, s: { k: "banner", svc: "ssh", banner: "SSH-2.0-OpenSSH_9.6" } };
const b64u = b => Buffer.from(b).toString("base64url");
const deflate = async s => new Uint8Array(await new Response(new Blob([new TextEncoder().encode(s)]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());

test("a result comes back as it went in", async () => {
  const code = await encodeResult(sample);
  assert.match(code, /^2~z[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeResult(code), sample);
});

test("links of version 1 still open", async () => {
  assert.deepEqual(await decodeResult("1~" + b64u(await deflate(JSON.stringify(sample)))), sample);
});

test("a link from a browser that couldn't compress opens", async () => {
  assert.deepEqual(await decodeResult("2~u" + b64u(new TextEncoder().encode(JSON.stringify(sample)))), sample);
});

test("garbled, cut short or unknown codes are refused", async () => {
  const code = await encodeResult(sample);
  for (const bad of ["", "2~", "3~" + code.slice(2), "1~" + code.slice(2), code.slice(0, code.length - 9), "2~z" + "A".repeat(40),
    "2~x" + code.slice(3), "2~not!base64", "2~u" + b64u(new TextEncoder().encode("{\"t\":1}"))])
    assert.equal(await decodeResult(bad), null, bad.slice(0, 20));
});

test("the codec is 1ms.dog's, byte for byte", () => {
  const shell = new URL("../../1ms-shell/assets/share/codec.js", import.meta.url);
  let theirs; try { theirs = readFileSync(shell, "utf8"); } catch (e) { return; }   // only where 1ms-shell sits next to this repository
  assert.equal(readFileSync(new URL("../public/assets/share/codec.js", import.meta.url), "utf8"), theirs);
});

test("result paths, with and without a language folder", () => {
  assert.deepEqual(sharePath("/r/2~abc"), { slug: "", code: "2~abc" });
  assert.deepEqual(sharePath("/zh-cn/r/1~abc"), { slug: "zh-cn", code: "1~abc" });
  assert.equal(sharePath("/zh-cn/"), null);
  assert.equal(sharePath("/r/"), null);
});
