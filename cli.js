#!/usr/bin/env node

/**
 * CLI: ig-download
 * Usage:
 *   node cli.js <instagram-url>
 *   node cli.js <instagram-url> --out ./downloads
 *   node cli.js <instagram-url> --index 2   (untuk carousel, index mulai dari 0)
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.log(`
  ┌─────────────────────────────────────────┐
  │        IG Downloader CLI                │
  └─────────────────────────────────────────┘

  Usage:
    node cli.js <instagram-url>
    node cli.js <instagram-url> --out ./downloads
    node cli.js <instagram-url> --index 1

  Options:
    --out <dir>     Folder output (default: ./downloads)
    --index <n>     Index media carousel (default: 0)
    --server <url>  URL server API (default: http://localhost:3000)

  Contoh:
    node cli.js https://www.instagram.com/reel/ABC123/
    node cli.js https://www.instagram.com/p/ABC123/ --index 1 --out ./hasil
`);
  process.exit(0);
}

// ─── Parse args ───────────────────────────────────────────────────────────────
const igUrl = args[0];
let outDir = "./downloads";
let index = 0;
let serverBase = "http://localhost:3000";

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--out" && args[i + 1]) outDir = args[++i];
  if (args[i] === "--index" && args[i + 1]) index = parseInt(args[++i]);
  if (args[i] === "--server" && args[i + 1]) serverBase = args[++i];
}

// ─── Util ────────────────────────────────────────────────────────────────────
function log(msg)   { process.stdout.write(`\x1b[36m[IG]\x1b[0m ${msg}\n`); }
function ok(msg)    { process.stdout.write(`\x1b[32m[✓]\x1b[0m ${msg}\n`); }
function err(msg)   { process.stdout.write(`\x1b[31m[✗]\x1b[0m ${msg}\n`); }

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    let raw = "";
    const req = proto.get(url, (res) => {
      res.on("data", (d) => (raw += d));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error("Response bukan JSON: " + raw.slice(0, 100))); }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function downloadFile(fileUrl, dest) {
  return new Promise((resolve, reject) => {
    const proto = fileUrl.startsWith("https") ? https : http;
    const file = fs.createWriteStream(dest);
    let downloaded = 0;
    let total = 0;

    function doRequest(url) {
      proto.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: "https://www.instagram.com/",
        },
      }, (res) => {
        // Handle redirect
        if (res.statusCode === 301 || res.statusCode === 302) {
          doRequest(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        total = parseInt(res.headers["content-length"] || "0");

        res.on("data", (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = Math.round((downloaded / total) * 100);
            process.stdout.write(`\r  Progress: ${pct}% (${(downloaded / 1024 / 1024).toFixed(2)} MB)`);
          }
        });
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          process.stdout.write("\n");
          resolve();
        });
      }).on("error", reject);
    }

    doRequest(fileUrl);
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────
(async () => {
  log(`URL: ${igUrl}`);
  log("Menghubungi server API...");

  // Pastikan server jalan
  const infoUrl = `${serverBase}/download?url=${encodeURIComponent(igUrl)}`;

  let json;
  try {
    json = await fetchJson(infoUrl);
  } catch (e) {
    err(`Tidak bisa konek ke server: ${e.message}`);
    err(`Pastikan server sudah jalan: npm start`);
    process.exit(1);
  }

  if (!json.success) {
    err(`Gagal: ${json.error}`);
    process.exit(1);
  }

  const data = json.data;
  log(`Tipe media: ${data.type}`);

  // Buat folder output
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Tentukan URL stream
  let streamUrl;
  let destFile;

  if (data.type === "video") {
    streamUrl = `${serverBase}/stream?url=${encodeURIComponent(igUrl)}`;
    destFile = path.join(outDir, `ig_${data.shortcode}.mp4`);
  } else if (data.type === "image") {
    streamUrl = `${serverBase}/stream?url=${encodeURIComponent(igUrl)}`;
    destFile = path.join(outDir, `ig_${data.shortcode}.jpg`);
  } else if (data.type === "carousel") {
    log(`Carousel berisi ${data.medias.length} media. Mengunduh index ${index}...`);
    const m = data.medias[index];
    if (!m) { err(`Index ${index} tidak ada`); process.exit(1); }
    streamUrl = `${serverBase}/stream?url=${encodeURIComponent(igUrl)}&index=${index}`;
    destFile = path.join(outDir, `ig_${data.shortcode}_${index}.${m.type === "video" ? "mp4" : "jpg"}`);
  }

  log(`Mengunduh ke: ${destFile}`);

  try {
    await downloadFile(streamUrl, destFile);
    ok(`Selesai! File disimpan: ${destFile}`);
  } catch (e) {
    err(`Gagal download: ${e.message}`);
    process.exit(1);
  }
})();
