# Bot Telegram + DeepSeek (Chat, Dokumen, Gambar/OCR)

Bot Telegram yang terhubung ke DeepSeek AI. Selain chat biasa, bot ini juga bisa
membaca **dokumen** (PDF, DOCX, XLSX/CSV, TXT/MD) dan **teks di dalam gambar**
(via OCR), lalu mengirim hasilnya ke DeepSeek untuk diringkas/dijawab.

## Fitur
- Chat biasa langsung dijawab DeepSeek, dengan riwayat per chat (in-memory)
- **Dokumen**: kirim file PDF/DOCX/XLSX/CSV/TXT/MD → otomatis diekstrak & diringkas
  (atau dijawab sesuai caption yang kamu kasih)
- **Gambar**: kirim foto yang ada tulisannya (screenshot, foto soal, struk, dll) →
  dibaca via OCR (Tesseract, default Bahasa Inggris + Indonesia)
- `/start`, `/reset`, `/help`

## ⚠️ Batasan penting
DeepSeek API (yang dipakai bot ini) **belum punya vision / "mata"**. Jadi:
- Untuk **gambar**: bot hanya bisa membaca teks yang ADA di gambar (OCR). Kalau
  gambarnya foto pemandangan/orang/objek tanpa teks, bot tidak akan bisa
  mendeskripsikan isinya.
- Web `chat.deepseek.com` punya kesan "bisa baca gambar" karena di balik layar
  mereka melakukan OCR/parsing dulu sebelum dikirim ke model — bukan modelnya
  yang benar-benar "melihat". Bot ini meniru pendekatan yang sama.
- Kalau kamu butuh deskripsi visual asli (objek, warna, suasana foto, dst),
  itu butuh model vision terpisah (misalnya GPT-4o/Gemini vision) yang bisa
  ditambahkan sebagai pelengkap — tinggal bilang aja kalau mau ditambahin.

## 1. Siapkan Token Telegram Bot
1. Buka Telegram, chat ke **@BotFather**
2. Kirim `/newbot`, ikuti instruksinya
3. Simpan **token** yang diberikan

## 2. Siapkan API Key DeepSeek
1. Buka https://platform.deepseek.com → menu **API Keys**
2. Buat API key baru, simpan baik-baik (cuma muncul sekali)
3. Pastikan saldo cukup (DeepSeek berbayar per token, tapi tergolong murah)

> Catatan: nama model lama `deepseek-chat` / `deepseek-reasoner` akan **di-retire
> 24 Juli 2026**. Project ini sudah pakai nama baru: `deepseek-v4-flash` (default,
> murah & cepat) dan `deepseek-v4-pro` (lebih kuat untuk reasoning berat, lebih mahal).

## 3. Install & Jalankan
```bash
cd telegram-deepseek-bot
npm install

cp .env.example .env
nano .env   # isi TELEGRAM_BOT_TOKEN & DEEPSEEK_API_KEY

npm start
```

Kalau berhasil:
```
🤖 Bot Telegram-DeepSeek berhasil jalan!
```

## Cara Pakai
- **Chat biasa**: langsung ketik pesan
- **Tanya dokumen**: kirim file (PDF/DOCX/XLSX/CSV/TXT/MD) dengan caption
  pertanyaan, misal: *"ringkas bab 2 nya aja"*. Tanpa caption → otomatis diringkas.
- **Baca gambar**: kirim foto yang ada teksnya, dengan caption kalau mau diminta
  hal spesifik (misal: *"terjemahkan ke Inggris"*), tanpa caption → otomatis
  dijelaskan isinya.
- `/reset` untuk mulai obrolan baru dari awal (termasuk lupa dokumen/gambar sebelumnya)

## Catatan Teknis
- Riwayat obrolan disimpan in-memory (`Map`), hilang kalau bot restart. Untuk
  riwayat permanen, ganti ke database (SQLite/Redis) — bisa minta bantuan lagi.
- Teks dari dokumen/gambar dipotong maksimal ~12.000 karakter per pengiriman
  untuk menjaga biaya & kecepatan (bisa diubah lewat `MAX_EXTRACT_CHARS` di `index.js`).
- OCR pakai `tesseract.js`, otomatis download data bahasa saat pertama dipakai
  (butuh koneksi internet sekali, lalu di-cache).
- File PDF hasil scan tanpa layer teks (gambar murni) tidak akan terbaca oleh
  `pdf-parse` — kalau itu masalahnya, kirim sebagai foto saja biar lewat jalur OCR.
- Biar bot tetap online 24/7: deploy ke VPS + PM2 (`pm2 start index.js --name deepseek-bot`)
  atau platform seperti Railway/Render.
- Jangan commit file `.env` ke Git/repo publik.

## Struktur File
```
telegram-deepseek-bot/
├── index.js        # logic utama bot (chat, dokumen, OCR gambar)
├── package.json    # dependency project
├── .env.example     # contoh environment variable
└── README.md       # dokumen ini
```
