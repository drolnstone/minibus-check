/* DRAWS THE CLIPS, frame by frame, from stage.html.

     node video/render.mjs preview [1,2,3,driver]   one still per scene, fully drawn, to build/preview/
     node video/render.mjs video   [1,2,3,driver]   every frame through ffmpeg, to build/out/

   Portrait 1080 x 1920 (the 540 x 960 stage at twice the pixels), 25 frames a
   second, H.264 in an MP4 that WhatsApp plays without converting. The
   driver video is longer, so it is squeezed a little harder to stay under 5 MB. FFMPEG
   names the ffmpeg to use; build.sh fetches one. Stops on a page error, or on
   a caption line that runs off the edge of the stage. */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, "build");
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || "playwright-core");
const FPS = 25;
const mode = process.argv[2] || "preview";
const which = (process.argv[3] || "1,2,3,driver").split(",").filter(Boolean);
const NAMES = { 1: "Sunday-Bus-1-Put-it-on-your-phone", 2: "Sunday-Bus-2-Book-your-seat", 3: "Sunday-Bus-3-Sunday-morning",
                driver: "Driver-Sunday-morning-to-the-end-of-the-run" };

/* The marks shots.mjs recorded, as a script the stage can load from disk. */
writeFileSync(join(BUILD, "marks.js"), "window.MARKS = " + readFileSync(join(BUILD, "shots", "marks.json"), "utf8") + ";\n");

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await page.goto("file://" + join(HERE, "stage.html") + "?clips=" + which.join(","));
await page.waitForFunction(() => window.READY || window.FAILED, null, { timeout: 30000 });
const failed = await page.evaluate(() => window.FAILED || null);
const over = await page.evaluate(() => window.OVER || []);
if (failed || errs.length || over.length) {
  if (failed) console.log("The stage did not build: " + failed);
  if (errs.length) console.log("Page errors:\n  " + errs.join("\n  "));
  if (over.length) console.log("Caption lines off the edge (shorten them or break them differently):\n  " + over.join("\n  "));
  await browser.close();
  process.exit(1);
}

for (const id of which) {
  const len = await page.evaluate((c) => window.clipLength(c), id);
  const scenes = await page.evaluate((c) => window.clipScenes(c), id);
  if (!scenes.length) { console.log("There is no clip " + id + "."); process.exitCode = 1; continue; }
  const mins = Math.floor(len / 60) + ":" + String(Math.round(len % 60)).padStart(2, "0");
  console.log("clip " + id + ": " + mins + ", " + scenes.length + " scenes");

  if (mode === "preview") {
    const dir = join(BUILD, "preview"); mkdirSync(dir, { recursive: true });
    let t0 = 0;
    for (let i = 0; i < scenes.length; i++) {
      await page.evaluate(([c, t]) => window.renderAt(c, t), [id, t0 + scenes[i] - 0.6]);
      await page.screenshot({ path: join(dir, "clip" + id + "-" + String(i + 1).padStart(2, "0") + ".png") });
      t0 += scenes[i];
    }
    continue;
  }

  /* Every frame piped straight in as a JPEG: nothing but the film is written. */
  const ffmpeg = process.env.FFMPEG || "ffmpeg";
  const out = join(BUILD, "out"); mkdirSync(out, { recursive: true });
  const file = join(out, NAMES[id] + ".mp4");
  const ff = spawn(ffmpeg, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", id === "driver" ? "27" : "24", "-tune", "animation", "-pix_fmt", "yuv420p",
    "-r", String(FPS), "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  const frames = Math.ceil(len * FPS);
  const started = Date.now();
  for (let f = 0; f < frames; f++) {
    await page.evaluate(([c, t]) => window.renderAt(c, t), [id, f / FPS]);
    const buf = await page.screenshot({ type: "jpeg", quality: 90 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f && f % 500 === 0) console.log("  frame " + f + " of " + frames + ", " + Math.round((Date.now() - started) / 1000) + " s");
  }
  ff.stdin.end();
  const code = await new Promise((r) => ff.on("close", r));
  if (code) { console.log("  ffmpeg failed on clip " + id); process.exitCode = 1; }
  else console.log("  " + file);
}
await browser.close();
