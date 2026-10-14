/**
 * ANGEL SOLUTION Telegram channel ad handler.
 * Isolated from existing COINHOUSE services and credentials.
 * Telegram: setWebhook to https://<deployment>/api/angel, with secret_token.
 */
const SERVICES = [
  "🌐 랜딩페이지", "🤖 봇 개발", "⚙️ 맞춤 솔루션",
  "💻 단독 개발", "📦 프로젝트 판매", "🖥️ 서버 구축",
  "📁 원본파일 제공", "✨ AI 활용 개발", "💰 합리적 가격"
];
const MESSAGE = [
  "💠 ANGEL SOLUTION",
  "원하는 상상을 현실로",
  "랜딩페이지 · 솔루션 · 봇 · 개발",
  "",
  "━━━━━━━━━━━━━━━━━━",
  "🌐 랜딩페이지  │ 🤖 봇 개발  │ ⚙️ 맞춤 솔루션",
  "💻 단독 개발  │ 📦 프로젝트 판매  │ 🖥️ 서버 구축",
  "📁 원본파일 제공  │ ✨ AI 활용 개발  │ 💰 가격 상담",
  "━━━━━━━━━━━━━━━━━━",
  "⭐ 솔루션 문의하기",
  "📩 @angel_solt",
  "https://t.me/angel_solt"
].join("\n");

async function telegram(token, method, payload) {
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST", headers: {"content-type":"application/json"},
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(method + ": " + (body.description || response.status));
  return body.result;
}
export default async function handler(req, res) {
  if (req.method === "GET") {
    const token = process.env.ANGEL_BOT_TOKEN;
    const secret = process.env.ANGEL_WEBHOOK_SECRET;
    if (!token || !secret) return res.status(503).json({ok:false,configured:false});
    const endpoint = "https://coinhouse-telegram-webhook.vercel.app/api/angel";
    let phase = "getWebhookInfo";
    try {
      const info = await telegram(token, "getWebhookInfo", {});
      const currentUrl = info.url || "";
      // Bootstrap only an unconfigured bot; never replace an existing webhook.
      if (!currentUrl) {
        phase = "setWebhook";
        const secretValid = /^[A-Za-z0-9_-]{1,256}$/.test(secret);
        if (!secretValid) return res.status(422).json({ok:false,reason:"INVALID_WEBHOOK_SECRET_FORMAT",fix:"Use only A-Z, a-z, 0-9, underscores and hyphens in ANGEL_WEBHOOK_SECRET."});
        await telegram(token,"setWebhook",{
          url:endpoint,
          secret_token:secret,
          allowed_updates:["message","callback_query"],
          drop_pending_updates:false
        });
        return res.status(200).json({ok:true,service:"angel-solution",webhook:"registered",endpoint});
      }
      return res.status(200).json({
        ok:true,service:"angel-solution",
        webhook:currentUrl === endpoint ? "connected" : "other_webhook_present",
        endpoint_matches:currentUrl === endpoint,
        pending_update_count:info.pending_update_count || 0,
        last_error_message: info.last_error_message || null
      });
    } catch (err) {
      console.error("ANGEL webhook setup status error",err.message);
      const reason = String(err.message || "");
      const reasonCode = /Unauthorized|401/i.test(reason) ? "INVALID_BOT_TOKEN"
        : /Not Found|404/i.test(reason) ? "BOT_NOT_FOUND_OR_BAD_TOKEN"
        : /fetch failed|network|ETIMEDOUT|ECONN/i.test(reason) ? "TELEGRAM_NETWORK_ERROR"
        : /Bad Request|400/i.test(reason) ? "TELEGRAM_BAD_REQUEST"
        : "TELEGRAM_API_ERROR";
      return res.status(502).json({ok:false,error:"Bot connectivity check failed",phase,reason:reasonCode,telegram_message:reason.replace(/\d{8,10}:[A-Za-z0-9_-]{35,}/g,"[REDACTED]").slice(0,200)});
    }
  }
  if (req.method !== "POST") return res.status(405).json({ok:false,error:"Method not allowed"});
  const token = process.env.ANGEL_BOT_TOKEN;
  const secret = process.env.ANGEL_WEBHOOK_SECRET;
  if (!token || !secret) return res.status(503).json({ok:false,error:"Missing ANGEL_BOT_TOKEN / ANGEL_WEBHOOK_SECRET"});
  if (req.headers["x-telegram-bot-api-secret-token"] !== secret)
    return res.status(403).json({ok:false,error:"Forbidden"});
  const update = req.body || {};
  try {
    // Private chat: forward a post from a private channel to identify its numeric chat ID.
    // Telegram may omit forward_origin when message forwarding attribution is hidden.
    if (update.message?.chat?.type === "private") {
      const m = update.message;
      const origin = m.forward_origin;
      const forwardedChannel = origin?.type === "channel" ? origin.chat : m.forward_from_chat;
      if (forwardedChannel?.type === "channel" && forwardedChannel.id) {
        await telegram(token, "sendMessage", {
          chat_id: m.chat.id,
          text: "📣 전달된 채널의 ID: " + forwardedChannel.id +
            "\nVercel ANGEL_CHANNEL_ID에 위 숫자를 입력하세요." +
            "\n👤 내 사용자 ID: " + m.from.id +
            "\nVercel ANGEL_ADMIN_USER_ID에 위 숫자를 입력하세요."
        });
      }
    }
    if (update.message?.text) {
      const m = update.message;
      const command = m.text.trim().split(/\s/)[0].split("@")[0].toLowerCase();
      if (command === "/ids" || command === "/channelid") {
        await telegram(token,"sendMessage",{chat_id:m.chat.id,text:"👤 내 사용자 ID: " + m.from.id + "\n\n📣 비공개 채널 ID 확인: 봇을 채널 관리자로 추가한 뒤, 채널 게시물 하나를 이 봇 개인 채팅으로 전달하세요. 전달 출처가 숨겨져 있으면 채널 ID를 확인할 수 없습니다."});
      } else if (command === "/start" || command === "/menu") {
        await telegram(token,"sendMessage", {
          chat_id:m.chat.id, text:MESSAGE
        });
      } else if (command === "/myid") {
        await telegram(token,"sendMessage", {
          chat_id:m.chat.id,text:"내 텔레그램 사용자 ID: " + m.from.id
        });
      } else if (command === "/publish") {
        const adminId = process.env.ANGEL_ADMIN_USER_ID;
        const channelId = process.env.ANGEL_CHANNEL_ID;
        if (!adminId || String(m.from.id) !== String(adminId) || m.chat.type !== "private") {
          await telegram(token,"sendMessage",{chat_id:m.chat.id,text:"게시 권한이 없습니다. 관리자 환경변수를 확인하세요."});
        } else if (!channelId) {
          await telegram(token,"sendMessage",{chat_id:m.chat.id,text:"ANGEL_CHANNEL_ID를 설정하세요."});
        } else {
          const posted = await telegram(token,"sendMessage",{
            chat_id:channelId,text:MESSAGE
          });
          await telegram(token,"sendMessage",{
            chat_id:m.chat.id,text:"채널 게시 완료 (message_id: " + posted.message_id + ")"
          });
        }
      }
    }
    return res.status(200).json({ok:true});
  } catch (error) {
    console.error("ANGEL SOLUTION webhook error",error.message);
    return res.status(500).json({ok:false,error:"Telegram delivery failed"});
  }
}
