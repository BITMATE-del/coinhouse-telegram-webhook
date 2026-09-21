const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "@coinhouse_ai";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const JOIN_URL = process.env.JOIN_URL || "";
const GUIDE_URL = process.env.GUIDE_URL || "";

const DEDUP_WINDOW_MS = 2 * 60 * 1000;

if (!globalThis.__coinhouseDedupCache) {
  globalThis.__coinhouseDedupCache = new Map();
}

const dedupCache = globalThis.__coinhouseDedupCache;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function hasValue(value) {
  return value !== undefined &&
    value !== null &&
    String(value).trim() !== "" &&
    String(value) !== "na";
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatPrice(value) {
  if (!hasValue(value)) return "-";

  const number = toNumber(value);
  if (number === null) return String(value);

  return number.toLocaleString("ko-KR", {
    maximumFractionDigits: 8,
  });
}

function formatPercent(value, signed = false) {
  const number = toNumber(value);
  if (number === null) return "-";

  const prefix = signed && number > 0 ? "+" : "";
  return `${prefix}${number.toFixed(2)}%`;
}

function formatTimeframe(value) {
  const tf = String(value || "");

  const map = {
    "1": "1분",
    "3": "3분",
    "5": "5분",
    "15": "15분",
    "30": "30분",
    "45": "45분",
    "60": "1시간",
    "120": "2시간",
    "180": "3시간",
    "240": "4시간",
    "D": "1일",
    "1D": "1일",
    "W": "1주",
    "1W": "1주",
  };

  return map[tf] || tf;
}

function getDirection(data) {
  const entry = toNumber(data.entry);
  const target1 = toNumber(data.target1);
  const stop = toNumber(data.stop);

  if (entry !== null && target1 !== null) {
    if (target1 > entry) return "LONG";
    if (target1 < entry) return "SHORT";
  }

  if (entry !== null && stop !== null) {
    if (stop < entry) return "LONG";
    if (stop > entry) return "SHORT";
  }

  if (data.event === "buy_signal") return "LONG";
  if (data.event === "sell_signal") return "SHORT";

  return null;
}

function getReturnPercent(direction, entry, value) {
  if (entry === null || value === null || entry === 0 || !direction) {
    return null;
  }

  if (direction === "LONG") {
    return ((value - entry) / entry) * 100;
  }

  return ((entry - value) / entry) * 100;
}

function getMetrics(data) {
  const direction = getDirection(data);
  const entry = toNumber(data.entry);
  const price = toNumber(data.price);
  const target1 = toNumber(data.target1);
  const target2 = toNumber(data.target2);
  const stop = toNumber(data.stop);

  const currentReturn = getReturnPercent(direction, entry, price);
  const target1Return = getReturnPercent(direction, entry, target1);
  const target2Return = getReturnPercent(direction, entry, target2);
  const stopReturn = getReturnPercent(direction, entry, stop);

  const stopLossPct = stopReturn === null ? null : Math.abs(stopReturn);
  const rewardRisk =
    target2Return !== null &&
    stopLossPct !== null &&
    stopLossPct > 0
      ? Math.abs(target2Return) / stopLossPct
      : null;

  return {
    direction,
    entry,
    price,
    target1,
    target2,
    stop,
    currentReturn,
    target1Return,
    target2Return,
    stopLossPct,
    rewardRisk,
  };
}

function cleanupDedupCache() {
  const now = Date.now();

  for (const [key, timestamp] of dedupCache.entries()) {
    if (now - timestamp > DEDUP_WINDOW_MS) {
      dedupCache.delete(key);
    }
  }
}

function getDedupKey(data) {
  return [
    data.event || "",
    data.symbol || "",
    data.timeframe || "",
    data.price || "",
    data.entry || "",
    data.target1 || "",
    data.target2 || "",
    data.stop || "",
  ].join("|");
}

function isDuplicate(data) {
  cleanupDedupCache();

  const key = getDedupKey(data);
  const now = Date.now();
  const lastSeen = dedupCache.get(key);

  if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) {
    return true;
  }

  dedupCache.set(key, now);
  return false;
}

function getHeader(event) {
  const headers = {
    buy_signal: "🟢 <b>COINHOUSE 매수 신호</b>",
    sell_signal: "🔴 <b>COINHOUSE 매도 신호</b>",
    target1: "🎯 <b>COINHOUSE 1차 목표 도달</b>",
    target2: "🏆 <b>COINHOUSE 2차 목표 도달</b>",
    stop: "🛑 <b>COINHOUSE 신호 종료</b>",
    exit_warning: "⚠️ <b>COINHOUSE 익절 주의</b>",
  };

  return headers[event] || "📊 <b>COINHOUSE Market Intelligence AI</b>";
}

function getStatusText(event) {
  const messages = {
    buy_signal:
      "상승 방향 조건이 충족되어 매수 신호가 확인되었습니다.",
    sell_signal:
      "하락 방향 조건이 충족되어 매도 신호가 확인되었습니다.",
    target1:
      "1차 목표지점에 도달했습니다. 다음 목표와 현재 흐름을 확인해주세요.",
    target2:
      "2차 목표지점 도달이 확인되었습니다. 수익 구간 관리에 유의해주세요.",
    stop:
      "손절 지점에 도달해 해당 신호 추적을 종료합니다.",
    exit_warning:
      "진행 중인 신호에서 모멘텀 약화가 감지되었습니다.",
  };

  return messages[event] || "새로운 시장 이벤트가 감지되었습니다.";
}

