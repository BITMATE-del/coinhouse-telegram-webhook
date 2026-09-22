const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "@coinhouse_ai";
const CRON_SECRET = process.env.CRON_SECRET;

const DEDUP_API_URL = "https://fgyiofykvpkxpeylcocn.supabase.co/rest/v1/rpc/claim_coinhouse_signal";
const DEDUP_API_KEY = "sb_publishable_a7YWOaS5bhOcoHqHMpunKQ_-Nm-2pOC";

const SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const PERIOD = "15m";
const MIN_ALERT_SCORE = 3;

function esc(v = "") {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(v, digits = 2) {
  const n = num(v);
  if (n === null) return "-";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

function pct(v) {
  const n = num(v);
  if (n === null) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function isAuthorized(req) {
  const auth = req.headers.authorization || "";
  return Boolean(CRON_SECRET && auth === `Bearer ${CRON_SECRET}`);
}

async function fetchJson(url) {
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) throw new Error(`시장 데이터 오류 ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
  return j;
}

async function claimOnce(key) {
  try {
    const r = await fetch(DEDUP_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: DEDUP_API_KEY,
        Authorization: `Bearer ${DEDUP_API_KEY}`,
      },
      body: JSON.stringify({ p_event_key: key }),
    });

    if (!r.ok) return true;
    return await r.json();
  } catch {
    return true;
  }
}

function changePct(a, b) {
  const x = num(a);
  const y = num(b);
  if (x === null || y === null || x === 0) return 0;
  return ((y - x) / x) * 100;
}

async function getFlow(symbol) {
  const [premium, oiHist, ratioHist, takerHist, trades, ticker] = await Promise.all([
    fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`),
    fetchJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${PERIOD}&limit=3`),
    fetchJson(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${PERIOD}&limit=2`),
    fetchJson(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=${PERIOD}&limit=2`),
    fetchJson(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${symbol}&limit=1000`),
    fetchJson(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`)
  ]);

  const oiPrev = oiHist?.[Math.max(0, oiHist.length - 2)];
  const oiLast = oiHist?.[oiHist.length - 1];
  const oiPrevValue = num(oiPrev?.sumOpenInterestValue) ?? num(oiPrev?.sumOpenInterest);
  const oiLastValue = num(oiLast?.sumOpenInterestValue) ?? num(oiLast?.sumOpenInterest);
  const oiChange = changePct(oiPrevValue, oiLastValue);

  const ratioLast = ratioHist?.[ratioHist.length - 1] || {};
  const longPct = (num(ratioLast.longAccount) || 0) * 100;
  const shortPct = (num(ratioLast.shortAccount) || 0) * 100;

  const takerLast = takerHist?.[takerHist.length - 1] || {};
  const buySellRatio = num(takerLast.buySellRatio) || 1;

  const funding = (num(premium.lastFundingRate) || 0) * 100;
  const markPrice = num(premium.markPrice) || num(ticker.lastPrice) || 0;
  const price24h = num(ticker.priceChangePercent) || 0;

  let largestTrade = null;
  let buyNotional = 0;
  let sellNotional = 0;

  for (const t of trades || []) {
    const price = num(t.p) || 0;
    const qty = num(t.q) || 0;
    const notional = price * qty;
    const side = t.m ? "SELL" : "BUY";

    if (side === "BUY") buyNotional += notional;
    else sellNotional += notional;

    if (!largestTrade || notional > largestTrade.notional) {
      largestTrade = { side, notional, price, qty };
    }
  }

  const totalAgg = buyNotional + sellNotional;
  const buyShare = totalAgg > 0 ? (buyNotional / totalAgg) * 100 : 50;
  const sellShare = 100 - buyShare;

  let liquidationPressure = "중립";
  if (oiChange <= -1.2 && price24h <= -1 && sellShare >= 55) liquidationPressure = "롱 청산 압력 추정";
  else if (oiChange <= -1.2 && price24h >= 1 && buyShare >= 55) liquidationPressure = "숏 청산 압력 추정";

  let score = 0;
  const reasons = [];

  if (Math.abs(oiChange) >= 1.0) {
    score += 2;
    reasons.push(`OI ${oiChange >= 0 ? "증가" : "감소"} ${pct(oiChange)}`);
  }

  if (Math.abs(funding) >= 0.03) {
    score += 2;
    reasons.push(`펀딩비 ${funding >= 0 ? "롱 과열" : "숏 과열"} ${pct(funding)}`);
  } else if (Math.abs(funding) >= 0.015) {
    score += 1;
    reasons.push(`펀딩비 편향 ${pct(funding)}`);
  }

  if (longPct >= 62 || shortPct >= 62) {
    score += 1;
    reasons.push(`롱/숏 비율 쏠림 ${longPct.toFixed(1)}% / ${shortPct.toFixed(1)}%`);
  }

  if (buyShare >= 62 || sellShare >= 62) {
    score += 2;
    reasons.push(`공격적 체결 ${buyShare >= sellShare ? "매수" : "매도"} 우위 ${Math.max(buyShare, sellShare).toFixed(1)}%`);
  }

  if (largestTrade && largestTrade.notional >= 750000) {
    score += 2;
    reasons.push(`고래성 단일 체결 약 $${(largestTrade.notional / 1000000).toFixed(2)}M`);
  } else if (largestTrade && largestTrade.notional >= 250000) {
    score += 1;
    reasons.push(`대형 단일 체결 약 $${(largestTrade.notional / 1000).toFixed(0)}K`);
  }

  if (liquidationPressure !== "중립") {
    score += 2;
    reasons.push(liquidationPressure);
  }

  return {
    symbol,
    score,
    markPrice,
    price24h,
    funding,
    oiChange,
    longPct,
    shortPct,
    buySellRatio,
    buyShare,
    sellShare,
    largestTrade,
    liquidationPressure,
    reasons,
  };
}

function flowComment(d) {
  const bullish = [];
  const bearish = [];

  if (d.oiChange > 0.8) bullish.push("미결제약정 증가");
  if (d.oiChange < -0.8) bearish.push("미결제약정 감소");
  if (d.buyShare >= 58) bullish.push("시장가 매수 우위");
  if (d.sellShare >= 58) bearish.push("시장가 매도 우위");
  if (d.funding < -0.02) bullish.push("숏 포지션 과열 가능성");
  if (d.funding > 0.02) bearish.push("롱 포지션 과열 가능성");

  if (bullish.length > bearish.length) {
    return "수급 지표는 단기 매수 우위 신호가 더 많습니다. 다만 과열 여부와 가격 확인이 필요합니다.";
  }

  if (bearish.length > bullish.length) {
    return "수급 지표는 단기 매도 압력 또는 포지션 정리 신호가 더 많습니다. 급격한 반등 가능성도 함께 확인해주세요.";
  }

  return "수급 방향이 한쪽으로 명확하게 기울지는 않았습니다. 가격과 거래량 확인이 필요합니다.";
}

async function sendTelegram(d) {
  const whale = d.largestTrade
    ? `${d.largestTrade.side === "BUY" ? "대형 매수" : "대형 매도"} 약 $${fmt(d.largestTrade.notional / 1000, 0)}K`
    : "특이사항 없음";

  const text = `🐋 <b>COINHOUSE 시장 수급 모니터</b>

<b>${esc(d.symbol)}</b> · 15분 기준
현재가  <b>${fmt(d.markPrice, 2)}</b>
24시간  <b>${pct(d.price24h)}</b>

━━━━━━━━━━━━━━
📊 <b>파생시장 수급</b>

미결제약정 변화  <b>${pct(d.oiChange)}</b>
펀딩비  <b>${pct(d.funding)}</b>
롱 / 숏 계정  <b>${d.longPct.toFixed(1)}% / ${d.shortPct.toFixed(1)}%</b>
공격적 체결  <b>매수 ${d.buyShare.toFixed(1)}% / 매도 ${d.sellShare.toFixed(1)}%</b>
고래성 체결  <b>${whale}</b>
청산 압력  <b>${d.liquidationPressure}</b>

━━━━━━━━━━━━━━
💡 <b>COINHOUSE 수급 체크</b>

${flowComment(d)}

감지 근거
${d.reasons.map(r => `• ${esc(r)}`).join("\n")}

※ 청산 압력은 OI·가격·공격적 체결을 조합한 추정치이며 실제 전체 거래소 청산액을 의미하지 않습니다.

#고래감지 #시장수급 #Funding #OI #COINHOUSE`;

  const r = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    }
  );

  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error("Telegram 전송 실패");
}

