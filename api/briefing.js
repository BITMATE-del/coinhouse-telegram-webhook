const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "@coinhouse_ai";
const CRON_SECRET = process.env.CRON_SECRET;
const NEWS_API_KEY = process.env.NEWS_API_KEY;

function esc(v = "") {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatNum(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

function pct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function ema(values, length) {
  if (!values.length) return null;
  const k = 2 / (length + 1);
  let result = values[0];
  for (let i = 1; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }
  return result;
}

function rsi(values, length = 14) {
  if (values.length <= length) return null;
  let gain = 0;
  let loss = 0;

  for (let i = values.length - length; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }

  if (loss === 0) return 100;
  const rs = (gain / length) / (loss / length);
  return 100 - 100 / (1 + rs);
}

async function fetchJson(url, options = {}) {
  const r = await fetch(url, options);
  const j = await r.json();
  if (!r.ok) throw new Error(`외부 API 오류: ${r.status}`);
  return j;
}

async function getMarket(symbol) {
  const [ticker, klines] = await Promise.all([
    fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`),
    fetchJson(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=80`)
  ]);

  const closes = klines.map(k => Number(k[4])).filter(Number.isFinite);
  const volumes = klines.map(k => Number(k[5])).filter(Number.isFinite);
  const e20 = ema(closes.slice(-60), 20);
  const e50 = ema(closes.slice(-70), 50);
  const r = rsi(closes, 14);

  const recentVol = volumes.slice(-8).reduce((a,b)=>a+b,0) / Math.max(volumes.slice(-8).length,1);
  const priorVol = volumes.slice(-24,-8).reduce((a,b)=>a+b,0) / Math.max(volumes.slice(-24,-8).length,1);
  const volRatio = priorVol > 0 ? recentVol / priorVol : 1;

  let trend = "혼조";
  if (e20 !== null && e50 !== null) {
    if (e20 > e50 && Number(ticker.lastPrice) > e20) trend = "상승 우세";
    else if (e20 < e50 && Number(ticker.lastPrice) < e20) trend = "하락 우세";
  }

  let momentum = "중립";
  if (r !== null) {
    if (r >= 60) momentum = "강세";
    else if (r <= 40) momentum = "약세";
  }

  let volumeText = "보통";
  if (volRatio >= 1.5) volumeText = "증가";
  else if (volRatio <= 0.7) volumeText = "감소";

  return {
    symbol,
    price: Number(ticker.lastPrice),
    change: Number(ticker.priceChangePercent),
    quoteVolume: Number(ticker.quoteVolume),
    trend,
    momentum,
    volumeText,
    rsi: r,
  };
}

async function getTopNews() {
  if (!NEWS_API_KEY) return [];

  try {
    const from = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({
      q: '(bitcoin OR ethereum OR crypto OR ETF OR FOMC OR SEC)',
      searchIn: "title,description",
      language: "en",
      sortBy: "publishedAt",
      pageSize: "5",
      from
    });

    const j = await fetchJson(
      `https://newsapi.org/v2/everything?${params.toString()}`,
      { headers: { "X-Api-Key": NEWS_API_KEY } }
    );

    return (j.articles || []).slice(0, 3).map(a => a.title).filter(Boolean);
  } catch {
    return [];
  }
}

function getSessionLabel() {
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hour12: false
    }).format(now)
  );

  if (hour < 11) return { title: "오전 시장 브리핑", tag: "#오전시황" };
  if (hour < 16) return { title: "오후 시장 브리핑", tag: "#오후시황" };
  return { title: "저녁 시장 브리핑", tag: "#저녁시황" };
}

function buildCheck(btc, eth) {
  const notes = [];

  if (btc.trend === "상승 우세") {
    notes.push("BTC는 단기 추세상 상승 우위 흐름을 유지하고 있습니다.");
  } else if (btc.trend === "하락 우세") {
    notes.push("BTC는 단기 추세상 하락 압력이 우세합니다.");
  } else {
    notes.push("BTC는 뚜렷한 방향성보다 혼조 흐름이 나타나고 있습니다.");
  }

  if (btc.volumeText === "증가") {
    notes.push("거래량이 증가하고 있어 단기 변동성 확대 가능성을 함께 확인할 필요가 있습니다.");
  } else if (btc.volumeText === "감소") {
    notes.push("거래량이 둔화되어 돌파 신호의 지속 여부를 확인하는 것이 중요합니다.");
  }

  if (eth.change * btc.change < 0) {
    notes.push("BTC와 ETH의 24시간 방향이 엇갈려 종목별 차별화 흐름에 유의해주세요.");
  }

  return notes.join("\n\n");
}

function isAuthorized(req) {
  const auth = req.headers.authorization || "";
  return Boolean(CRON_SECRET && auth === `Bearer ${CRON_SECRET}`);
}

async function sendTelegram(text) {
  const r = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    }
  );

  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error("Telegram 전송 실패");
  return j;
}

export default async function handler(req, res) {
  if (req.method === "GET" && req.query?.status === "1") {
    return res.status(200).json({
      ok: true,
      service: "COINHOUSE Market Briefing",
      status: "running",
      version: "1.0"
    });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  if (!TELEGRAM_BOT_TOKEN) {
    return res.status(500).json({ ok: false, error: "TELEGRAM_BOT_TOKEN이 없습니다." });
  }

  try {
    const [btc, eth, headlines] = await Promise.all([
      getMarket("BTCUSDT"),
      getMarket("ETHUSDT"),
      getTopNews()
    ]);

    const session = getSessionLabel();
    const nowKst = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date());

    const newsBlock = headlines.length
      ? `\n\n🚨 <b>주요 이슈</b>\n${headlines.map((h,i)=>`• ${esc(h)}`).join("\n")}`
      : "";

    const text = `📊 <b>COINHOUSE ${session.title}</b>

${esc(nowKst)}

━━━━━━━━━━━━━━
📌 <b>시장 현황</b>

BTC  <b>${formatNum(btc.price, 2)} USDT</b>
24시간  <b>${pct(btc.change)}</b>
단기 흐름  <b>${btc.trend}</b>
모멘텀  <b>${btc.momentum}</b>
거래량  <b>${btc.volumeText}</b>

ETH  <b>${formatNum(eth.price, 2)} USDT</b>
24시간  <b>${pct(eth.change)}</b>
단기 흐름  <b>${eth.trend}</b>

━━━━━━━━━━━━━━
🤖 <b>COINHOUSE AI 시장 체크</b>

${buildCheck(btc, eth)}${newsBlock}

━━━━━━━━━━━━━━
💡 <b>오늘의 체크포인트</b>

무리한 추격 진입보다 15분봉 COINHOUSE 신호와 거래량 변화를 함께 확인해주세요.

※ 본 브리핑은 시장 데이터를 자동 분석한 참고 정보입니다.

${session.tag} #시장브리핑 #COINHOUSE`;

    await sendTelegram(text);

    return res.status(200).json({
      ok: true,
      sent: true,
      session: session.title,
      btc: { price: btc.price, change: btc.change, trend: btc.trend },
      eth: { price: eth.price, change: eth.change, trend: eth.trend }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Internal Server Error" });
  }
}
