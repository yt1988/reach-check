// Endpoint tokens: sent when the shell provided one, one refresh-and-retry on 401, never a header without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { authFetch, tokenFromDoc } from "../src/auth.js";

const docWith = token => {
  let v = token;
  return {
    querySelector: sel => sel.includes("ms-auth") ? { getAttribute: () => v, setAttribute: (_, x) => { v = x; } } : null,
    get token() { return v; },
  };
};

test("no meta: the request carries no Authorization header", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, h: init.headers }); return { status: 200, ok: true, text: async () => "ok" }; };
  const r = await authFetch("https://api.example/v1/probe", {}, { fetchImpl, doc: docWith(""), token: "" });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].h.Authorization, undefined);
  assert.equal(tokenFromDoc(docWith("")), "");
});

test("a token from the meta is sent as a bearer", async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = init.headers; return { status: 200, ok: true }; };
  await authFetch("https://api.example/v1/probe", {}, { fetchImpl, doc: docWith("tok"), token: "tok" });
  assert.equal(seen.Authorization, "Bearer tok");
});

test("401: one refresh from /_ms/token, one retry, the new token is stored", async () => {
  const calls = [];
  const doc = docWith("old");
  const fetchImpl = async (url, init) => {
    const auth = init && init.headers ? init.headers.Authorization : undefined;
    calls.push({ url, auth });
    if (url === "/_ms/token") return { status: 200, ok: true, text: async () => "v1.new" };
    if (auth === "Bearer v1.new") return { status: 200, ok: true };
    return { status: 401, ok: false };
  };
  const r = await authFetch("https://api.example/v1/probe", {}, { fetchImpl, doc });
  assert.equal(r.status, 200, JSON.stringify(calls));
  assert.deepEqual(calls.map(c => c.auth), ["Bearer old", undefined, "Bearer v1.new"], JSON.stringify(calls));
  assert.equal(doc.token, "v1.new");
});

test("a 401 that stays 401 is retried only once", async () => {
  let probes = 0, tokenCalls = 0;
  const fetchImpl = async (url) => {
    if (url === "/_ms/token") { tokenCalls++; return { status: 200, ok: true, text: async () => "v1.again" }; }
    probes++;
    return { status: 401, ok: false };
  };
  const r = await authFetch("https://api.example/v1/probe", {}, { fetchImpl, doc: docWith("t"), token: "t" });
  assert.equal(r.status, 401);
  assert.equal(probes, 2);
  assert.equal(tokenCalls, 1);
});

test("401 with no token endpoint available: the single request stands", async () => {
  let probes = 0;
  const fetchImpl = async (url) => {
    if (url === "/_ms/token") return { status: 404, ok: false };
    probes++;
    return { status: 401, ok: false };
  };
  const r = await authFetch("https://api.example/v1/probe", {}, { fetchImpl, doc: docWith("") });
  assert.equal(r.status, 401);
  assert.equal(probes, 1);
});
