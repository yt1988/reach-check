// Nuremberg is our fourth server, and every place that names a server must know it: the label in all ten
// languages (in the source and in the build), the CITIES lookup and the CITY_NAME table in app.js, and the
// order servers() gives, which is the order the page renders (never a hard-coded one).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { loadI18n, LANGS } from "../scripts/build.mjs";
import { endpoints, servers } from "../src/egress.js";

const I = await loadI18n();
const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

test("every language has the Nuremberg label, and the build carries it", () => {
  const dir = new URL("../public/assets/", import.meta.url);
  const bundles = readdirSync(dir).filter(f => /^l\.[a-z-]+\.[0-9a-f]+\.js$/.test(f));
  for (const [lang] of LANGS) {
    const label = I[lang]?.srv_nuremberg;
    assert.ok(label && label.trim(), `${lang}: no srv_nuremberg`);
    const file = bundles.find(f => f.startsWith(`l.${lang.toLowerCase()}.`));
    assert.ok(file, `${lang}: no language bundle in public/assets`);
    const built = readFileSync(new URL(file, dir), "utf8");
    assert.ok(built.includes(`"srv_nuremberg":${JSON.stringify(label)}`), `${lang}: srv_nuremberg not in ${file}`);
  }
});

test("app.js maps nue to Germany and its label, and has a city name for every server", () => {
  const block = app.match(/^const CITIES = \{([\s\S]*?)\n\};$/m);
  assert.ok(block, "no CITIES table in src/app.js");
  const cities = Object.fromEntries([...block[1].matchAll(/(\w+): \{ cc: "(\w+)", label: "(\w+)" \}/g)]
    .map(([, city, cc, label]) => [city, { cc, label }]));
  assert.deepEqual(cities.nue, { cc: "DE", label: "srv_nuremberg" });

  const names = app.match(/^const CITY_NAME = (\{.*\});$/m);
  assert.ok(names, "no CITY_NAME table in src/app.js");
  const cityName = Function(`return ${names[1]}`)();
  assert.equal(cityName.nue, "Nuremberg");

  for (const [city, { label }] of Object.entries(cities)) {
    for (const [lang] of LANGS) assert.ok(I[lang]?.[label]?.trim(), `${lang}: no ${label}`);
    assert.ok(cityName[city], `no CITY_NAME for ${city}`);
    for (const [lang] of LANGS) assert.ok(I[lang]?.[`city_${cityName[city]}`]?.trim(), `${lang}: no city_${cityName[city]}`);
  }
});

test("a four-city ms-servers keeps its order, so the page renders the meta's order", () => {
  const value = "reach=lax@https://la.example,nue@https://nue.example,tyo@https://tyo.example,sha@https://sha.example";
  const doc = { querySelector: () => ({ getAttribute: () => value }) };
  const list = servers(endpoints("ms-servers", doc).reach);
  assert.deepEqual(list.map(s => s.city), ["lax", "nue", "tyo", "sha"]);
  assert.deepEqual(list.map(s => s.url), ["https://la.example", "https://nue.example", "https://tyo.example", "https://sha.example"]);
  // a bare list from an older injection still parses, with no city to name
  assert.deepEqual(servers("https://a.example,https://b.example").map(s => s.city), ["", ""]);
});
