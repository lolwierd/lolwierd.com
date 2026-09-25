// Render the film to video.
//
//   node journey/render.mjs          cues + frames + mux  -> journey/out/the-long-way-up.mp4
//   node journey/render.mjs --cues   only write journey/out/cues.json
//
// Serves the repo root itself (the page reads the photograph and the font from
// public/), steps render(t) through every frame in headless Chromium and pipes
// the PNGs straight into ffmpeg, so no frame ever touches the disk. The score
// is synthesised separately by score.py from the cues written here.

import { createServer } from "node:http";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = join(here, "out");
const require = createRequire(import.meta.url);

function loadPlaywright() {
  for (const id of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try { return require(id); } catch {}
  }
  throw new Error("playwright is not installed (npm i -g playwright)");
}

function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try {
    return execFileSync("python3", ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]).toString().trim();
  } catch {}
  return "ffmpeg";
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".wav": "audio/wav" };

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = resolve(root, "." + path);
      if (!file.startsWith(root)) throw new Error("outside root");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404); res.end();
    }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

const args = process.argv.slice(2);
const cuesOnly = args.includes("--cues");
const from = Number(args.find((a) => a.startsWith("--from="))?.split("=")[1] ?? 0);
const toArg = args.find((a) => a.startsWith("--to="))?.split("=")[1];
const scale = Number(args.find((a) => a.startsWith("--scale="))?.split("=")[1] ?? 1);

await mkdir(out, { recursive: true });
const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/journey/index.html?capture`;
const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", (e) => { console.error(e); process.exit(1); });
await page.goto(url);
await page.evaluate(() => window.film.ready);

const cues = await page.evaluate(() => window.film.cues());
await writeFile(join(out, "cues.json"), JSON.stringify(cues));
console.log(`cues: ${cues.length}`);

if (!cuesOnly) {
  const fps = await page.evaluate(() => window.film.fps);
  const ffmpeg = findFfmpeg();
  const video = join(out, scale === 1 ? "picture.mp4" : "preview.mp4");
  const vf = scale === 1 ? [] : ["-vf", `scale=${Math.round(1920 * scale)}:-2:flags=neighbor`];
  // CRF 16 keeps the two-pixel grain crisp; the frame is mostly flat paper,
  // so it costs less than it sounds.
  const enc = spawn(ffmpeg, [
    "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
    ...vf, "-c:v", "libx264", "-preset", "slow", "-crf", scale === 1 ? "16" : "22", "-tune", "animation",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", video
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const to = toArg ? Number(toArg) : await page.evaluate(() => window.film.duration);
  const n0 = Math.round(from * fps), n1 = Math.round(to * fps);
  const t0 = Date.now();
  for (let i = n0; i < n1; i++) {
    await page.evaluate((t) => window.film.render(t), i / fps);
    const png = await page.screenshot({ type: "png" });
    if (!enc.stdin.write(png)) await new Promise((ok) => enc.stdin.once("drain", ok));
    if (i % 60 === 0) process.stdout.write(`\rframe ${i}/${n1}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  enc.stdin.end();
  await new Promise((ok, fail) => enc.on("close", (c) => (c === 0 ? ok() : fail(new Error("ffmpeg " + c)))));
  console.log(`\nwrote ${video}`);

  const score = join(out, "score.wav");
  if (scale === 1 && (await access(score).then(() => true, () => false))) {
    const final = join(out, "the-long-way-up.mp4");
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", video, "-i", score, "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", final]);
    console.log(`wrote ${final}`);
  }
}

await browser.close();
server.close();
