// Taiwan's name is written out per the 1ms.dog tool contract (§5), in every language, never the browser's region name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { LANGS } from "../scripts/build.mjs";

const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const TW = { "zh-CN": "中国台湾", "zh-TW": "中國台灣", en: "Taiwan, China", ja: "中国台湾", ko: "중국 대만", es: "Taiwán, China", fr: "Taïwan, Chine", de: "Taiwan, China", pt: "Taiwan, China", ru: "Тайвань, Китай" };

test("Taiwan's name is the contract's, for every language the page has", () => {
  const m = app.match(/^const TW = (\{.*\});$/m);
  assert.ok(m, "no TW table in src/app.js");
  const got = Function(`return ${m[1]}`)();
  assert.deepEqual(got, TW);
  for (const [lang] of LANGS) assert.ok(got[lang], `no name for ${lang}`);
  assert.match(app, /cc === "TW" \? \(TW\[lang\] \|\| TW\.en\)/);
});

test("the built script parses", () => {
  const dir = new URL("../public/assets/", import.meta.url);
  const js = readdirSync(dir).filter(f => /^app\.[0-9a-f]+\.js$/.test(f));
  assert.equal(js.length, 1);
  assert.doesNotThrow(() => new Function(readFileSync(new URL(js[0], dir), "utf8")));    // parsed, not run
});
