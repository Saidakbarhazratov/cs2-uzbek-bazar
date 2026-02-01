import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Telegraf, Markup } from 'telegraf';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const MINI_APP_URL = process.env.MINI_APP_URL || '';
const ADMIN_TG_ID = String(process.env.ADMIN_TG_ID || '6100947342');

if (!BOT_TOKEN) {
  console.log('❗ BOT_TOKEN bo‘sh. BotFather tokenini server/.env ga qo‘ying.');
}

const app = express();
app.use(cors());
app.use(express.json());

// ----------------------
// In-memory demo storage (keyin DB qilamiz)
// ----------------------
const stats = {
  users: new Map(),        // telegramId -> { firstSeen, lastSeen, opens }
  events: [],              // { type, telegramId, at, meta }
};

function nowISO() {
  return new Date().toISOString();
}

function isAdmin(telegramId) {
  return String(telegramId) === ADMIN_TG_ID;
}

function touchUser(telegramId, username) {
  const id = String(telegramId);
  const existing = stats.users.get(id);
  if (!existing) {
    stats.users.set(id, { firstSeen: nowISO(), lastSeen: nowISO(), opens: 0, username: username || '' });
  } else {
    existing.lastSeen = nowISO();
    if (username) existing.username = username;
  }
}

function logEvent(type, telegramId, meta = {}) {
  stats.events.push({ type, telegramId: String(telegramId), at: nowISO(), meta });
  // eventlar juda ko‘payib ketmasin (demo)
  if (stats.events.length > 5000) stats.events.shift();
}

// ----------------------
// API
// ----------------------
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Mini app ochilganda frontend shu endpointni chaqiradi
app.post('/api/track/open', (req, res) => {
  const { telegramId, username } = req.body || {};
  if (!telegramId) return res.status(400).json({ error: 'telegramId required' });

  touchUser(telegramId, username);
  const u = stats.users.get(String(telegramId));
  u.opens += 1;

  logEvent('miniapp_open', telegramId, {});
  res.json({ ok: true });
});

// Oddiy click tracking (masalan: sotib olish bosildi)
app.post('/api/track/event', (req, res) => {
  const { telegramId, type, meta } = req.body || {};
  if (!telegramId || !type) return res.status(400).json({ error: 'telegramId and type required' });

  touchUser(telegramId);
  logEvent(type, telegramId, meta || {});
  res.json({ ok: true });
});

// Admin statistikasi (faqat admin ko‘rsin)
app.get('/api/admin/stats', (req, res) => {
  const telegramId = req.query.telegramId;
  if (!telegramId || !isAdmin(telegramId)) return res.status(403).json({ error: 'forbidden' });

  const totalUsers = stats.users.size;

  // bugun kirganlar (oddiy hisob: ISO date bo‘yicha)
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const todayPrefix = `${y}-${m}-${d}`;

  let todayActive = 0;
  for (const u of stats.users.values()) {
    if (u.lastSeen.startsWith(todayPrefix)) todayActive += 1;
  }

  const opensToday = stats.events.filter(e => e.type === 'miniapp_open' && e.at.startsWith(todayPrefix)).length;

  res.json({
    ok: true,
    totalUsers,
    todayActive,
    opensToday,
    last10Events: stats.events.slice(-10),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API running on http://localhost:${PORT}`));

// ----------------------
// Telegram Bot
// ----------------------
const bot = new Telegraf(BOT_TOKEN);

function mainKeyboard() {
  return Markup.keyboard([
    ['🧩 Mini App ochish'],
    ['📌 Yordam', '👤 Admin'],
  ]).resize();
}

bot.start(async (ctx) => {
  const telegramId = ctx.from?.id;
  const username = ctx.from?.username;
  if (telegramId) touchUser(telegramId, username);

  await ctx.reply(
    `Assalomu alaykum!\n\nBu bot: CS2 O‘zbek Bazar 🛒\nSkinlarni so‘mda ko‘rish uchun Mini App’ni oching.`,
    mainKeyboard()
  );
});

bot.hears('🧩 Mini App ochish', async (ctx) => {
  const telegramId = ctx.from?.id;
  const username = ctx.from?.username;
  if (telegramId) {
    touchUser(telegramId, username);
    logEvent('bot_click_open_miniapp', telegramId, {});
  }

  if (!MINI_APP_URL) {
    return ctx.reply('❗ Mini App URL hali qo‘yilmagan. Keyinroq admin sozlaydi.');
  }

  await ctx.reply(
    'Mini App ochish 👇',
    Markup.inlineKeyboard([Markup.button.webApp('CS2 O‘zbek Bazar', MINI_APP_URL)])
  );
});

bot.hears('📌 Yordam', async (ctx) => {
  const telegramId = ctx.from?.id;
  if (telegramId) logEvent('bot_click_help', telegramId, {});

  await ctx.reply(
    'Yordam:\n' +
    '1) 🧩 Mini App ochish tugmasini bosing\n' +
    '2) Skinlarni qidiring va narxini so‘mda ko‘ring\n' +
    '3) Sotib olish uchun Admin’ga yozing\n'
  );
});

bot.hears('👤 Admin', async (ctx) => {
  const telegramId = ctx.from?.id;
  if (telegramId) logEvent('bot_click_admin', telegramId, {});

  await ctx.reply('Admin: https://t.me/saiddakkbar');
});

// (keyinroq) broadcast: admin buyruq orqali ishlatamiz
bot.command('broadcast', async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isAdmin(telegramId)) return;

  const text = ctx.message?.text?.replace('/broadcast', '').trim();
  if (!text) return ctx.reply('Usage: /broadcast <xabar>');

  let ok = 0, fail = 0;
  for (const [id] of stats.users.entries()) {
    try {
      await ctx.telegram.sendMessage(id, text);
      ok += 1;
    } catch (e) {
      fail += 1;
    }
  }
  await ctx.reply(`📣 Yuborildi: ${ok} ta. Xatolik: ${fail} ta.`);
});

if (BOT_TOKEN) {
  bot.launch().then(() => console.log('✅ Bot running'));
} else {
  console.log('⚠️ Bot ishga tushmadi: BOT_TOKEN yo‘q');
}

