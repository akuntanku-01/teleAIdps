require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const { createWorker } = require('tesseract.js');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
// deepseek-chat / deepseek-reasoner akan di-retire 24 Juli 2026, jadi default-nya
// langsung pakai nama model baru. Lihat .env.example untuk alternatif.
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const OCR_LANGS = process.env.OCR_LANGS || 'eng+ind';

const MAX_HISTORY = 10; // jumlah pesan (user + assistant) yang disimpan per chat
const MAX_EXTRACT_CHARS = 12000; // batas karakter teks hasil ekstraksi dokumen/gambar

if (!BOT_TOKEN || !DEEPSEEK_API_KEY) {
  console.error('❌ TELEGRAM_BOT_TOKEN atau DEEPSEEK_API_KEY belum diset di file .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Riwayat percakapan per chat, in-memory (hilang kalau bot di-restart).
const conversations = new Map();

function getHistory(chatId) {
  if (!conversations.has(chatId)) {
    conversations.set(chatId, []);
  }
  return conversations.get(chatId);
}

function trimHistory(history) {
  while (history.length > MAX_HISTORY) {
    history.shift();
  }
}

function truncateText(text, max = MAX_EXTRACT_CHARS) {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max), truncated: true };
}

// ---------- Pemanggilan DeepSeek ----------

async function askDeepSeek(chatId, userText) {
  const history = getHistory(chatId);

  const messages = [
    {
      role: 'system',
      content:
        'Kamu adalah asisten AI yang ramah, jelas, dan membantu. Jawab dalam Bahasa Indonesia kecuali user memakai bahasa lain. ' +
        'Kalau user mengirim isi dokumen atau hasil OCR dari gambar, bantu analisis/ringkas/jawab sesuai permintaan mereka.',
    },
    ...history,
    { role: 'user', content: userText },
  ];

  const response = await axios.post(
    'https://api.deepseek.com/chat/completions',
    {
      model: DEEPSEEK_MODEL,
      messages,
      temperature: 0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    }
  );

  const reply = response.data.choices[0].message.content;

  history.push({ role: 'user', content: userText });
  history.push({ role: 'assistant', content: reply });
  trimHistory(history);

  return reply;
}

// ---------- Download file dari Telegram ----------

async function downloadTelegramFile(ctx, fileId) {
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}

// ---------- Ekstraksi teks dokumen ----------

async function extractFromDocument(buffer, fileName, mimeType) {
  const name = (fileName || '').toLowerCase();

  if (name.endsWith('.pdf') || mimeType === 'application/pdf') {
    const data = await pdfParse(buffer);
    return data.text.trim();
  }

  if (name.endsWith('.docx') || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    let text = '';
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      text += `--- Sheet: ${sheetName} ---\n${csv}\n\n`;
    });
    return text.trim();
  }

  if (name.endsWith('.txt') || name.endsWith('.md') || mimeType === 'text/plain') {
    return buffer.toString('utf-8').trim();
  }

  return null; // format tidak didukung
}

// ---------- OCR gambar ----------

async function extractFromImage(buffer) {
  const worker = await createWorker(OCR_LANGS);
  try {
    const { data } = await worker.recognize(buffer);
    return (data.text || '').trim();
  } finally {
    await worker.terminate();
  }
}

// ---------- Command handlers ----------

bot.start((ctx) => {
  conversations.delete(ctx.chat.id);
  ctx.reply(
    'Halo! 👋 Aku bot Telegram yang terhubung ke DeepSeek AI.\n\n' +
      'Aku bisa:\n' +
      '• Chat biasa\n' +
      '• Baca dokumen (PDF, DOCX, XLSX/CSV, TXT/MD) — kirim sebagai file\n' +
      '• Baca teks di dalam gambar (OCR) — kirim sebagai foto\n\n' +
      'Kasih caption di file/foto kalau mau nanya hal spesifik, kalau enggak nanti aku ringkas otomatis.\n\n' +
      'Ketik /reset kalau mau mulai obrolan baru dari awal.'
  );
});

bot.command('reset', (ctx) => {
  conversations.delete(ctx.chat.id);
  ctx.reply('Riwayat obrolan sudah direset ✅');
});

