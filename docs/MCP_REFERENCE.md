# HUSKYLENS 2 MCP Reference

This document records the MCP capabilities observed from the connected HUSKYLENS 2 device. It is used both as project documentation and as context for the AI assistant.

The app also sends the connected device's raw MCP `listTools()` schema to the AI on each `/api/ask` request. This document is the human-readable guide; the raw schema is the source of truth for exact tool names, operations, required fields, and parameter descriptions.

## Operating Rules

- The competition app must not pretend to use the camera when HUSKYLENS is not connected.
- Detection labels are clues, not final truth. The AI should compare detection results with the actual image when available.
- MCP URLs can change when Wi-Fi changes. The app should prefer auto-discovery and still allow manual URL entry.
- The AI may explain MCP capabilities, but it must not claim that it has executed a device action unless the backend has actually called the MCP tool.
- Destructive or persistent actions, such as forgetting learned objects, changing parameters, or switching algorithms, should require explicit UI confirmation.
- The raw schema should guide MCP capability judgments, but it should not restrict normal conversation or scene explanation.
- If a user asks a broad or informal question that does not match a tool exactly, answer naturally using the scene context and explain the closest relevant MCP capability only when useful.

## Currently Implemented In This App

### Auto-Discover MCP Server

- Backend scans local IPv4 subnets for `http://<ip>:3000/sse`.
- A candidate is accepted when it responds as `text/event-stream`.
- Works when the student computer and HUSKYLENS are on the same reachable network segment.
- May fail on networks with client isolation, different subnets, different ports, or blocked local traffic.

### Connect To HUSKYLENS

- Uses MCP SSE transport.
- Lists available tools after connection.
- Shows connection status and tool count in the UI.

### Read Current Scene

- Calls `manage_applications` with `operation: "current_application"` to find the active algorithm ID.
- Calls `get_recognition_result` with `operation: "get_result"` and the active algorithm.
- Normalizes:
  - `algorithm`
  - `currentApplication`
  - `detections`
  - `resources`
  - raw MCP payload
- Rewrites image resource hosts to the current MCP host when the device returns an internal host such as `192.168.88.1`.

### Ask AI About The Scene

- Sends the user question, structured detection data, and the current HUSKYLENS image to OpenAI.
- Sends the current MCP raw tool schema to OpenAI so the AI can reason about device capabilities.
- If the HUSKYLENS image cannot be fetched, the AI receives detection data only.
- If HUSKYLENS is not connected, the app must reject the question instead of making a camera-grounded answer.

## AI Context Sources

The AI receives three kinds of context:

1. **Scene context**: current algorithm, detections, bounding boxes, image resources, and the actual HUSKYLENS image when fetchable.
2. **Readable MCP guide**: this file, focused on stable behavior, safety, and current app support.
3. **Raw MCP schema**: the live `tools` array returned by the connected MCP server, including `name`, `description`, and `inputSchema`.

The expected reasoning order is:

1. For ordinary scene questions, answer from the image and detections.
2. For MCP capability questions, consult the readable guide and raw schema.
3. For exact operation or parameter questions, prefer the raw schema.
4. For execution claims, only say an action was done if the backend route actually performed the MCP call.

## MCP Tools Exposed By The Connected Device

### `manage_applications`

Purpose: manage HUSKYLENS applications and algorithms.

Operations:

- `application_list`: list available applications.
- `current_application`: return the current active application or algorithm.
- `switch_application`: switch to another application. Requires `algorithm`, the English application name returned by `application_list`.

Competition use:

- Show available algorithms.
- Let students switch modes deliberately.
- Confirm before switching because it changes device state.

### `get_recognition_result`

Purpose: obtain current recognition result and image resource.

Required arguments:

- `operation: "get_result"`
- `algorithm`: active algorithm ID

Returns:

- recognized labels or learned names
- object IDs
- bounding boxes when available
- image resource link when available

Competition use:

- Main source for scene understanding.
- Should be refreshed before each camera-grounded AI answer.

### `draw_control`

Purpose: draw on the HUSKYLENS screen.

Operations:

- `draw_text`: draw text. Requires `text`, `color`, `x`, `y`, `font_size`.
- `draw_rect`: draw rectangle. Requires `color`, `x`, `y`, `width`, `height`, `line_width`.
- `draw_unique_rect`: draw a unique rectangle. Requires `color`, `x`, `y`, `width`, `height`, `line_width`.
- `clear_text`: clear drawn text.
- `clear_rect`: clear drawn rectangles.

Constraints:

- `font_size` supports only `20`, `24`, `26`, `27`, `28`, `32`, `36`, `40`, `48`.
- `color` uses hex strings such as `#00FF00`, `#FF0000`, or `#FF00FF80`.

