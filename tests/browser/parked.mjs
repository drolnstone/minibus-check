/* PARKED MILEAGE ON THE DRIVER APP'S HUB, v1.124.0, in a browser.

     CHROMIUM=/opt/pw-browsers/chromium node tests/browser/parked.mjs

   The stand-in answers ?last=1 with a bus that may have a parked reading,
   for the driver signed in or for somebody else, and takes the reading. */
import { phone, done, SAMPLE, OUT } from "./lib.mjs";

const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok });
  console.log((ok ? "  ✓ " : "  ✗ ") + id + "  " + name + (ok ? "" : "   [" + detail + "]"));
}
const REG = "YS70 PWE";

async function hub(forWho, answer) {
  const me = await phone({ clock: "2026-09-27T14:40:00+01:00", timezoneId: "Europe/London" });
  const got = [];
  const open = [{ reg: REG, checkId: "c1", day: "2026-09-27", miles: 31544, driver: forWho, parked: null }];
  await me.pg.route("**://*.workers.dev/**", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    let post = {};
    try { post = JSON.parse(req.postData() || "{}"); } catch (e) {}
    if (u.searchParams.get("last")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        ok: true, cache: "worker", sheet: "v1.122.0", server: "w2.65.0",
        last: { [REG]: { miles: 31544, date: "27/09/2026", time: "08:10", driver: SAMPLE, checkId: "c1" } },
        parkOpen: open, parked: {} }) });
    }
    if (post.action === "parked") {
      if (me.hold) return route.abort();
      got.push(post);
      const out = answer ? answer(post) : { ok: true, parked: { reg: REG, checkId: post.parked.checkId, miles: Number(post.parked.miles),
        driver: post.parked.driver, at: Date.parse("2026-09-27T14:41:00+01:00") } };
      if (me.slow) await new Promise((r) => setTimeout(r, me.slow));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
    }
    return route.fallback();
  });
  await me.load(); await me.close(["howDone"]);
  await me.signIn();
  await me.wait(1500);
  me.got = got;
  return me;
}

{
  const me = await hub(SAMPLE);
  const card = await me.text("#hubParked");
  check("P1", "the morning's driver sees the box on the hub", /Bus parked/i.test(card) && /Walkaround 31,544 this morning/.test(card) &&
        !!(await me.pg.$("#parkMiles0")), "card: " + card);
  await me.shot("parked-1-box", { scrollTo: "#hubParked" });
  await me.pg.fill("#parkMiles0", "31530");
  await me.click("Save", "#hubParked");
  await me.wait(600);
  const low = await me.text("#hubParked");
  check("P2", "a reading lower than the walkaround is refused on the phone", /lower than the walkaround/.test(low) && me.got.length === 0, low);
  await me.pg.fill("#parkMiles0", "31560");
  await me.click("Save", "#hubParked");
  await me.wait(1200);
  const saved = await me.text("#hubParked");
  check("P3", "Save sends it with the driver's name and shows it kept", me.got.length === 1 && me.got[0].parked.miles === 31560 &&
        me.got[0].parked.driver === SAMPLE && me.got[0].parked.checkId === "c1" && /31,560/.test(saved) && /Saved\./.test(saved),
        JSON.stringify(me.got) + " | " + saved);
  await me.shot("parked-2-saved", { scrollTo: "#hubParked" });
  await me.click("Change", "#hubParked");
  check("P4", "Change opens the box again", !!(await me.pg.$("#parkMiles0")), await me.text("#hubParked"));
  check("P5", "no page errors", me.errs.length === 0, me.errs.join(" | "));
  await me.ctx.close();
}
{
  const me = await hub("Bro Somebody Else");
  const card = await me.text("#hubParked");
  check("P6", "nobody else sees it", card === "", card);
  await me.ctx.close();
}
{
  const me = await hub(SAMPLE, () => ({ ok: false, error: "not yours", driver: "Bro Other" }));
  await me.pg.fill("#parkMiles0", "31560");
  await me.click("Save", "#hubParked");
  await me.wait(1200);
  const t = await me.text("#hubParked");
  check("P7", "the server's refusal is said in the card", /Bro Other’s to key/.test(t), t);
  await me.ctx.close();
}

