/**
 * ANGEL SOLUTION Telegram channel ad handler.
 * Isolated from existing COINHOUSE services and credentials.
 * Telegram: setWebhook to https://<deployment>/api/angel, with secret_token.
 */
const SERVICES = [
  ["🌐 랜딩페이지", "랜딩페이지 제작: 목적과 디자인에 맞는 맞춤형 페이지를 개발합니다."],
  ["🤖 봇 개발", "텔레그램 봇 개발: 자동 응답, 메뉴, 알림 등 필요한 기능을 구현합니다."],
  ["⚙️ 맞춤 솔루션", "맞춤 솔루션: 요구사항을 분석하여 전용 프로그램을 제작합니다."],
  ["💻 단독 개발", "단독 개발: 기존 제품 복사가 아닌 고객 요구에 맞춰 설계합니다."],
  ["📦 프로젝트 판매", "프로젝트 납품: 협의된 범위의 개발 결과물을 전달합니다."],
  ["🖥️ 서버 구축", "서버 구축: 고객 소유 서버에 배포하도록 지원합니다."],
  ["📁 원본파일 제공", "원본 파일: 계약 범위에 따라 소스 및 배포 파일을 제공합니다."],
  ["✨ AI 활용 개발", "AI 활용 개발: 적합한 곳에 AI 기술을 활용하여 구현합니다."],
  ["💰 합리적 가격", "가격 안내: 개발 범위를 확인하고 개별 견적을 제공합니다."]
];
const MESSAGE = [
  "💠 ANGEL SOLUTION",
  "원하시는 상상을 현실로",
  "",
  "랜딩페이지 · 솔루션 · 봇 · 개발",
  "AI를 활용한 단독 개발 솔루션",
  "",
  "복사·붙여넣기가 아닌 나만의 맞춤형 솔루션.",
  "프로젝트 납품 · 원본 파일 제공 · 고객 서버 구축 가능",
  "요구사항에 맞춘 견적을 상담해 드립니다."
].join("\n");

function keyboard() {
  const rows = [];
  for (let i = 0; i < SERVICES.length; i += 3) {
    rows.push(SERVICES.slice(i, i + 3).map(([text], off) => ({
      text, callback_data: "angel_service_" + (i + off)
    })));
  }
  rows.push([{text:"⭐ 1:1 솔루션 문의하기", url:"https://t.me/angel_solt"}]);
  return {inline_keyboard: rows};
}
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
  if (req.method === "GET") return res.status(200).json({ok:true,service:"angel-solution",configured:!!process.env.ANGEL_BOT_TOKEN});
  if (req.method !== "POST") return res.status(405).json({ok:false,error:"Method not allowed"});
  const token = process.env.ANGEL_BOT_TOKEN;
  const secret = process.env.ANGEL_WEBHOOK_SECRET;
  if (!token || !secret) return res.status(503).json({ok:false,error:"Missing ANGEL_BOT_TOKEN / ANGEL_WEBHOOK_SECRET"});
  if (req.headers["x-telegram-bot-api-secret-token"] !== secret)
    return res.status(403).json({ok:false,error:"Forbidden"});
  const update = req.body || {};
  try {
    if (update.callback_query) {
      const q = update.callback_query;
      const match = /^angel_service_(\d+)$/.exec(q.data || "");
      const idx = match ? Number(match[1]) : -1;
      const detail = idx >= 0 && idx < SERVICES.length ? SERVICES[idx][1] : "선택한 서비스를 확인할 수 없습니다.";
      await telegram(token, "answerCallbackQuery", {
        callback_query_id:q.id, text:detail, show_alert:true
      });
    }
    if (update.message?.text) {
      const m = update.message;
      const command = m.text.trim().split(/\s/)[0].split("@")[0].toLowerCase();
      if (command === "/start" || command === "/menu") {
        await telegram(token,"sendMessage", {
          chat_id:m.chat.id, text:MESSAGE, reply_markup:keyboard()
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
            chat_id:channelId,text:MESSAGE,reply_markup:keyboard()
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
