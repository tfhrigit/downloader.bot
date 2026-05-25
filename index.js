const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─── Helper: Extract shortcode dari URL IG ───────────────────────────────────
function extractShortcode(url) {
  const match = url.match(
    /instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/
  );
  return match ? match[1] : null;
}

// ─── Helper: Fetch via unofficial IG API ────────────────────────────────────
async function fetchInstagramMedia(url) {
  const shortcode = extractShortcode(url);
  if (!shortcode) throw new Error("URL Instagram tidak valid");

  // Pakai endpoint graphql publik Instagram
  const apiUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
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

  if (!item) throw new Error("Gagal mengambil data media");

  const typename = item.__typename || item.media_type;

  // Video tunggal
  if (typename === "GraphVideo" || item.media_type === 2) {
    return {
      type: "video",
      shortcode,
      url: item.video_url,
      thumbnail: item.display_url || item.image_versions2?.candidates?.[0]?.url,
      duration: item.video_duration,
    };
  }

  // Carousel (bisa ada video di dalamnya)
  if (typename === "GraphSidecar" || item.media_type === 8) {
    const medias = (
      item.edge_sidecar_to_children?.edges ||
      item.carousel_media ||
      []
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

  // Gambar biasa
  return {
    type: "image",
    shortcode,
    url: item.display_url || item.image_versions2?.candidates?.[0]?.url,
  };
}

// ─── Route: GET / ─────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Instagram Downloader API",
    endpoints: {
      "POST /download": "{ url: 'https://www.instagram.com/p/...' }",
      "GET /download?url=...": "Query param",
    },
  });
});

// ─── Route: POST /download ────────────────────────────────────────────────
app.post("/download", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: "URL wajib diisi" });
  }

  try {
    const result = await fetchInstagramMedia(url);
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Gagal mengambil media",
    });
  }
});

// ─── Route: GET /download?url=... ────────────────────────────────────────
app.get("/download", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ success: false, error: "URL wajib diisi" });
  }

  try {
    const result = await fetchInstagramMedia(url);
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Gagal mengambil media",
    });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server berjalan di http://localhost:${PORT}`);
});