{
  /* With no signal: kept on the phone, then sent by itself when the signal
     comes back, with the time it was keyed. */
  const me = await hub(SAMPLE);
  await me.ctx.setOffline(true);
  await me.pg.fill("#parkMiles0", "31561");
  await me.click("Save", "#hubParked");
  await me.wait(800);
  const held = await me.text("#hubParked");
  const kept = await me.pg.evaluate(() => JSON.parse(localStorage.getItem("fleet.parked.v1") || "{}").queue || {});
  check("P8", "with no signal it is kept on the phone and said so", me.got.length === 0 && /31,561/.test(held) &&
        /Saved on this phone\. Sent when there is signal\./.test(held) && kept.c1 && kept.c1.miles === 31561 && kept.c1.made > 0,
        held + " | " + JSON.stringify(kept));
  await me.shot("parked-3-held", { scrollTo: "#hubParked" });
  await me.ctx.setOffline(false);
  await me.pg.evaluate(() => window.dispatchEvent(new Event("online")));
  await me.wait(1500);
  const sent = await me.text("#hubParked");
  const left = await me.pg.evaluate(() => JSON.parse(localStorage.getItem("fleet.parked.v1") || "{}").queue || {});
  check("P9", "the signal back, it goes by itself with the time it was keyed", me.got.length === 1 &&
        me.got[0].parked.miles === 31561 && me.got[0].parked.made === kept.c1.made && /Saved\./.test(sent) &&
        Object.keys(left).length === 0, JSON.stringify(me.got) + " | " + sent + " | " + JSON.stringify(left));
  await me.ctx.close();
}
{
  /* Kept, the app closed, and opened again with signal: it goes as the app
     opens, before anybody signs in. */
  const me = await hub(SAMPLE);
  await me.ctx.setOffline(true);
  await me.pg.fill("#parkMiles0", "31562");
  await me.click("Save", "#hubParked");
  await me.wait(500);
  me.hold = true;
  await me.ctx.setOffline(false);
  await me.pg.evaluate(() => window.dispatchEvent(new Event("online")));
  await me.wait(800);
  const before = me.got.length;
  me.hold = false;
  await me.pg.reload();
  await me.wait(2500);
  const left = await me.pg.evaluate(() => JSON.parse(localStorage.getItem("fleet.parked.v1") || "{}").queue || {});
  check("P10", "opened again with signal, it goes", before === 0 && me.got.length === 1 && me.got[0].parked.miles === 31562 &&
        Object.keys(left).length === 0, before + " | " + JSON.stringify(me.got) + " | " + JSON.stringify(left));
  check("P11", "no page errors", me.errs.length === 0, me.errs.join(" | "));
  await me.ctx.close();
}

{
  /* The list changes under him while he types: another bus, someone
     else's, comes in ahead of his. Save still files his own. */
  const me = await hub(SAMPLE);
  await me.pg.focus("#parkMiles0");
  await me.pg.fill("#parkMiles0", "31560");
  await me.pg.evaluate((reg) => parkSeen({ parkOpen: [
    { reg: "AB12 CDE", checkId: "c0", day: "2026-09-27", miles: 20000, driver: "Bro Other", parked: null },
    { reg: reg, checkId: "c1", day: "2026-09-27", miles: 31544, driver: "Bro Sample", parked: null }], parked: {} }), REG);
  await me.click("Save", "#hubParked");
  await me.wait(1200);
  check("P12", "with the list changed while he typed, his own bus is the one filed",
        me.got.length === 1 && me.got[0].parked.checkId === "c1" && me.got[0].parked.reg === REG,
        JSON.stringify(me.got));
  await me.ctx.close();
}
{
  /* A correction keyed while the first is still on its way goes after it. */
  const me = await hub(SAMPLE);
  me.slow = 2500;
  await me.pg.fill("#parkMiles0", "31650");
  await me.click("Save", "#hubParked");
  await me.wait(300);
  await me.click("Change", "#hubParked");
  await me.pg.fill("#parkMiles0", "31560");
  await me.click("Save", "#hubParked");
  await me.wait(6500);
  const t = await me.text("#hubParked");
  check("P13", "a correction keyed while the first was sending is sent after it, and shown",
        me.got.length === 2 && me.got[1].parked.miles === 31560 && /31,560/.test(t) && !/31,650/.test(t),
        JSON.stringify(me.got.map((g) => g.parked.miles)) + " | " + t);
  await me.ctx.close();
}

await done();
const bad = results.filter((r) => !r.ok);
console.log("\n  " + results.length + " checks, " + (results.length - bad.length) + " passed. Pictures in " + OUT);
process.exit(bad.length ? 1 : 0);
