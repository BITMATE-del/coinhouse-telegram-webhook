const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "@coinhouse_ai";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// 나중에 거래소 가입 링크를 넣으면 버튼 자동 생성 가능
const JOIN_URL = process.env.JOIN_URL || "";
const GUIDE_URL = process.env.GUIDE_URL || "";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatPrice(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return String(value || "-");
  }

  return number.toLocaleString("ko-KR", {
    maximumFractionDigits: 8,
  });
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

function getMessage(data) {
  const event = data.event;
  const symbol = escapeHtml(data.symbol || "종목 미확인");
  const timeframe = escapeHtml(formatTimeframe(data.timeframe));
  const price = escapeHtml(formatPrice(data.price));

  if (event === "buy_signal") {
    return `🟢 <b>COINHOUSE 매수 신호</b>

<b>${symbol}</b> · ${timeframe}

현재가 : <b>${price}</b>

현재 매수 신호가 확인되었습니다.
시장 흐름과 목표지점을 확인해주세요.

#매수신호 #COINHOUSE`;
  }

  if (event === "sell_signal") {
    return `🔴 <b>COINHOUSE 매도 신호</b>

<b>${symbol}</b> · ${timeframe}

현재가 : <b>${price}</b>

현재 매도 신호가 확인되었습니다.
시장 흐름과 목표지점을 확인해주세요.

#매도신호 #COINHOUSE`;
  }

  if (event === "target1") {
    return `🎯 <b>COINHOUSE 1차 목표 도달</b>

<b>${symbol}</b> · ${timeframe}

도달 가격 : <b>${price}</b>

1차 목표지점에 도달했습니다.
다음 목표지점을 확인해주세요.

#1차목표도달 #COINHOUSE`;
  }

  if (event === "target2") {
    return `✅ <b>COINHOUSE 2차 목표 도달</b>

<b>${symbol}</b> · ${timeframe}

도달 가격 : <b>${price}</b>

2차 목표지점 도달이 확인되었습니다.

#2차목표도달 #COINHOUSE`;
  }

  if (event === "stop") {
    return `⛔ <b>COINHOUSE 신호 종료</b>

<b>${symbol}</b> · ${timeframe}

손절 지점 : <b>${price}</b>

손절 지점 도달로
해당 신호 추적을 종료합니다.

#손절도달 #신호종료 #COINHOUSE`;
  }

  if (event === "exit_warning") {
    return `⚠️ <b>COINHOUSE 익절 주의</b>

<b>${symbol}</b> · ${timeframe}

현재가 : <b>${price}</b>

현재 진행 중인 신호의
모멘텀 약화가 감지되었습니다.

수익 구간 관리에 유의해주세요.

#익절주의 #COINHOUSE`;
  }

  return `📊 <b>COINHOUSE Market Intelligence</b>

<b>${symbol}</b> · ${timeframe}

현재가 : <b>${price}</b>

새로운 시장 이벤트가 감지되었습니다.

#COINHOUSE`;
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

    // WEBHOOK_SECRET을 Vercel에 설정했다면
    // TradingView 메시지에도 같은 secret이 있어야 함
    if (WEBHOOK_SECRET) {
      if (data.secret !== WEBHOOK_SECRET) {
        return res.status(401).json({
          ok: false,
          error: "Invalid webhook secret",
        });
      }
    }

    if (!data.event) {
      return res.status(400).json({
        ok: false,
        error: "event 값이 없습니다.",
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
