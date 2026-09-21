const NEWS_API_KEY = process.env.NEWS_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "@coinhouse_ai";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;

if (!globalThis.__coinhouseNewsCache) globalThis.__coinhouseNewsCache = new Map();
const sentCache = globalThis.__coinhouseNewsCache;

function esc(v = "") {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function authorized(req) {
  const auth = req.headers.authorization || "";
  if (CRON_SECRET && auth === `Bearer ${CRON_SECRET}`) return true;
  if (WEBHOOK_SECRET && req.headers["x-news-secret"] === WEBHOOK_SECRET) return true;
  return false;
}

function isDuplicate(article) {
  const key = article.url || article.title || "";
  const now = Date.now();

  for (const [k, ts] of sentCache.entries()) {
    if (now - ts > 6 * 60 * 60 * 1000) sentCache.delete(k);
  }

  if (sentCache.has(key)) return true;
  sentCache.set(key, now);
  return false;
}

async function sendTelegram(article) {
  const title = esc(article.title || "제목 없음");
  const source = esc(article.source?.name || "출처 미상");
  const summary = esc(
    (article.description || "기사 세부 내용은 원문에서 확인해주세요.").slice(0, 280)
  );
  const published = article.publishedAt
    ? new Date(article.publishedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : "-";

  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    parse_mode: "HTML",
    disable_web_page_preview: false,
    text: `🚨 <b>COINHOUSE 주요 뉴스</b>

📰 <b>${title}</b>

<b>핵심 내용</b>
${summary}

출처  <b>${source}</b>
발행  ${published}

#주요뉴스 #COINHOUSE`,
  };

  if (article.url) {
    payload.reply_markup = {
      inline_keyboard: [[{ text: "📰 원문 기사 보기", url: article.url }]],
    };
  }

  const r = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error("Telegram 전송 실패");
}

export default async function handler(req, res) {
  if (req.method === "GET" && req.query?.status === "1") {
    return res.status(200).json({
      ok: true,
      service: "COINHOUSE News Monitor",
      status: "running",
      version: "1.0",
    });
  }

  if (!authorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  if (!NEWS_API_KEY) {
    return res.status(500).json({ ok: false, error: "NEWS_API_KEY가 없습니다." });
  }

  if (!TELEGRAM_BOT_TOKEN) {
    return res.status(500).json({ ok: false, error: "TELEGRAM_BOT_TOKEN이 없습니다." });
  }

  try {
    const from = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    const params = new URLSearchParams({
      q: '(bitcoin OR BTC OR ethereum OR crypto OR "spot ETF" OR FOMC OR SEC OR CPI OR PCE OR Binance OR Coinbase OR BlackRock)',
      searchIn: "title,description",
      language: "en",
      sortBy: "publishedAt",
      pageSize: "30",
      from,
    });

    const r = await fetch(
      `https://newsapi.org/v2/everything?${params.toString()}`,
      { headers: { "X-Api-Key": NEWS_API_KEY } }
    );

    const j = await r.json();

    if (!r.ok || j.status !== "ok") {
      return res.status(502).json({
        ok: false,
        error: "NewsAPI 호출 실패",
        details: j.message || j.code,
      });
    }

    const picked = (j.articles || [])
      .filter((a) => !isDuplicate(a))
      .slice(0, 2);

    for (const article of picked) {
      await sendTelegram(article);
    }

    return res.status(200).json({
      ok: true,
      checked: j.articles?.length || 0,
      sentCount: picked.length,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || "Internal Server Error",
    });
  }
}
