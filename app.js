// =========================================================
// KONFIGURASI — WAJIB DIISI sebelum dijalankan (lihat README.md)
// =========================================================
const CLIENT_ID = "a8c28c7cc2dd47579aa04bc8bdbf84e6";
// Otomatis mengikuti URL tempat halaman ini dibuka (localhost ATAU GitHub
// Pages). Yang penting: URL persis ini (origin + path) harus didaftarkan
// sebagai Redirect URI di Spotify Dashboard. Boleh daftar lebih dari satu
// Redirect URI sekaligus (misal versi localhost DAN versi GitHub Pages).
const REDIRECT_URI = window.location.origin + window.location.pathname;

const SCOPE = "user-read-currently-playing user-read-playback-state";
const POLL_INTERVAL_MS = 1000;
const FALLBACK_PALETTE = [
  [29, 185, 84],
  [18, 18, 18],
  [255, 255, 255],
];

// =========================================================
// PKCE helpers
// =========================================================
function generateRandomString(length) {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  let text = "";
  randomValues.forEach((v) => (text += possible[v % possible.length]));
  return text;
}

async function sha256(plain) {
  const data = new TextEncoder().encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

function base64UrlEncode(buffer) {
  let str = "";
  new Uint8Array(buffer).forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generateCodeChallenge(verifier) {
  return base64UrlEncode(await sha256(verifier));
}

// =========================================================
// Auth flow
// =========================================================
async function login() {
  const verifier = generateRandomString(64);
  localStorage.setItem("spotify_code_verifier", verifier);
  const challenge = await generateCodeChallenge(verifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  window.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function handleRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return false;

  const verifier = localStorage.getItem("spotify_code_verifier");
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await resp.json();

  if (data.access_token) {
    saveTokens(data);
    window.history.replaceState({}, document.title, REDIRECT_URI);
    return true;
  }
  return false;
}

function saveTokens(data) {
  const expiresAt = Date.now() + data.expires_in * 1000;
  localStorage.setItem("spotify_access_token", data.access_token);
  localStorage.setItem("spotify_token_expires", String(expiresAt));
  if (data.refresh_token) {
    localStorage.setItem("spotify_refresh_token", data.refresh_token);
  }
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem("spotify_refresh_token");
  if (!refreshToken) return null;

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await resp.json();
  if (data.access_token) {
    saveTokens(data);
    return data.access_token;
  }
  return null;
}

async function getValidAccessToken() {
  const expiresAt = parseInt(
    localStorage.getItem("spotify_token_expires") || "0",
    10
  );
  if (Date.now() < expiresAt - 5000) {
    return localStorage.getItem("spotify_access_token");
  }
  return await refreshAccessToken();
}

// =========================================================
// Spotify data
// =========================================================
async function getNowPlaying() {
  const token = await getValidAccessToken();
  if (!token) return null;

  let resp;
  try {
    resp = await fetch(
      "https://api.spotify.com/v1/me/player/currently-playing",
      { headers: { Authorization: `Bearer ${token}` } }
    );
  } catch (e) {
    console.error("[Spotify] Gagal konek ke API:", e);
    return null;
  }

  if (resp.status === 204) {
    // Resmi: memang tidak ada apa-apa yang diputar.
    return null;
  }

  if (resp.status === 401) {
    console.warn("[Spotify] Token ditolak (401) — coba logout & login ulang.");
    return null;
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(`[Spotify] API error ${resp.status}:`, errText);
    return null;
  }

  // Quirk Spotify: kadang status 200 tapi body-nya kosong.
  const raw = await resp.text();
  if (!raw) return null;

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error("[Spotify] Gagal parse response JSON:", raw);
    return null;
  }

  if (!data || !data.item) {
    console.warn("[Spotify] Response gak ada 'item' — mungkin lagi mutar iklan/podcast, atau device tidak terdeteksi sebagai aktif.", data);
    return null;
  }

  const images = data.item.album?.images || [];
  return {
    id: data.item.id,
    name: data.item.name,
    artist: (data.item.artists || []).map((a) => a.name).join(", ") || data.item.show?.name || "Unknown",
    album: data.item.album?.name,
    durationMs: data.item.duration_ms,
    progressMs: data.progress_ms || 0,
    isPlaying: data.is_playing,
    albumArtUrl: images[0] ? images[0].url : null,
  };
}

// =========================================================
// Lirik tersinkron dari lrclib.net
// =========================================================
async function fetchLyrics(trackName, artistName, albumName, durationSec) {
  const params = new URLSearchParams({
    track_name: trackName,
    artist_name: artistName,
  });
  if (albumName) params.set("album_name", albumName);
  if (durationSec) params.set("duration", String(Math.round(durationSec)));

  try {
    const resp = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.syncedLyrics) return null;
    return parseLRC(data.syncedLyrics);
  } catch (e) {
    return null;
  }
}

function parseLRC(text) {
  const lineRe = /\[(\d{2}):(\d{2}(?:\.\d{1,2})?)\](.*)/;
  const lines = [];
  text.split("\n").forEach((raw) => {
    const m = lineRe.exec(raw.trim());
    if (!m) return;
    const minutes = parseInt(m[1], 10);
    const seconds = parseFloat(m[2]);
    const content = m[3].trim();
    if (content) lines.push({ time: minutes * 60 + seconds, text: content });
  });
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

// =========================================================
// Ekstraksi warna dari cover album (via canvas, tanpa library luar)
// =========================================================
async function extractPalette(imageUrl, colorCount = 5) {
  return new Promise((resolve) => {
    if (!imageUrl) return resolve(FALLBACK_PALETTE);

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const size = 48;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        const buckets = {};
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const key = `${r >> 5}-${g >> 5}-${b >> 5}`; // kuantisasi kasar
          if (!buckets[key]) buckets[key] = { r: 0, g: 0, b: 0, count: 0 };
          buckets[key].r += r;
          buckets[key].g += g;
          buckets[key].b += b;
          buckets[key].count += 1;
        }

        const sorted = Object.values(buckets).sort((a, b) => b.count - a.count);
        const palette = sorted.slice(0, colorCount).map((bucket) => [
          Math.round(bucket.r / bucket.count),
          Math.round(bucket.g / bucket.count),
          Math.round(bucket.b / bucket.count),
        ]);

        resolve(palette.length ? palette : FALLBACK_PALETTE);
      } catch (e) {
        // Kemungkinan canvas "tainted" karena CORS gambar
        resolve(FALLBACK_PALETTE);
      }
    };

    img.onerror = () => resolve(FALLBACK_PALETTE);
    img.src = imageUrl;
  });
}

