# HUSKYLENS 2 Vision Chat

학생 PC에서 HUSKYLENS 2 MCP Server와 OpenAI API를 연결해 사용하는 로컬 웹앱입니다.

체리스튜디오 없이 브라우저에서 허스키렌즈 화면을 크게 보면서 오른쪽 채팅창에서 `gpt-5.4-mini`와 대화합니다.

## 준비

- HUSKYLENS 2 펌웨어 V1.1.6 이상
- HUSKYLENS 2 Wi-Fi 모듈
- 학생 PC와 HUSKYLENS 2가 같은 Wi-Fi에 연결
- OpenAI API 키

> Node.js 20+ 은 설치 스크립트가 자동으로 설치합니다(사용자 권한만 필요, 관리자/sudo 불필요).

## 빠른 시작

저장소를 클론한 뒤 의존성을 설치하고 실행합니다.

**macOS / Linux**

```bash
git clone <레포_주소> huskylens
cd huskylens
npm install
npm run start
```

**Windows**

```cmd
git clone <레포_주소> huskylens
cd huskylens
npm install
npm run start
```

브라우저에서 `http://localhost:5173` 을 엽니다.

Node.js 20+ 설치가 어렵다면 `setup.sh` 또는 `setup.cmd`를 사용할 수 있습니다. 설치 스크립트는 Node.js가 없을 때 사용자 홈에 설치하고 `.env.example`을 `.env`로 복사합니다.

## HUSKYLENS 2 연결

1. HUSKYLENS 2에서 `MCP Service`를 켭니다.
2. 화면에 표시되는 주소를 확인합니다.
3. 웹앱이 마지막 성공 주소가 있으면 짧게 자동 연결을 시도합니다.
4. 저장된 주소가 느리거나 맞지 않으면 같은 Wi-Fi의 HUSKYLENS를 함께 찾아봅니다.
5. 장치가 보이면 발견된 장치를 누릅니다. 누르면 바로 연결됩니다.
6. 장치가 보이지 않으면 `자동 찾기`를 다시 누르거나 MCP URL을 직접 입력한 뒤 `연결`을 누릅니다.
7. 연결되면 화면이 자동으로 시작되고, 오른쪽 채팅창에서 질문합니다.

MCP URL은 Wi-Fi에 따라 바뀔 수 있습니다. 고정값으로 보지 말고 실행할 때마다 현재 주소를 확인하세요.

주소 형식:

```txt
http://<HUSKYLENS_IP>:3000/sse
```

실제 예:

```txt
http://10.241.134.243:3000/sse
```

## OpenAI 설정

기본 모델은 `gpt-5.4-mini`입니다.

`.env`에 API 키가 있으면 앱이 그 키를 사용합니다. `.env`에 `OPENAI_API_KEY`가 없거나 비어 있으면 화면에 API 키 입력칸이 표시됩니다.
학생 화면에서는 API 키만 입력합니다. 모델과 추론 강도는 운영자가 `.env`에서 바꿀 수 있습니다.

`.env` 파일에 키를 넣어도 됩니다.

```bash
cp .env.example .env
```

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4-mini
OPENAI_REASONING_EFFORT=low
```

`.env`는 Git에 올라가지 않습니다.

## 작동 방식

```txt
브라우저 화면 + 채팅 UI
  -> 로컬 백엔드
  -> HUSKYLENS 2 MCP Server
  -> 현재 알고리즘 확인
  -> 인식 결과 요청
  -> 화면 스냅샷 또는 현재 장면 이미지 수신
  -> OpenAI Responses API
  -> 채팅 응답
