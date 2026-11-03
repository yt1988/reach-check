// A result survives the trip through a link, and a code that can't be read is refused (the Worker then answers 404).
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeResult, decodeResult, sharePath } from "../src/code.mjs";

const sample = { t: ["nas.example.com", 5001, "/", "", "4", "HTTPS", 1, "", 1, 0, "nas.example.com:5001"], ts: 1762160000000,
  v: ["v_part", 16, 18], e: "", r: [["timeout", 0, [12, null, null, null, null, 15000], 0, "203.0.113.7", "Wuhan", "China Unicom", 4837, "CN", 0], null],
  l: ["ok", 307, 222], d: 0 };

test("a result comes back as it went in", async () => {
  const code = await encodeResult(sample);
  assert.match(code, /^1~[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeResult(code), sample);
});

test("garbled, cut short or unknown codes are refused", async () => {
  const code = await encodeResult(sample);
  for (const bad of ["", "1~", "2~" + code.slice(2), code.slice(0, code.length - 9), "1~" + "A".repeat(40), "1~not!base64"])
    assert.equal(await decodeResult(bad), null, bad.slice(0, 20));
});

test("result paths, with and without a language folder", () => {
  assert.deepEqual(sharePath("/r/1~abc"), { slug: "", code: "1~abc" });
  assert.deepEqual(sharePath("/zh-cn/r/1~abc"), { slug: "zh-cn", code: "1~abc" });
  assert.equal(sharePath("/zh-cn/"), null);
  assert.equal(sharePath("/r/"), null);
});