// =========================================================
// Animasi: lirik melayang + partikel latar
// =========================================================
class LyricNote {
  constructor(text, color, x, y) {
    this.text = text;
    this.color = color;
    this.x = x;
    this.y = y;
    this.age = 0;
    this.lifetime = 6.5;
    this.speed = 45;
    this.drift = Math.random() * 16 - 8;
  }

  update(dt) {
    this.age += dt;
    this.y -= this.speed * dt;
    this.x += this.drift * dt;
  }

  isDead() {
    return this.age >= this.lifetime;
  }

  draw(ctx) {
    const fadeIn = 0.4;
    const fadeOutStart = this.lifetime - 1.2;
    let alpha;
    if (this.age < fadeIn) alpha = this.age / fadeIn;
    else if (this.age > fadeOutStart)
      alpha = Math.max(0, 1 - (this.age - fadeOutStart) / 1.2);
    else alpha = 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = "600 28px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.shadowColor = `rgb(${this.color.join(",")})`;
    ctx.shadowBlur = 22;
    ctx.fillStyle = `rgb(${this.color.join(",")})`;
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
}

class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.radius = Math.random() * 3 + 1.5;
    this.speed = Math.random() * 17 + 8;
    this.alpha = Math.random() * 0.3 + 0.15;
  }

  update(dt, height) {
    this.y -= this.speed * dt;
    if (this.y < -10) this.y = height + 10;
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = `rgb(${this.color.join(",")})`;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// =========================================================
// State & main loop
// =========================================================
let canvas, ctx;
let palette = FALLBACK_PALETTE;
let notes = [];
let particles = [];
let currentTrackId = null;
let lyricsLines = [];
let nextLyricIndex = 0;
let lastPoll = 0;
let nowPlaying = null;
let statusMessage = "Menghubungkan ke Spotify...";

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function initParticles() {
  particles = [];
  for (let i = 0; i < 45; i++) {
    particles.push(
      new Particle(
        Math.random() * canvas.width,
        Math.random() * canvas.height,
        palette[0]
      )
    );
  }
}

async function pollSpotify() {
  let info;
  try {
    info = await getNowPlaying();
  } catch (e) {
    console.error("[Spotify] pollSpotify gagal:", e);
    statusMessage = "Error konek ke Spotify — cek console (F12) buat detail.";
    return;
  }
  nowPlaying = info;

  if (!info) {
    statusMessage = "Gak ada lagu yang sedang diputar.";
    return;
  }

  statusMessage = `${info.name} \u2014 ${info.artist}`;

  if (info.id !== currentTrackId) {
    currentTrackId = info.id;
    nextLyricIndex = 0;
    notes = [];

    const lines = await fetchLyrics(
      info.name,
      info.artist,
      info.album,
      info.durationMs / 1000
    );
    lyricsLines = lines || [];
    if (!lyricsLines.length) {
      statusMessage += "  (lirik tersinkron tidak ditemukan)";
    }

    palette = await extractPalette(info.albumArtUrl, 5);
    particles.forEach((p) => {
      p.color = palette[Math.floor(Math.random() * palette.length)];
    });
  }
}

function checkNewLyrics() {
  if (!nowPlaying || !lyricsLines.length || !nowPlaying.isPlaying) return;

  const elapsedSincePoll = (Date.now() - lastPoll) / 1000;
  const progressSec = nowPlaying.progressMs / 1000 + elapsedSincePoll;

  while (
    nextLyricIndex < lyricsLines.length &&
    lyricsLines[nextLyricIndex].time <= progressSec
  ) {
    spawnNote(lyricsLines[nextLyricIndex].text);
    nextLyricIndex++;
  }
}

function spawnNote(text) {
  const base =
    palette[Math.floor(Math.random() * Math.min(3, palette.length))] ||
    [255, 255, 255];
  const bright = base.map((c) => Math.max(c, 90));
  const x = canvas.width / 2 + (Math.random() * 120 - 60);
  const y = canvas.height - 50;
  notes.push(new LyricNote(text, bright, x, y));
}

function lerpColor(c1, c2, t) {
  return [0, 1, 2].map((i) => Math.round(c1[i] + (c2[i] - c1[i]) * t));
}

let lastFrameTime = performance.now();

async function loop(now) {
  const dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  if (lastPoll === 0 || now - lastPoll >= POLL_INTERVAL_MS) {
    lastPoll = now;
    pollSpotify(); // tidak di-await biar animasi tetap smooth
  }

  checkNewLyrics();

  const top = palette[0] || FALLBACK_PALETTE[0];
  const bottomRaw = palette[palette.length - 1] || [10, 10, 10];
  const bottom = bottomRaw.map((c) => Math.floor(c / 4));

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, `rgb(${top.join(",")})`);
  grad.addColorStop(1, `rgb(${bottom.join(",")})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  particles.forEach((p) => {
    p.update(dt, canvas.height);
    p.draw(ctx);
  });

  notes = notes.filter((n) => !n.isDead());
  notes.forEach((n) => {
    n.update(dt);
    n.draw(ctx);
  });

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "#ffffff";
  ctx.font = "14px 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(statusMessage, 16, canvas.height - 16);
  ctx.restore();

  requestAnimationFrame(loop);
}

// =========================================================
// Init
// =========================================================
async function init() {
  canvas = document.getElementById("visualizer");
  ctx = canvas.getContext("2d");
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  document.getElementById("login-btn").addEventListener("click", login);

  await handleRedirect();
  const token = await getValidAccessToken();

  if (token) {
    document.getElementById("login-screen").style.display = "none";
    initParticles();
    requestAnimationFrame(loop);
  } else {
    document.getElementById("login-screen").style.display = "flex";
  }
}

init();
