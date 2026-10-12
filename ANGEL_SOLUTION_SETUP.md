# ANGEL SOLUTION 봇 설정

기존 COINHOUSE의 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `WEBHOOK_SECRET`는 수정하지 않습니다.

## 1. Vercel 환경변수 (Production)
프로젝트 `coinhouse-telegram-webhook` → Settings → Environment Variables

- `ANGEL_BOT_TOKEN`: @BotFather에서 @angeltch_bot 토큰 (Secret, 절대 GitHub에 추가하지 마세요)
- `ANGEL_WEBHOOK_SECRET`: 영문·숫자·하이픈·밑줄로 이뤄진 16~100자의 별도 랜덤 문자열 (Secret)
- `ANGEL_ADMIN_USER_ID`: 봇에게 `/myid`를 보냈을 때 출력되는 숫자 ID
- `ANGEL_CHANNEL_ID`: 채널 공개 @username 혹은 비공개 채널 numeric chat ID (예: -100...)

환경변수를 저장한 뒤 **Redeploy**합니다. 이 봇은 Vercel 서버리스 함수라 별도 항상 켜진 PC/서버가 필요 없습니다.

## 2. Telegram 웹훅 설정
BotFather에서 얻은 토큰을 터미널의 환경변수로만 설정합니다. 아래 POST를 전송합니다.

```bash
curl -X POST "https://api.telegram.org/bot$ANGEL_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://coinhouse-telegram-webhook.vercel.app/api/angel","secret_token":"여기에_ANGEL_WEBHOOK_SECRET_값","allowed_updates":["message","callback_query"],"drop_pending_updates":false}'
```

`secret_token` 값은 Vercel의 `ANGEL_WEBHOOK_SECRET` 값과 정확히 동일해야 합니다.
이미 이 봇에 **다른 서비스의 웹훅이 존재하면 덮어쓰므로** 기존 운영을 먼저 확인하세요. 코인하우스의 다른 봇 웹훅에는 영향이 없습니다.

## 3. 채널 게시
1. @angeltch_bot을 채널 관리자로 추가하고 **메시지 게시** 권한을 부여합니다.
2. 봇과 개인 채팅 시작 → `/myid` 확인 → Vercel `ANGEL_ADMIN_USER_ID` 등록 및 재배포.
3. 채널 ID를 `ANGEL_CHANNEL_ID`로 등록, 재배포.
4. 봇 개인 채팅에서 `/menu`로 미리보기 확인.
5. 봇 개인 채팅에서 `/publish`로 채널에 전송.

## 버튼 동작
- 서비스 9개: 눌렀을 때 해당 서비스 설명을 Telegram 팝업 알림으로 보여줍니다.
- 상담 버튼: https://t.me/angel_solt 링크를 엽니다.
- 광고 형식: 3열 × 3행 + 하단 상담 버튼.
- 검증: `GET /api/angel`은 환경변수 구성 여부만 표시하며 비밀은 노출하지 않습니다.

## 문제해결
- 503: 환경변수 미등록 또는 배포 미반영.
- 403: Telegram `secret_token` 값 불일치.
- `/publish` 권한 없음: `ANGEL_ADMIN_USER_ID` 확인, 봇과 개인 채팅 확인.
- 채널 전송 실패: 봇 관리자의 게시 권한과 채널 ID 확인.

> ANGEL_WEBHOOK_SECRET 값 변경 후 Production 환경변수 반영을 위해 새 배포가 필요합니다.
