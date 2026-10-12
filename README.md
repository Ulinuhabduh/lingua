# Lingua

Lingua adalah aplikasi belajar bahasa Inggris dengan materi harian dan latihan percakapan suara.

## Deploy ke Vercel

Vercel menjalankan endpoint AI sebagai Vercel Functions dari folder `api/`; file `server.mjs` hanya untuk menjalankan versi lokal.

1. Import repository ini ke Vercel dan pastikan Root Directory mengarah ke folder proyek ini.
2. Di **Project Settings → Environment Variables**, tambahkan `OPENAI_API_KEY`. Model dapat diatur dengan `OPENAI_LESSON_MODEL`, `OPENAI_FEEDBACK_MODEL`, dan `OPENAI_REALTIME_MODEL`.
3. Deploy ulang setelah menyimpan environment variables.
4. Buka `https://domainmu/api/status`. Pastikan respons JSON memuat `"configured":true`.

Jangan commit file `.env` atau menaruh API key di frontend. Key Vercel disimpan sebagai Environment Variable server-side.

## Menjalankan aplikasi lokal

1. Gunakan Node.js 20 atau lebih baru.
2. Salin `.env.example` menjadi `.env`, lalu isi `OPENAI_API_KEY` dengan API key milikmu.
3. Jalankan `node server.mjs`.
4. Buka `http://localhost:3000` di browser.

Jangan menaruh API key di `app.js` atau berkas frontend. Server membaca key dari `.env`; API key tidak dikirim ke browser.

## Model yang digunakan

- `OPENAI_LESSON_MODEL` membuat satu paket materi vocabulary, grammar, reading, listening, speaking, dan writing untuk tanggal dan level belajar.
- `OPENAI_REALTIME_MODEL` menjalankan percakapan suara dua arah dengan partner AI.
- `OPENAI_FEEDBACK_MODEL` memberi masukan untuk speaking dan writing.

Materi harian disimpan di browser untuk tanggal tersebut, sehingga halaman lain memakai tema yang sama sepanjang hari dan meminta materi baru pada tanggal berikutnya. Untuk mengubah level atau model, atur nilai di `.env` lalu mulai ulang server.

Sesi speaking mengirim audio mikrofon ke OpenAI Realtime. Setelah sesi selesai, transkrip percakapan dikirim ke model feedback. Suara partner adalah suara AI. Mikrofon dan pemasangan PWA di produksi memerlukan situs HTTPS; `localhost` dapat digunakan untuk pengembangan.
