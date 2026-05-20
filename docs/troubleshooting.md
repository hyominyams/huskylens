# Troubleshooting

## 자동 찾기가 실패할 때

HUSKYLENS 2 화면에 표시되는 MCP 주소를 직접 입력합니다.

예:

```txt
http://192.168.1.23:3000/sse
```

확인할 항목:

- HUSKYLENS 2 펌웨어가 V1.1.6 이상인지 확인
- Wi-Fi 모듈이 장착되어 있는지 확인
- HUSKYLENS 2와 PC가 같은 Wi-Fi에 연결되어 있는지 확인
- HUSKYLENS 2에서 `MCP Service`가 켜져 있는지 확인
- 학교 Wi-Fi가 장치 간 통신을 막는지 확인

MCP URL은 Wi-Fi에 따라 바뀔 수 있습니다. 이전에 성공한 주소가 다음 실행에서도 맞는다고 가정하지 마세요.

## operation 파라미터 오류가 날 때

HUSKYLENS 2 MCP 도구는 자유 문장 파라미터가 아니라 `operation` 기반 파라미터를 요구합니다.

인식 결과는 다음 순서로 호출해야 합니다.

```json
{ "operation": "current_application" }
```

그 다음 현재 알고리즘 ID를 사용합니다.

```json
{ "operation": "get_result", "algorithm": 2 }
```

앱은 이 흐름을 백엔드에서 처리합니다. 같은 오류가 다시 보이면 개발 서버를 재시작하세요.

## 이미지 주소가 열리지 않을 때

HUSKYLENS 2가 결과 이미지 URL을 `http://192.168.88.1/...` 형태로 반환할 수 있습니다.

현재 Wi-Fi에서 MCP URL이 `http://10.x.x.x:3000/sse`라면 브라우저나 서버는 `192.168.88.1`에 접근하지 못할 수 있습니다. 앱은 반환된 이미지 URL의 호스트를 현재 MCP 호스트로 자동 보정합니다.

## OpenAI 응답이 실패할 때

- API Key가 올바른지 확인
- 모델명이 `gpt-5.4-mini`인지 확인
- 네트워크에서 `api.openai.com` 접속이 가능한지 확인
- 결제 또는 사용 한도가 남아 있는지 확인

## 포트가 이미 사용 중일 때

```bash
npm run doctor
```

`8787` 또는 `5173` 포트가 이미 사용 중이면 해당 프로그램을 종료한 뒤 다시 실행합니다.