export default async function handler(req, res) {
  if (req.method === "GET" && req.query?.status === "1") {
    return res.status(200).json({
      ok: true,
      service: "COINHOUSE Market Flow Monitor",
      status: "running",
      version: "1.1",
      threshold: MIN_ALERT_SCORE,
      symbols: SYMBOLS,
      period: PERIOD,
      telegramConfigured: Boolean(TELEGRAM_BOT_TOKEN),
    });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  if (!TELEGRAM_BOT_TOKEN) {
    return res.status(500).json({ ok: false, error: "TELEGRAM_BOT_TOKEN이 없습니다." });
  }

  try {
    const results = [];

    for (const symbol of SYMBOLS) {
      const data = await getFlow(symbol);
      let sent = false;

      if (data.score >= MIN_ALERT_SCORE) {
        const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
        const key = `flow|${symbol}|${data.liquidationPressure}|${bucket}`;
        const claimed = await claimOnce(key);

        if (claimed) {
          await sendTelegram(data);
          sent = true;
        }
      }

      results.push({
        symbol,
        score: data.score,
        sent,
        oiChange: data.oiChange,
        funding: data.funding,
        buyShare: data.buyShare,
        sellShare: data.sellShare,
        liquidationPressure: data.liquidationPressure,
      });
    }

    return res.status(200).json({ ok: true, results });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || "Internal Server Error",
    });
  }
}
