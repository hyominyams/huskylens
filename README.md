# HUSKYLENS 2 Vision LLM Console

학생 PC에서 HUSKYLENS 2 MCP Server와 OpenAI API를 연결해 사용하는 로컬 웹앱입니다.

체리스튜디오 없이 브라우저 채팅 화면에서 카메라 인식 결과를 읽고 `gpt-5.4-mini`로 답변합니다.

## 준비

- HUSKYLENS 2 펌웨어 V1.1.6 이상
- HUSKYLENS 2 Wi-Fi 모듈
- 학생 PC와 HUSKYLENS 2가 같은 Wi-Fi에 연결
- OpenAI API Key

> Node.js 20+ 은 설치 스크립트가 자동으로 설치합니다(사용자 권한만 필요, 관리자/sudo 불필요).

## 빠른 시작

저장소를 클론한 뒤 한 줄만 실행하면 됩니다.

**macOS / Linux**

```bash
git clone <레포_주소> huskylens
cd huskylens
bash setup.sh
```

**Windows**

```cmd
git clone <레포_주소> huskylens
cd huskylens
setup.cmd
```

> Windows는 파일 탐색기에서 `setup.cmd` 를 더블클릭해도 됩니다.

스크립트가 수행하는 것:

1. Node.js 20+ 이 없으면 [fnm](https://github.com/Schniz/fnm)으로 사용자 홈에 자동 설치
2. `npm install` 로 의존성 설치
3. `.env.example` 을 `.env` 로 복사

설치가 끝나면 `.env` 를 열어 `OPENAI_API_KEY=sk-...` 한 줄만 채우고 실행합니다.

```bash
npm start
```

브라우저에서 `http://localhost:5173` 을 엽니다.

> 이미 Node 20+ 가 깔려 있으면 setup 스크립트 없이 `npm install && npm start` 만 해도 됩니다.

## HUSKYLENS 2 연결

1. HUSKYLENS 2에서 `MCP Service`를 켭니다.
2. 화면에 표시되는 주소를 확인합니다.
3. 웹앱에서 `자동 찾기`를 누르거나 MCP URL을 직접 입력합니다.
4. `연결`을 누릅니다.

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

`.env`에 API 키가 있으면 서버가 그 키를 사용합니다. `.env`에 `OPENAI_API_KEY`가 없거나 비어 있으면 화면에 API Key 입력칸이 표시됩니다.

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
브라우저 채팅 UI
  -> 로컬 백엔드
  -> HUSKYLENS 2 MCP Server
  -> 현재 알고리즘 확인
  -> 인식 결과 요청
  -> OpenAI Responses API
  -> 채팅 응답
```

현재 HUSKYLENS 2 MCP 서버는 도구 호출에 `operation` 파라미터를 요구합니다.

인식 결과 호출 순서:

1. `manage_applications` with `{ "operation": "current_application" }`
2. `get_recognition_result` with `{ "operation": "get_result", "algorithm": <현재 알고리즘 ID> }`

장치가 이미지 주소를 `192.168.88.1`로 반환할 수 있습니다. 앱은 이 주소를 현재 MCP 호스트로 자동 보정합니다.

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

## 점검

```bash
npm run doctor
```

포트와 로컬 네트워크 주소를 확인합니다.

연결이 되지 않으면 [docs/troubleshooting.md](docs/troubleshooting.md)를 확인합니다.

## 문서

- [Product Requirements](docs/PRD.md)
- [HUSKYLENS MCP Reference](docs/MCP_REFERENCE.md)
- [Troubleshooting](docs/troubleshooting.md)