function buildPerformanceBlock(data) {
  const metrics = getMetrics(data);
  const lines = [];

  if (hasValue(data.strength)) {
    lines.push(`신호 강도   <b>${escapeHtml(String(Math.round(Number(data.strength))))}%</b>`);
  }

  if (metrics.entry !== null) {
    lines.push(`진입 기준   <b>${escapeHtml(formatPrice(metrics.entry))}</b>`);
  }

  if (metrics.target1 !== null) {
    const pct =
      metrics.target1Return === null
        ? ""
        : `  <b>(${escapeHtml(formatPercent(metrics.target1Return, true))})</b>`;

    lines.push(
      `1차 목표   <b>${escapeHtml(formatPrice(metrics.target1))}</b>${pct}`
    );
  }

  if (metrics.target2 !== null) {
    const pct =
      metrics.target2Return === null
        ? ""
        : `  <b>(${escapeHtml(formatPercent(metrics.target2Return, true))})</b>`;

    lines.push(
      `2차 목표   <b>${escapeHtml(formatPrice(metrics.target2))}</b>${pct}`
    );
  }

  if (metrics.stop !== null) {
    const pct =
      metrics.stopLossPct === null
        ? ""
        : `  <b>(-${metrics.stopLossPct.toFixed(2)}%)</b>`;

    lines.push(
      `손절 지점   <b>${escapeHtml(formatPrice(metrics.stop))}</b>${pct}`
    );
  }

  if (metrics.currentReturn !== null) {
    lines.push(
      `현재 기준   <b>${escapeHtml(formatPercent(metrics.currentReturn, true))}</b>`
    );
  }

  if (metrics.rewardRisk !== null) {
    lines.push(
      `예상 손익비   <b>1 : ${metrics.rewardRisk.toFixed(2)}</b>`
    );
  }

  if (!lines.length) return "";

  return `📌 <b>신호 정보</b>
━━━━━━━━━━━━━━
${lines.join("\n")}`;
}

function getMessage(data) {
  const symbol = escapeHtml(data.symbol || "종목 미확인");
  const timeframe = escapeHtml(formatTimeframe(data.timeframe));
  const price = escapeHtml(formatPrice(data.price));
  const performance = buildPerformanceBlock(data);
  const statusText = getStatusText(data.event);

  return `${getHeader(data.event)}

<b>${symbol}</b>  ·  ${timeframe}
현재가  <b>${price}</b>

${performance ? performance + "\n\n" : ""}💡 <b>COINHOUSE AI 분석</b>
${statusText}

━━━━━━━━━━━━━━
※ 신호 강도는 조건 충족도이며 성공 확률을 의미하지 않습니다.

#COINHOUSE #MarketIntelligence`;
}

function getReplyMarkup() {
  const buttons = [];

  if (JOIN_URL) {
    buttons.push([
      {
        text: "📈 COINHOUSE 거래 시작",
        url: JOIN_URL,
      },
    ]);
  }

  if (GUIDE_URL) {
    buttons.push([
      {
        text: "📘 이용 방법 안내",
        url: GUIDE_URL,
      },
    ]);
  }

  if (buttons.length === 0) {
    return undefined;
  }

  return {
    inline_keyboard: buttons,
  };
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "COINHOUSE Telegram Webhook",
      status: "running",
      version: "1.3",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method Not Allowed",
    });
  }

  try {
    if (!TELEGRAM_BOT_TOKEN) {
      throw new Error("TELEGRAM_BOT_TOKEN 환경변수가 없습니다.");
    }

    const data =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    if (!data) {
      return res.status(400).json({
        ok: false,
        error: "요청 데이터가 없습니다.",
      });
    }

    if (WEBHOOK_SECRET && data.secret !== WEBHOOK_SECRET) {
      return res.status(401).json({
        ok: false,
        error: "Invalid webhook secret",
      });
    }

    if (!data.event) {
      return res.status(400).json({
        ok: false,
        error: "event 값이 없습니다.",
      });
    }

    if (isDuplicate(data)) {
      console.log("Duplicate COINHOUSE alert ignored:", {
        event: data.event,
        symbol: data.symbol,
        timeframe: data.timeframe,
        price: data.price,
      });

      return res.status(200).json({
        ok: true,
        duplicate: true,
        skipped: true,
      });
    }

    const text = getMessage(data);

    const telegramPayload = {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };

    const replyMarkup = getReplyMarkup();

    if (replyMarkup) {
      telegramPayload.reply_markup = replyMarkup;
    }

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(telegramPayload),
      }
    );

    const telegramResult = await telegramResponse.json();

    if (!telegramResponse.ok || !telegramResult.ok) {
      console.error("Telegram error:", telegramResult);

      return res.status(502).json({
        ok: false,
        error: "Telegram 전송 실패",
        telegram: telegramResult,
      });
    }

    console.log("COINHOUSE alert sent:", {
      event: data.event,
      symbol: data.symbol,
      timeframe: data.timeframe,
      strength: data.strength,
    });

    return res.status(200).json({
      ok: true,
      event: data.event,
      telegram_message_id: telegramResult.result?.message_id,
    });
  } catch (error) {
    console.error("Webhook error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Internal Server Error",
    });
  }
}
