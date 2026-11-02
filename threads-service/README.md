# 차트포스트 Railway 웹 베이스

기존 coinhouse-telegram-webhook 저장소의 기존 api 및 vercel.json은 유지하고 threads-service/만 추가했습니다.

Railway 서비스 설정에서 Root Directory = /threads-service, Build Command = npm run build, Start Command = npm run start. 사용자에게 노출되는 화면은 한국어입니다.

현재는 외부 인증과 결제 연결 전이므로 실제 회원가입, Threads 게시 및 결제는 활성화하지 않습니다. 

전체 기능 초안은 앞서 전달한 별도 ZIP에 포함되어 있으며, 이 Railway 베이스는 우선 사이트 접속과 시각적 UI 확인용입니다.
