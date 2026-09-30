/* THE CHECKLIST EXACTLY AS THE APP BUILDS IT, for Appendix A and the counts.

   Reads STAGES and DVSA_DAILY out of index.html and the buses out of
   config.js, and counts the items on each bus the way buildFor does: a full
   inspection item only in a full inspection unless the bus has a history on
   it, and nothing a bus skips.

     node manual/checklist.mjs manual/build/checklist.json                  */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = fs.readFileSync(ROOT + "index.html", "utf8");
const grab = (start, end) => { const a = src.indexOf(start); const b = src.indexOf(end, a); return src.slice(a + start.length, b + end.length - 1); };
const STAGES = eval(grab("var STAGES = ", "\n];"));
const DVSA = eval("(" + grab("var DVSA_DAILY = ", "\n};") + ")");
const window = {}; eval(fs.readFileSync(ROOT + "config.js", "utf8"));

const out = {
  stages: STAGES.map(s => ({ title: s.title, lede: s.lede,
    items: s.items.map(it => Object.assign({}, it, { dvsa: !!DVSA[it.id] })) })),
  vehicles: window.VEHICLES.map(v => ({ reg: v.reg, watch: v.watch || {}, skip: v.skip || [], override: v.override || {} }))
};
for (const v of window.VEHICLES) for (const full of [false, true]) {
  let n = 0, d = 0;
  for (const s of STAGES) for (const it of s.items) {
    if (it.full && !full && !(v.watch && v.watch[it.id])) continue;
    if ((v.skip || []).includes(it.id)) continue;
    n++; if (DVSA[it.id]) d++;
  }
  out[v.reg + (full ? " full" : " pre")] = { items: n, dvsa: d };
}
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
console.log(Object.entries(out).filter(([k]) => / (pre|full)$/.test(k)).map(([k, v]) => k + " " + v.items).join(", "));