Competition use:

- Display short guidance on the device screen.
- Highlight a target region.
- Show success/failure feedback.

Current app status:

- The MCP tool exists, but chat-triggered execution is not implemented yet.

### `learn_control`

Purpose: learn, forget, or name objects.

Operations:

- `learn`: learn the current object or target. Requires `algorithm`.
- `learn_block`: learn a specified region. Requires `algorithm`, `x`, `y`, `width`, `height`.
- `forget`: forget learned objects for the algorithm. Requires `algorithm`.
- `set_name_by_id`: assign a name. Requires `algorithm`, `id`, `name`.

Competition use:

- Let students teach objects during setup.
- Name learned IDs with human-readable labels.

Current app status:

- Not yet exposed as UI controls.
- Should require confirmation because it changes learned data.

### `knowledges_control`

Purpose: save and load knowledge sets.

Operations:

- `save_knowledges`
- `load_knowledges`

Required arguments:

- `algorithm`
- `knowledges_id`

Competition use:

- Load prepared competition knowledge.
- Save trained knowledge after setup.

Current app status:

- Not yet exposed as UI controls.
- Should require confirmation.

### `algorithm_params_control`

Purpose: read or set parameters for an algorithm.

Operations:

- `get_algorithm_params`: requires `algorithm`.
- `set_algorithm_params`: requires `algorithm` and `params`.

`params` must be a JSON string matching the parameter names and value types returned by `get_algorithm_params`.

Competition use:

- Inspect detection threshold or display settings.
- Tune sensitivity only with clear presets.

Current app status:

- Not yet exposed as UI controls.
- Parameter changes should be treated as advanced and confirmed.

### `device_control`

Purpose: control device-level settings.

Operations:

- `get_backlight`, `set_backlight`
- `get_system_volume`, `set_system_volume`
- `get_flashlight`, `set_flashlight`

Ranges:

- `backlight`: `0-100`
- `volume`: `0-100`, step of `10`
- `flashlight`: `0-100`

Competition use:

- Adjust visibility and lighting.
- Keep presets simple to avoid confusing students.

### `multimedia_control`

Purpose: control camera and audio media.

Operations:

- `take_photo`: requires `resolution`; allowed values include `1920x1080`, `1280x720`, `640x480`.
- `take_screenshot`
- `play_music`: requires `filename`, `volume`.
- `start_recording_audio`: requires `duration`, `filename`.
- `stop_recording_audio`

Competition use:

- Capture proof images.
- Trigger simple audio feedback if files exist on the device.

Current app status:

- Photo capture helper exists in backend, but the main AI answer path uses the recognition result image.

### `multi_algorithm_control`

Purpose: configure multiple algorithms.

Operations:

- `set_multi_algorithm`: requires `algorithms`.
- `set_multi_ratios`: requires `ratios`.

Competition use:

- Advanced multi-mode workflows.
- Not recommended as a first competition UI feature unless thoroughly tested.

### `task_scheduler`

Purpose: create or list scheduled tasks.

Operations:

- `create_task`: requires `tasks`, a JSON string array.
- `list_task`

Task fields:

- `trigger`: exact trigger name recognized by the system.
- `handler`: one of `take_photo`, `start_recording_audio`, `stop_recording_audio`.
- `duration`: optional.
- `timestamp`: optional UTC time or `now`.
- `filename`: optional depending on handler.

Competition use:

- "Take a picture when you see the keyboard."
- "Take a picture after 3 seconds."

Current app status:

- Not yet exposed as UI controls.
- Should be considered advanced because trigger names are exact and device-specific.

## Recommended Build Order

1. Stable scene reading and AI answer quality.
2. Algorithm list and explicit algorithm switching.
3. Draw text, draw rectangle, clear overlays.
4. Learn object, set name by ID, save/load knowledge.
5. Device settings presets.
6. Scheduled tasks.

## AI Assistant Behavior

When the user asks about MCP capabilities:

- Explain what is possible with the connected MCP tools.
- Separate "supported by HUSKYLENS MCP" from "already wired into this web app".
- Do not invent tool names, parameters, or completed actions.
- If a requested action is not implemented in the backend route, say that execution support must be added first.
- Do not refuse broad or informal questions only because they do not match an MCP tool.
- If the requested action is not implemented, explain the nearest supported tool and what backend action layer is needed.

When the user asks about the current scene:

- Use detection data and image input together.
- Mention uncertainty when detections and image do not clearly agree.
- Keep the response concise and useful for students.
- Do not turn every scene question into an MCP schema explanation.
