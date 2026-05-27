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

## 모드

첫 화면에서 모드를 선택합니다.

- 스트리밍 모드: RTSP 영상만 표시하고, 캡처는 RTSP 프레임을 로컬 폴더와 JSON DB에 저장합니다.
- 대화모드: 영상 송출 없이 MCP 인식 결과와 장치 기능으로 AI와 대화합니다.

## 실시간 화면 전송

- 큰 화면은 HUSKYLENS RTSP 스트림 `rtsp://<HUSKYLENS_IP>:8554/live`를 로컬 백엔드가 받아서 표시합니다.
- MCP 연결은 계속 `http://<HUSKYLENS_IP>:3000/sse`를 사용합니다.
- RTSP 화면과 MCP 대화는 같은 장치를 바라보지만 동시에 사용하지 않는 것을 기본 흐름으로 둡니다.
- 큰 화면은 인식 결과 이미지로 대체하지 않습니다.
- 스트리밍 모드에서는 일반 MCP 인식 호출을 하지 않습니다.
- 대화모드에서 질문할 때는 MCP `get_recognition_result`로 최신 인식 결과를 가져와 LLM에 전달합니다.
- `촬영`, `사진 찍어` 같은 채팅 명령은 MCP `multimedia_control`의 `take_photo`를 실행합니다.
- `사람이 감지되면 찍어` 같은 조건부 촬영 명령은 MCP `task_scheduler`가 있으면 `create_task`로 등록합니다.
- 스트리밍 모드의 캡처 버튼은 MCP 사진 촬영이 아니라 RTSP 현재 프레임 저장입니다.

HUSKYLENS 2에서 RTSP Streaming을 켜야 영상이 표시됩니다. 앱은 번들된 `ffmpeg`를 우선 사용하고, 필요하면 `FFMPEG_PATH` 또는 시스템 `ffmpeg`를 사용할 수 있습니다. 실제 영상 속도는 HUSKYLENS RTSP 상태와 Wi-Fi 품질에 따라 달라집니다.

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
