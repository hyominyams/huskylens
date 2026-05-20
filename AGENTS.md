# AGENTS.md

## Product Context

This project is a local web app for students using HUSKYLENS 2 during a competition or classroom activity.

Students clone the GitHub repository, run the app locally, connect to a HUSKYLENS 2 on the same Wi-Fi, and chat with an OpenAI model using the camera's MCP recognition result as context.

## Core Assumptions

- The HUSKYLENS MCP URL is not stable.
- The MCP URL can change when the device joins a different Wi-Fi, reconnects, reboots, or moves between networks.
- The app must support both automatic discovery and manual MCP URL input.
- The expected URL shape is `http://<HUSKYLENS_IP>:3000/sse`.
- The OpenAI API key must never be committed.
- The default OpenAI model is `gpt-5.4-mini`.

## HUSKYLENS MCP Notes

Use `docs/MCP_REFERENCE.md` as the canonical local reference for observed HUSKYLENS MCP tools and current app support. The runtime also sends the connected device's raw MCP tool schema to the AI on `/api/ask`. Keep the reference file updated when adding backend routes, UI controls, or newly verified MCP operations.

The live HUSKYLENS 2 MCP server uses operation-based tool arguments. Do not call tools with free-form `question` or `instruction` parameters unless the tool schema explicitly supports them.

Current observed tool behavior:

- `manage_applications`
  - current app: `{ "operation": "current_application" }`
  - list apps: `{ "operation": "application_list" }`
  - switch app: `{ "operation": "switch_application", "algorithm": "<English app name>" }`
- `get_recognition_result`
  - result: `{ "operation": "get_result", "algorithm": <current algorithm id> }`
- `multimedia_control`
  - photo: `{ "operation": "take_photo", "resolution": "1280x720" }`

Before calling `get_recognition_result`, call `manage_applications` with `current_application` and extract the active algorithm id.

The device may return image resource URLs using an internal address such as `192.168.88.1`. If the MCP connection uses a Wi-Fi IP such as `10.x.x.x`, rewrite returned resource links to the MCP host before fetching or displaying them.

The MCP server is sensitive to concurrent tool calls. Queue tool calls per MCP URL and reset the session on timeout.

## Assistant Behavior

- The assistant must behave as an accurate, polished Korean AI assistant, not a raw label reader.
- Use HUSKYLENS detections as evidence, but also use the returned image when available.
- Do not overstate uncertain recognition results.
- If detections are empty or the image is unclear, say what is visible and what needs to be shown again.
- Keep default answers concise, usually 1-3 sentences.
- Use Markdown when it improves readability, including short bullet lists, tables, and bold emphasis.
- Do not expose raw MCP JSON, tool schemas, or implementation details in normal user-facing answers.

## UI Rules

- Do not use gradients in UI unless the user explicitly asks for them.
- Do not write visible UI copy in a meta, explanatory, or implementation-focused tone.
- Write all user-facing copy as direct product language for the end user.
- Avoid wording such as "정리했습니다", "구성했습니다", "배치했습니다", "비교할 수 있도록" in visible UI copy unless the user explicitly wants explanatory wording.
- Use Pretendard and Tailwind CSS for the current React UI.
- The primary screen should feel like a real chatbot conversation, not a settings console.
- Chat messages must render Markdown.

## Implementation Guidance

- Keep the student path simple: `npm install`, `npm run start`, open `http://localhost:5173`.
- Keep settings available but secondary to the chat.
- Prefer server-side calls for OpenAI and MCP so the browser does not manage protocols or API keys directly.
- Do not include a camera-free mock mode in the competition app.
- The app must not pretend that HUSKYLENS data exists when no real device is connected.
- Asking questions should require a real HUSKYLENS MCP connection.
- Run `npm run build` after code changes.
