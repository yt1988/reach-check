// Every language has every English key and no others, with the same {placeholders} and the same advice markup,
// and public/ is what the build makes from src/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build, loadI18n, LANGS } from "../scripts/build.mjs";

const I = await loadI18n(), en = I.en;
const holes = s => (typeof s === "string" ? s.match(/\{\w+\}/g) || [] : []).sort().join();
const marks = s => (typeof s === "string" ? [(s.match(/\*\*/g) || []).length, (s.match(/`/g) || []).length] : []).join();

test("every language is there", () => assert.deepEqual(Object.keys(I).sort(), LANGS.map(([l]) => l).sort()));

for (const [lang] of LANGS.slice(1)) test(`${lang} matches en`, () => {
  const d = I[lang];
  assert.deepEqual(Object.keys(d).filter(k => !(k in en)), [], "keys en doesn't have");
  for (const k of Object.keys(en)) {
    assert.ok(k in d, `missing ${k}`);
    assert.ok(String(d[k]).trim(), `empty ${k}`);
    assert.equal(holes(d[k]), holes(en[k]), `placeholders of ${k}`);
    assert.equal(marks(d[k]), marks(en[k]), `**bold** and \`code\` marks of ${k}`);
  }
});

test("public/ is up to date", async () => assert.deepEqual(await build({ check: true }), []));