bot.help((ctx) => {
  ctx.reply(
    'Perintah yang tersedia:\n' +
      '/start - mulai bot\n' +
      '/reset - hapus riwayat obrolan\n' +
      '/help - tampilkan bantuan ini\n\n' +
      'Selain itu:\n' +
      '• Ketik pesan biasa untuk ngobrol\n' +
      '• Kirim dokumen (PDF/DOCX/XLSX/CSV/TXT) untuk diringkas/ditanya\n' +
      '• Kirim foto yang ada tulisannya untuk dibaca via OCR\n\n' +
      'Catatan: DeepSeek belum punya "mata" asli, jadi untuk foto, bot hanya bisa membaca TEKS di dalam gambar, bukan mendeskripsikan objek/pemandangan.'
  );
});

// ---------- Chat teks biasa ----------

bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return; // command tidak dikenal, biarkan
  const chatId = ctx.chat.id;
  const userText = ctx.message.text;

  try {
    await ctx.sendChatAction('typing');
    const reply = await askDeepSeek(chatId, userText);
    await ctx.reply(reply);
  } catch (err) {
    console.error('Error saat memanggil DeepSeek:', err?.response?.data || err.message);
    await ctx.reply('Maaf, ada masalah saat menghubungi DeepSeek. Coba lagi sebentar ya 🙏');
  }
});

// ---------- Dokumen ----------

bot.on('document', async (ctx) => {
  const chatId = ctx.chat.id;
  const doc = ctx.message.document;
  const caption = ctx.message.caption || '';

  try {
    await ctx.sendChatAction('upload_document');
    await ctx.reply(`📄 Memproses "${doc.file_name}"...`);

    const buffer = await downloadTelegramFile(ctx, doc.file_id);
    const rawText = await extractFromDocument(buffer, doc.file_name, doc.mime_type);

    if (rawText === null) {
      await ctx.reply(
        'Maaf, format file ini belum didukung 🙏\n' +
          'Format yang didukung: PDF, DOCX, XLSX/XLS, CSV, TXT, MD.'
      );
      return;
    }

    if (!rawText) {
      await ctx.reply('Dokumen berhasil dibuka tapi nggak ada teks yang bisa diekstrak (mungkin scan tanpa OCR atau halaman kosong).');
      return;
    }

    const { text, truncated } = truncateText(rawText);
    const instruction = caption
      ? caption
      : 'Tolong ringkas isi dokumen ini dengan jelas dan poin-poin penting.';

    const prompt =
      `[Dokumen: ${doc.file_name}]${truncated ? ' (dipotong karena terlalu panjang)' : ''}\n\n` +
      `${text}\n\n---\nInstruksi user: ${instruction}`;

    await ctx.sendChatAction('typing');
    const reply = await askDeepSeek(chatId, prompt);
    await ctx.reply(reply);
  } catch (err) {
    console.error('Error proses dokumen:', err?.response?.data || err.message);
    await ctx.reply('Maaf, ada masalah saat membaca/menganalisis dokumen ini 🙏');
  }
});

// ---------- Foto (OCR) ----------

bot.on('photo', async (ctx) => {
  const chatId = ctx.chat.id;
  const caption = ctx.message.caption || '';
  // ambil resolusi terbesar
  const photos = ctx.message.photo;
  const bestPhoto = photos[photos.length - 1];

  try {
    await ctx.sendChatAction('typing');
    await ctx.reply('🖼️ Membaca teks di gambar (OCR)...');

    const buffer = await downloadTelegramFile(ctx, bestPhoto.file_id);
    const ocrText = await extractFromImage(buffer);

    if (!ocrText || ocrText.length < 3) {
      await ctx.reply(
        'Nggak ada teks yang terbaca di gambar ini 🙏\n' +
          'Ingat, bot ini cuma bisa membaca TEKS di gambar (OCR), belum bisa mendeskripsikan objek/pemandangan karena DeepSeek API belum punya vision.'
      );
      return;
    }

    const { text, truncated } = truncateText(ocrText);
    const instruction = caption
      ? caption
      : 'Tolong jelaskan/ringkas teks hasil OCR dari gambar ini.';

    const prompt =
      `[Hasil OCR dari gambar]${truncated ? ' (dipotong karena terlalu panjang)' : ''}\n\n` +
      `${text}\n\n---\nInstruksi user: ${instruction}`;

    await ctx.sendChatAction('typing');
    const reply = await askDeepSeek(chatId, prompt);
    await ctx.reply(reply);
  } catch (err) {
    console.error('Error proses gambar:', err?.response?.data || err.message);
    await ctx.reply('Maaf, ada masalah saat membaca gambar ini 🙏');
  }
});

bot.launch().then(() => {
  console.log('🤖 Bot Telegram-DeepSeek berhasil jalan!');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
