/* EVERY BOX YOU TYPE IN SHOWS A FADED SAMPLE.
   pages v1.106.0 (Asim, 11 October 2026).

   Asim: any part of any app that takes typing shows a grey, faded sample of
   what goes in it, and the sample goes as soon as the person types. That is
   the box's placeholder. Date and time boxes are left out: the phone draws
   its own dd/mm/yyyy there. Ticks, files and hidden boxes take no typing. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Suite } from "../lib/t.mjs";

const PAGES = ["index.html", "coord/index.html", "sunday/index.html", "do/index.html"];
const NO_TYPING = /type=["'](checkbox|radio|hidden|file|date|time|button|submit)["']/;

export default async function (root) {
  const s = new Suite("every box you type in shows a faded sample");

  for (const page of PAGES) {
    const src = readFileSync(join(root, page), "utf8");

    s.test(page + ": every typing box has a sample", (a) => {
      const bare = [];
      const re = /<(input|textarea)\b/g;
      let m;
      while ((m = re.exec(src))) {
        const tag = src.slice(m.index, src.indexOf(">", m.index) + 1);
        if (NO_TYPING.test(tag)) continue;
        if (!/placeholder=/.test(tag)) bare.push(tag.replace(/\s+/g, " ").slice(0, 90));
      }
      a.eq(bare.length, 0, "no sample: " + bare.join(" | "));
    });

    s.test(page + ": the sample is grey and faded", (a) => {
      a.ok(/::placeholder\{color:var\(--muted\);opacity:\.6\}/.test(src), "no faded ::placeholder rule");
    });
  }

  return s;
}
