const NEWS_API_KEY = process.env.NEWS_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "@coinhouse_ai";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;

if (!globalThis.__coinhouseNewsCache) globalThis.__coinhouseNewsCache = new Map();
const sentCache = globalThis.__coinhouseNewsCache;

const NEWS_DEDUP_API_URL = "https://fgyiofykvpkxpeylcocn.supabase.co/rest/v1/rpc/claim_coinhouse_signal";
const NEWS_DEDUP_API_KEY = "sb_publishable_a7YWOaS5bhOcoHqHMpunKQ_-Nm-2pOC";

const KEYWORDS = [
  ["bitcoin etf", 40],
  ["spot etf", 35],
  ["fomc", 35],
  ["federal reserve", 35],
  ["rate cut", 30],
  ["rate hike", 30],
  ["sec", 25],
  ["cpi", 30],
  ["pce", 25],
  ["inflation", 20],
  ["hack", 35],
  ["hacked", 35],
  ["exploit", 35],
  ["liquidation", 25],
  ["bankruptcy", 30],
  ["blackrock", 25],
  ["binance", 20],
  ["coinbase", 20],
  ["bitcoin", 20],
  ["ethereum", 15],
  ["crypto", 10],
];

const SOURCE_BONUS = {
  Reuters: 25,
  Bloomberg: 25,
  CNBC: 20,
  "Associated Press": 20,
  "The Wall Street Journal": 20,
  "Financial Times": 20,
  CoinDesk: 15,
  Cointelegraph: 10,
};

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

function articleScore(article) {
  const text = `${article.title || ""} ${article.description || ""}`.toLowerCase();
  let score = 0;

  for (const [keyword, points] of KEYWORDS) {
    if (text.includes(keyword)) score += points;
  }

  score += SOURCE_BONUS[article.source?.name] || 0;

  const published = Date.parse(article.publishedAt || "");
  if (Number.isFinite(published)) {
    const ageMin = (Date.now() - published) / 60000;
    if (ageMin <= 10) score += 15;
    else if (ageMin <= 20) score += 8;
  }

  return Math.min(score, 100);
}

function impactLabel(score) {
  if (score >= 90) return "매우 높음";
  if (score >= 80) return "높음";
  return "주요";
}

function marketCheck(article) {
  const text = `${article.title || ""} ${article.description || ""}`.toLowerCase();

  if (/(hack|hacked|exploit|bankruptcy|liquidation)/.test(text)) {
    return "보안·청산 이슈로 단기 변동성이 커질 수 있어 가격 움직임에 유의해주세요.";
  }

  if (/(fomc|federal reserve|rate cut|rate hike|cpi|pce|inflation)/.test(text)) {
    return "거시경제 뉴스로 BTC와 주요 알트코인의 변동성 확대 가능성을 확인해주세요.";
  }

  if (/(etf|sec|blackrock)/.test(text)) {
    return "기관 수급과 규제 기대 변화가 시장 심리에 영향을 줄 수 있습니다.";
  }

  return "뉴스 발표 직후 가격 반응과 거래량 변화를 함께 확인해주세요.";
}

async function isDuplicate(article) {
  const key = article.url || article.title || "";
  const now = Date.now();

  for (const [k, ts] of sentCache.entries()) {
    if (now - ts > 6 * 60 * 60 * 1000) sentCache.delete(k);
  }

  if (sentCache.has(key)) return true;

  try {
    const response = await fetch(NEWS_DEDUP_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: NEWS_DEDUP_API_KEY,
        Authorization: `Bearer ${NEWS_DEDUP_API_KEY}`,
      },
      body: JSON.stringify({ p_event_key: `news|${key}` }),
    });

    if (response.ok) {
      const claimed = await response.json();
      if (claimed === false) return true;
    }
  } catch (error) {
    console.error("News dedup error:", error);
  }

  sentCache.set(key, now);
  return false;
}

async function sendTelegram(article, score) {
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

시장 영향도  <b>${impactLabel(score)}</b> · ${score}점

📰 <b>${title}</b>

<b>핵심 내용</b>
${summary}

💡 <b>COINHOUSE 시장 체크</b>
${marketCheck(article)}

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
      version: "1.2",
      newsApiConfigured: Boolean(NEWS_API_KEY),
      telegramConfigured: Boolean(TELEGRAM_BOT_TOKEN),
      threshold: 50,
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
    const from = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    const params = new URLSearchParams({
      q: '(bitcoin OR BTC OR ethereum OR crypto OR "spot ETF" OR FOMC OR SEC OR CPI OR PCE OR Binance OR Coinbase OR BlackRock)',
      searchIn: "title,description",
      language: "en",
      sortBy: "publishedAt",
      pageSize: "40",
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

    const scored = (j.articles || [])
      .map((article) => ({ article, score: articleScore(article) }))
      .filter(({ score }) => score >= 50)
      .sort((a, b) => b.score - a.score);

    const picked = [];
    for (const item of scored) {
      if (!(await isDuplicate(item.article))) {
        picked.push(item);
      }
      if (picked.length >= 1) break;
    }

    for (const { article, score } of picked) {
      await sendTelegram(article, score);
    }

    return res.status(200).json({
      ok: true,
      checked: j.articles?.length || 0,
      sentCount: picked.length,
      sent: picked.map(({ article, score }) => ({
        title: article.title,
        source: article.source?.name,
        score,
      })),
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || "Internal Server Error",
    });
  }
}
