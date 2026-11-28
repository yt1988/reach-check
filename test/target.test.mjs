// A pasted target is read the same way whatever its shape: a bare host, host:port, a URL (whose path, query and
// fragment are not checked), an IPv6 literal in brackets. What can't be read is refused rather than guessed at.
// And the address panel's ASN lookup comes from the shell's meta, never a host written into this public repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const part = re => { const m = app.match(re); assert.ok(m, `no ${re} in src/app.js`); return m; };

// parseTarget is inside the page's IIFE: take it with the two address helpers it uses, and run it on its own
const isV4 = part(/^const isV4 = (.+);$/m)[1], isV6 = part(/^const isV6 = s => \{[\s\S]*?\n\};$/m)[0];
const fn = part(/^function parseTarget\(raw\) \{[\s\S]*?\n\}$/m)[0];
const parseTarget = Function(`const isV4 = ${isV4}; ${isV6}; ${fn}; return parseTarget;`)();
const got = s => {
  const p = parseTarget(s);
  return p && { host: p.host, port: p.port, explicit: p.explicit, path: p.path, scheme: p.scheme, isIp: p.isIp };
};

test("a target is read the same way however it is pasted", () => {
  assert.deepEqual(got("  Example.COM  "), { host: "example.com", port: 0, explicit: false, path: "/", scheme: "", isIp: false });
  assert.deepEqual(got("https://Example.com:8443/a/b?q=1#f"), { host: "example.com", port: 8443, explicit: true, path: "/", scheme: "https", isIp: false });
  assert.deepEqual(got("https://example.com"), { host: "example.com", port: 0, explicit: false, path: "/", scheme: "https", isIp: false });
  // URL drops a default port, but one that was written is still explicit and goes into the port field
  assert.deepEqual(got("http://example.com:80"), { host: "example.com", port: 80, explicit: true, path: "/", scheme: "http", isIp: false });
  assert.deepEqual(got("example.com:5001/path?q=1"), { host: "example.com", port: 5001, explicit: true, path: "/", scheme: "", isIp: false });
  assert.deepEqual(got("example.com/path"), { host: "example.com", port: 0, explicit: false, path: "/", scheme: "", isIp: false });
  assert.deepEqual(got("[2001:db8::1]:8443"), { host: "2001:db8::1", port: 8443, explicit: true, path: "/", scheme: "", isIp: true });
  assert.deepEqual(got("[2001:db8::1]/x"), { host: "2001:db8::1", port: 0, explicit: false, path: "/", scheme: "", isIp: true });
  assert.deepEqual(got("2001:db8::1"), { host: "2001:db8::1", port: 0, explicit: false, path: "/", scheme: "", isIp: true });
  assert.deepEqual(got("1.2.3.4:22"), { host: "1.2.3.4", port: 22, explicit: true, path: "/", scheme: "", isIp: true });
});

test("what can't be read is refused, not guessed at", () => {
  for (const bad of ["", "localhost", "hello world", "example.com:abc", "example.com:0", "example.com:70000",
    "ftp://example.com", "https://", "[2001:db8::1]:x", "example.com:5001:6000"])
    assert.equal(parseTarget(bad), null, bad);
});

test("the address panel's lookup comes from the shell's ASN tool, never a host of its own", () => {
  assert.match(app, /querySelector\('meta\[name="asn"\]'\)/);
  assert.match(app, /\/api\/ip\//);
  assert.ok(!app.includes("asn.1ms.dog"), "ASN Lookup's host must come from <meta name=\"asn\">");
});

test("a result link can name our servers' verdicts, so its preview title is built", () => {
  const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
  for (const k of ["v_srv_all", "v_srv_some", "v_srv_none", "v_srv_unrun"]) assert.ok(worker.includes(`"${k}"`), k);
});
