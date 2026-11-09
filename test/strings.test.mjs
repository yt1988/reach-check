// Every language has every English key and no others (but the plural forms its numbers need: key_few, key_many), with
// the same {placeholders} and the same advice markup, and public/ is what the build makes from src/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build, loadI18n, LANGS, BUILD_ONLY } from "../scripts/build.mjs";

const I = await loadI18n(), en = I.en;
const holes = s => (typeof s === "string" ? s.match(/\{\w+\}/g) || [] : []).sort().join();
const marks = s => (typeof s === "string" ? [(s.match(/\*\*/g) || []).length, (s.match(/`/g) || []).length] : []).join();

test("every language is there", () => assert.deepEqual(Object.keys(I).sort(), LANGS.map(([l]) => l).sort()));

for (const [lang] of LANGS.slice(1)) test(`${lang} matches en`, () => {
  const d = I[lang];
  const plural = k => /_(few|many)$/.test(k) && k.replace(/_(few|many)$/, "_one") in en;
  assert.deepEqual(Object.keys(d).filter(k => !(k in en) && !plural(k)), [], "keys en doesn't have");
  for (const k of Object.keys(d).filter(plural)) assert.equal(holes(d[k]), holes(en[k.replace(/_(few|many)$/, "")]), `placeholders of ${k}`);
  for (const k of Object.keys(en)) {
    assert.ok(k in d, `missing ${k}`);
    assert.ok(String(d[k]).trim(), `empty ${k}`);
    assert.equal(holes(d[k]), holes(en[k]), `placeholders of ${k}`);
    assert.equal(marks(d[k]), marks(en[k]), `**bold** and \`code\` marks of ${k}`);
  }
});

// A key the build keeps for itself is not in the browser's L1MS, so t() there would print the key itself (h_regions
// did: the table heading turned into "h_regions" after any check).
test("no string the page reads at runtime is build-only", () => {
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const keys = [...new Set([...app.matchAll(/\bt\(\s*"(\w+)"/g)].map(m => m[1]))];
  assert.deepEqual(keys.filter(k => BUILD_ONLY.has(k)), []);
});

test("public/ is up to date", async () => assert.deepEqual(await build({ check: true }), []));
