# Product Requirements Document

## Product

HUSKYLENS 2 Vision Chat is a local React web app that lets students ask questions about what a HUSKYLENS 2 camera sees. The app runs on each student's computer, connects to the HUSKYLENS 2 MCP server over the same Wi-Fi, and sends recognition context to OpenAI.

## Goal

Students should be able to clone the GitHub repository, run the app locally, connect to the camera, and use the chatbot during a competition day without installing Cherry Studio or writing MCP code.

## Non-Goals

- Do not require Cherry Studio.
- Do not require students to edit source code.
- Do not commit API keys.
- Do not assume a fixed HUSKYLENS IP address.
- Do not assume the MCP server accepts natural language parameters for tools.

## Users

- Student: runs the app, connects to the device, asks questions.
- Teacher or operator: prepares the repository, API key guidance, and hardware setup.

## Primary Flow

1. Student clones the repository.
2. Student runs `npm install`.
3. Student runs `npm run start`.
4. Student opens `http://localhost:5173`.
5. Student connects to HUSKYLENS 2 using auto discovery or manual MCP URL entry.
6. The main screen starts showing the HUSKYLENS scene.
7. Student asks a question in the right-side chat.
8. The local backend reads the active HUSKYLENS algorithm.
9. The local backend requests the recognition result from MCP.
10. The local backend sends the detection data and camera image to OpenAI.
11. The chat displays the answer.

## Hardware And Network Requirements

- HUSKYLENS 2 firmware V1.1.6 or newer
- HUSKYLENS 2 Wi-Fi module
- Student computer and HUSKYLENS 2 on the same Wi-Fi
- HUSKYLENS 2 MCP Service enabled
- MCP URL format: `http://<HUSKYLENS_IP>:3000/sse`

## Dynamic MCP URL Requirement

The MCP URL must be treated as runtime data. It can change across Wi-Fi networks, DHCP leases, device restarts, and competition rooms.

Required behavior:

- Provide an auto discovery button.
- On first load, try the last successful URL with a short timeout when one exists.
- Start discovery in parallel when a startup connection attempt is slow.
- Forget the stored URL after an automatic startup connection failure.
- Run discovery once on first load when there is no last successful URL or the stored URL is no longer reachable.
- Allow manual URL entry.
- Persist the last successful URL locally.
- Show connection state clearly.
- Do not hard-code a HUSKYLENS IP in application logic.

## MCP Integration Requirement

The app must follow the live MCP tool schemas returned by the device.

The canonical project reference for observed MCP capabilities is [MCP_REFERENCE.md](MCP_REFERENCE.md). The AI assistant receives this reference and the connected device's raw MCP tool schema as context so it can explain HUSKYLENS MCP capabilities without inventing tool names or claiming unimplemented actions were executed.

Observed current tool call sequence:

```json
{ "tool": "manage_applications", "arguments": { "operation": "current_application" } }
```

Then:

```json
{ "tool": "get_recognition_result", "arguments": { "operation": "get_result", "algorithm": 2 } }
```

The algorithm id must come from the current application response. The UI can later add explicit app switching, but recognition must work with the currently running app first.

## Vision Context Requirement

The HUSKYLENS MCP result can include:

- detection records such as `keyboard`, `tv`, or `scissors`
- bounding box fields such as `xCenter`, `yCenter`, `width`, `height`
- a camera image resource link

If the image resource link uses `192.168.88.1`, rewrite it to the current MCP host before fetching. The backend should pass both structured detections and the image to OpenAI when possible.

## LLM Requirement

- Default model: `gpt-5.4-mini`
- API key source: `.env` or local user input
- If `.env` does not contain `OPENAI_API_KEY`, the UI must show an API key input.
- Server route: `/api/ask`
- The browser should not call OpenAI directly.
- The assistant should provide accurate, polished Korean answers.
- The assistant should synthesize detections and image evidence instead of merely repeating raw labels.
- The assistant should state uncertainty when the image is unclear or detections are empty.
- The assistant may use Markdown for lists, emphasis, and tables.

## UI Requirement

- React + Tailwind CSS
- Pretendard font
- Calm, refined IDE-like visual style
- Avoid oversized rounded cards and decorative glass effects; use sharper panels, compact toolbars, and restrained controls.
- Main surface is the HUSKYLENS screen with a real chatbot conversation beside it on laptop and desktop screens
- Chat messages render Markdown.
- Settings are available but secondary
- The student-facing settings panel should expose only API key handling; model and reasoning defaults belong in server configuration.
- Advanced controls are kept out of the main student flow unless they directly support screen viewing or asking questions
- No gradients unless explicitly requested
- User-facing copy should be concise product language

## Reliability Requirement

- MCP calls must be queued per device URL.
- Timeouts should produce actionable messages.
- On timeout, reset the MCP client session so the next call can reconnect.
- The competition app must not provide camera-free mock answers.
- If no HUSKYLENS MCP connection exists, the user cannot submit a camera-based question.
- The app must not present generated answers as camera-grounded unless they use a real recognition result from HUSKYLENS.
- Chat history should not persist across app loads, and changing to a different HUSKYLENS URL should clear stale conversation and scene context.

## Validation

Before considering a change complete:

```bash
npm run check:ui
npm run build
```

`npm run check` runs both commands in order.

The UI check must preserve the primary screen, the right-side chat flow, Markdown rendering, connection checklist copy, address-change stale scene/answer protection, and camera-grounded server answer path while preventing old settings/data/upload surfaces from returning.

For hardware validation:

1. Auto discover or enter the MCP URL.
2. Connect.
3. Read the current scene.
4. Ask a short question.
5. Confirm the response references the latest recognition result.

Use [hardware-validation.md](hardware-validation.md) for the full classroom checklist.
