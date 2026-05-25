const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve frontend HTML
app.use(express.static(path.join(__dirname, "public")));

// ─── Helper: Extract shortcode ───────────────────────────────────────────────
function extractShortcode(url) {
  const match = url.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

// ─── Helper: Fetch media info ────────────────────────────────────────────────
async function fetchInstagramMedia(url) {
  const shortcode = extractShortcode(url);
  if (!shortcode) throw new Error("URL Instagram tidak valid");

  const apiUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.instagram.com/",
    "x-ig-app-id": "936619743392459",
  };

  const response = await axios.get(apiUrl, { headers, timeout: 10000 });
  const data = response.data;

  const item =
    data?.items?.[0] ||
    data?.graphql?.shortcode_media ||
    data?.data?.shortcode_media;

  if (!item) throw new Error("Gagal mengambil data media. Pastikan akun publik.");

  const typename = item.__typename || item.media_type;

  if (typename === "GraphVideo" || item.media_type === 2) {
    return {
      type: "video",
      shortcode,
      url: item.video_url,
      thumbnail: item.display_url || item.image_versions2?.candidates?.[0]?.url,
      duration: item.video_duration,
    };
  }

  if (typename === "GraphSidecar" || item.media_type === 8) {
    const medias = (
      item.edge_sidecar_to_children?.edges || item.carousel_media || []
    ).map((e) => {
      const node = e.node || e;
      return {
        type: node.__typename === "GraphVideo" || node.media_type === 2 ? "video" : "image",
        url: node.video_url || node.display_url || node.image_versions2?.candidates?.[0]?.url,
        thumbnail: node.display_url || node.image_versions2?.candidates?.[0]?.url,
      };
    });
    return { type: "carousel", shortcode, medias };
  }

  return {
    type: "image",
    shortcode,
    url: item.display_url || item.image_versions2?.candidates?.[0]?.url,
  };
}

// ─── GET / ───────────────────────────────────────────────────────────────────
app.get("/api", (req, res) => {
  res.json({
    status: "ok",
    message: "Instagram Downloader API",
    endpoints: {
      "POST /download": "Ambil info media (JSON)",
      "GET /download?url=...": "Ambil info media via query param",
      "GET /stream?url=...": "Langsung stream/download file",
    },
  });
});

// ─── POST /download ───────────────────────────────────────────────────────────
app.post("/download", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: "URL wajib diisi" });

  try {
    const result = await fetchInstagramMedia(url);
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /download?url=... ────────────────────────────────────────────────────
app.get("/download", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ success: false, error: "URL wajib diisi" });

  try {
    const result = await fetchInstagramMedia(url);
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /stream?url=... — Langsung download file ─────────────────────────────
app.get("/stream", async (req, res) => {
  const { url, index } = req.query;
  if (!url) return res.status(400).json({ success: false, error: "URL wajib diisi" });

  try {
    const result = await fetchInstagramMedia(url);

    let fileUrl;
    let filename;

    if (result.type === "video") {
      fileUrl = result.url;
      filename = `ig_${result.shortcode}.mp4`;
    } else if (result.type === "image") {
      fileUrl = result.url;
      filename = `ig_${result.shortcode}.jpg`;
    } else if (result.type === "carousel") {
      const idx = parseInt(index || "0");
      const media = result.medias[idx];
      if (!media) return res.status(400).json({ success: false, error: "Index tidak valid" });
      fileUrl = media.url;
      filename = `ig_${result.shortcode}_${idx}.${media.type === "video" ? "mp4" : "jpg"}`;
    }

    const fileRes = await axios.get(fileUrl, {
      responseType: "stream",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://www.instagram.com/",
      },
      timeout: 30000,
    });

    const contentType = fileRes.headers["content-type"] || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    if (fileRes.headers["content-length"]) {
      res.setHeader("Content-Length", fileRes.headers["content-length"]);
    }

    fileRes.data.pipe(res);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
  console.log(` Frontend: http://localhost:${PORT}`);
  console.log(` API info: http://localhost:${PORT}/api`);
});
