# Spotify Lyrics Visualizer (Web)

Web app yang nge-track lagu yang lagi kamu putar di Spotify, lalu nampilin
liriknya sebagai catatan yang melayang dari bawah ke atas di canvas, dengan
warna tema yang diambil otomatis dari cover album lagu tersebut.

Jalan 100% di browser — tidak ada backend/server custom, tidak ada secret
yang perlu disembunyikan (pakai Authorization Code + PKCE flow, aman dipakai
langsung dari sisi client).

Cara kerja singkat:
- **Data lagu yang sedang diputar** → Spotify Web API resmi (login via OAuth).
- **Lirik tersinkron per-baris** → [lrclib.net](https://lrclib.net) (database
  lirik LRC gratis, tanpa API key). Tidak semua lagu ada — kalau tidak
  ketemu, visual tetap jalan tanpa animasi lirik.
- **Warna tema** → cover album digambar ke `<canvas>` tersembunyi, lalu
  dianalisis buat cari warna-warna dominan (tanpa library eksternal).

---

## 1. Bikin Spotify App

1. Buka https://developer.spotify.com/dashboard dan login.
2. Klik **"Create app"**.
3. Isi:
   - **App name**: bebas, misal `Lyrics Visualizer`
   - **Redirect URI**: `http://127.0.0.1:8080/`
     (perhatikan trailing slash `/` di akhir — harus PERSIS sama nanti)
   - Centang **Web API**
4. Save, lalu buka **Settings** app tersebut → catat **Client ID**
   (tidak perlu Client Secret sama sekali untuk web app ini).

> Kalau nanti kamu juga mau host di GitHub Pages, kamu bisa klik **"Add
> Redirect URI"** lagi di step ini dan tambahkan URL GitHub Pages kamu
> sekalian (lihat bagian "Deploy ke GitHub Pages" di bawah). Spotify
> mengizinkan lebih dari satu Redirect URI terdaftar di app yang sama.

## 2. Isi konfigurasi

Buka `app.js`, edit baris paling atas — cuma `CLIENT_ID` yang perlu diisi
manual, `REDIRECT_URI` sudah otomatis ngikutin URL tempat halaman dibuka:

```js
const CLIENT_ID = "ISI_CLIENT_ID_KAMU_DISINI";   // <- ganti dengan Client ID kamu
```

## 3. Jalankan lewat local server

Browser tidak bisa handle OAuth redirect dari `file://`, jadi harus dibuka
lewat server lokal. Pilih salah satu:

**Pakai Python (sudah ada di kebanyakan komputer):**
```bash
cd spotify-lyrics-web
python3 -m http.server 8080
```

**Atau pakai Node:**
```bash
cd spotify-lyrics-web
npx serve -l 8080
```

Lalu buka browser ke **http://127.0.0.1:8080/**

> Penting: alamatnya harus persis `127.0.0.1:8080`, bukan `localhost:8080`,
> supaya cocok dengan Redirect URI yang didaftarkan (kecuali kamu ganti
> keduanya jadi `localhost` secara konsisten).

## 4. Pakai

1. Klik **"Login dengan Spotify"** → login & authorize (cuma minta izin baca
   lagu yang diputar, tidak bisa kontrol apapun).
2. Setelah kembali ke halaman, mulai **putar lagu di Spotify** (device
   manapun, asal akun yang sama).
3. Lirik bakal otomatis melayang naik sesuai timing lagu, background
   berubah warna sesuai cover album.

## Catatan & keterbatasan

- Fitur "currently playing" paling stabil dengan akun **Spotify Premium**;
  akun gratis kadang delay/tidak selalu update real-time.
- Lirik hanya muncul kalau ada versi tersinkron (LRC) di lrclib.net.
- Token disimpan di `localStorage` browser kamu sendiri (tidak dikirim
  kemana-mana selain ke Spotify) — tinggal refresh token otomatis kalau
  access token expired.
- Polling ke Spotify tiap 1 detik (`POLL_INTERVAL_MS` di `app.js`) untuk
  menghindari rate limit.
- Kalau gambar cover album gagal dianalisis warnanya (jarang terjadi, biasa
  karena CORS), otomatis fallback ke palet warna hijau Spotify.

## Struktur file

```
spotify-lyrics-web/
├── index.html   # struktur halaman + login screen
├── style.css    # styling
├── app.js       # auth PKCE, polling, lirik, warna, animasi canvas
├── .gitignore
└── README.md
```

---

## Push ke GitHub

Folder ini sudah di-`git init` dan sudah ada 1 commit awal. Tinggal bikin
repo kosong di GitHub, lalu:

```bash
cd spotify-lyrics-web
git remote add origin https://github.com/USERNAME_KAMU/NAMA_REPO.git
git branch -M main
git push -u origin main
```

Ganti `USERNAME_KAMU` dan `NAMA_REPO` sesuai repo yang kamu buat di GitHub.

## Deploy ke GitHub Pages (opsional, biar bisa diakses online)

1. Push dulu seperti di atas.
2. Di halaman repo GitHub → **Settings** → **Pages**.
3. Di **Source**, pilih branch `main`, folder `/ (root)` → **Save**.
4. Tunggu 1–2 menit, GitHub kasih URL kayak:
   `https://USERNAME_KAMU.github.io/NAMA_REPO/`
5. Buka **Spotify Developer Dashboard** → app kamu → **Settings** →
   tambahkan URL itu sebagai Redirect URI baru (dengan trailing slash `/`
   di akhir, sama persis).
6. Buka URL GitHub Pages itu di browser → login Spotify → jalan seperti
   biasa, tanpa perlu server lokal lagi.

Karena `REDIRECT_URI` di `app.js` otomatis ngikutin URL halaman, kamu bisa
pakai app yang sama baik lewat `http://127.0.0.1:8080/` (development) maupun
`https://USERNAME_KAMU.github.io/NAMA_REPO/` (production) — asal keduanya
sudah didaftarkan sebagai Redirect URI di Spotify Dashboard.