```

현재 HUSKYLENS 2 MCP 서버는 도구 호출에 `operation` 파라미터를 요구합니다.

인식 결과 호출 순서:

1. `manage_applications` with `{ "operation": "current_application" }`
2. `get_recognition_result` with `{ "operation": "get_result", "algorithm": <현재 알고리즘 ID> }`

장치가 이미지 주소를 `192.168.88.1`로 반환할 수 있습니다. 앱은 이 주소를 현재 MCP 호스트로 자동 보정합니다.

## 화면 전송

연결에 성공하면 허스키렌즈 화면이 자동으로 시작됩니다.

- 기본은 HUSKYLENS `take_screenshot` 결과를 사용합니다.
- 큰 화면은 인식 결과 이미지로 대체하지 않습니다.
- 스크린샷이 느리거나 실패하면 마지막 화면을 유지하고 다음 갱신을 기다립니다.
- 다음 화면 요청은 이전 요청이 끝난 뒤 실행되어 장치에 요청이 쌓이지 않습니다.
- 자동 갱신 요청은 짧게 끊어 채팅 질문이 화면 갱신 뒤에서 오래 기다리지 않게 합니다.
- AI가 답변을 만드는 동안에는 새 화면 요청을 잠시 멈추고 마지막 화면을 유지합니다.
- 질문 직전에 들어간 화면 요청이 늦게 끝나도 답변 중 화면 상태를 덮지 않습니다.
- 질문할 때 최신 인식 결과나 화면이 이미 있으면 인식 호출을 짧게 시도하고, 지연되면 그 장면으로 먼저 답합니다.
- 마지막 화면은 유지되므로 일시적인 Wi-Fi 지연에도 화면이 바로 비지 않습니다.
- 이미 화면이 보이는 상태에서 자동 갱신이 잠깐 실패해도 학생 화면을 에러로 덮지 않습니다.
- 화면 상단에는 최근 수신 시간이 함께 표시되어 Wi-Fi 지연을 바로 확인할 수 있습니다.

이 기능은 스냅샷 기반 화면 갱신입니다. 실제 속도는 Wi-Fi 상태와 HUSKYLENS MCP 응답 속도에 따라 달라집니다.

## 답변 품질

앱의 AI 비서는 HUSKYLENS 감지 결과와 실제 이미지를 함께 참고합니다.

- 감지 라벨을 그대로 반복하지 않고 장면을 자연스럽게 설명합니다.
- 이미지가 흐리거나 감지 결과가 비어 있으면 불확실성을 말합니다.
- 기본 답변은 짧고 정확하게 제공합니다.
- 목록, 강조, 표가 필요한 답변은 Markdown으로 표시합니다.
- MCP 기능 설명은 [docs/MCP_REFERENCE.md](docs/MCP_REFERENCE.md)와 현재 연결된 장치의 raw tool schema를 함께 기준으로 답합니다.
- HUSKYLENS MCP가 지원하는 기능과 현재 웹앱에서 실제 실행되는 기능을 구분합니다.

## 대회 운영 원칙

이 앱은 카메라 없이 답변하지 않습니다.

- HUSKYLENS MCP 연결이 없으면 질문을 보낼 수 없습니다.
- 실제 인식 결과 없이 카메라 기반 답변을 생성하지 않습니다.
- 대회 중 학생에게 가상 데이터가 실제 카메라 결과처럼 보이면 안 됩니다.
- 브라우저를 새로 열면 대화가 새로 시작됩니다.
- 다른 HUSKYLENS 주소로 바꾸면 이전 대화와 장면 맥락을 사용하지 않습니다.

## 점검

```bash
npm run check
npm run doctor
```

`npm run check`는 UI 원칙, 필수 학생 흐름, 카메라 기반 답변 계약, 빌드를 함께 확인합니다.

`npm run doctor`는 Node.js, `.env`, API 키 상태, 로컬 앱 주소, 서버 응답, 자동 찾기 응답 시간, 연결 없는 질문/화면 요청 차단을 확인합니다. 로컬 서버나 핵심 API 계약이 깨지면 실패 코드로 끝납니다.

연결이 되지 않으면 [docs/troubleshooting.md](docs/troubleshooting.md)를 확인합니다.

실제 장치 검증은 [docs/hardware-validation.md](docs/hardware-validation.md)를 따릅니다.

## 문서

- [Product Requirements](docs/PRD.md)
- [HUSKYLENS MCP Reference](docs/MCP_REFERENCE.md)
- [Hardware Validation](docs/hardware-validation.md)
- [Troubleshooting](docs/troubleshooting.md)
