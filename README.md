# AutoJS

AutoJS is a minimal desktop-automation library for **Deno** with native operating-system backends.

The common AAF/scenario core lives in `auto.js`; native operations live in small backend files using Deno FFI directly against the operating system. Windows uses Win32, COM, and WinRT. **Sharp is the only external dependency** and is used only for WebP/PNG image codecs; there is no project-owned native library and no build step.

AutoJS exposes both direct JavaScript functions and **AAF — Automation Action Format**, a small JSON/YAML-friendly action model for serialized desktop automation scenarios.

## Features

- native window discovery, filtering, geometry, control, mutation, and hit testing
- native accessibility discovery/actions through Windows UI Automation or macOS AX
- display discovery and W / WC / D coordinate references
- physical and direct-target mouse input, including independent human-like movement path/timing and owned-input recovery
- keyboard press/down/up/type, repeated presses, active-layout character mapping, and human/random timing
- `input_sel` focused/targeted text selection by range or regex, plus read/write and clipboard read/write/clear
- screenshots with WebP default and PNG support, retained scenario image resources, screenshot reuse, and caller-owned final-state images
- native OCR through Windows WinRT or macOS Vision
- polling waits for windows, OCR, images, and visual changes
- explicit scenario `state`, references, interpolation, push/delete operations, and resource lifetime
- session lock detection plus one-shot wake and scoped no-sleep/display-off requests

## Requirements

- Windows x64 for the complete current regression suite
- macOS for the Darwin backend
- Deno
- network access on first dependency resolution for `npm:sharp`

Run scripts with permissions sufficient for FFI, process creation, desktop input, and file access:

```text
deno run -A examples/suite.js
```

## Direct API

```js
import {
  window_find,
  window_control,
  keyb,
} from "./auto.js";

const win = window_find({
  window: { bin: "notepad\\.exe$" },
  limit: 1,
})[0];

if (win) {
  window_control({ window: { wid: win.wid }, action: "focus" });
  await keyb({ type: "Hello from AutoJS" });
}
```

## AAF scenario

The same primitives can be represented as JSON/YAML-compatible actions and executed with `run()`:

```yaml
- window_find:
    window:
      bin: "notepad\\.exe$"
    limit: 1

- state:
    target: "$.ret[0]"

- window_control:
    window: { wid: "$.state.target.wid" }
    action: focus

- keyb:
    type: "AAF test 42"
    duration: user()

- wait:
    timeout: 5s
    ocr:
      text: "AAF test 42"
      window: { wid: "$.state.target.wid" }
```

`run(actions)` returns `{results, state}`. `results` contains one value per action; `state` is the final scenario state. Images deliberately retained in that final state are returned to JavaScript as compact lossless PNG resource objects (`{format, rect, grayscale, data}`) instead of dead run-scoped handle strings; direct `ocr({image})` can consume them again.

See [`AAF_SPEC.md`](AAF_SPEC.md) for the complete AAF specification.

## Verification suite

`examples/suite.js` is the primary regression suite. It creates its own private Win32 fixture process and controls that fixture instead of relying on pre-existing desktop state.

It verifies windows, accessibility/actions, relations, limits, geometry, mouse, keyboard, `rand($.curr...)` / `user()` timing, input recovery, clipboard, `input_sel`, WebP/PNG screenshots, OCR, waits, scenario state/resources, system/session helpers, and cross-process window text reads.

```text
deno run -A examples/suite.js
```

`examples/notepad.js` is a second integration example against the real Windows Notepad application.

## Project structure

```text
auto.js               common entry point and AAF runtime
auto_win.js           Windows native backend
auto_darwin.js        macOS native backend
AAF_SPEC.md            authoritative AAF specification
examples/suite.js      self-contained regression suite
examples/notepad.js    real-application integration example
AGENTS.md              implementation and project rules
```

## Design goals

AutoJS intentionally favors a small distribution and direct operating-system APIs over abstraction layers. Primitive actions are stateless; `run()` adds only explicit per-scenario `prev`, `state`, and run-scoped resource lifetime, then returns `{results, state}` and transfers final-state image resources to the caller.

`auto.js` selects the native backend from `Deno.build.os`. The backend boundary stays direct and functional: unsupported operating-system capabilities return no result instead of being emulated with misleading semantics.

The Darwin backend currently maps displays and Quartz windows, AX accessibility/actions and window move/size/focus/minimize/restore/close, physical mouse and keyboard input, text selection, clipboard, screenshots through the legacy Quartz capture API when present, Vision OCR including `wait.ocr`, and power wake/awake assertions. macOS has no fake native-child HWND tree or direct-window mouse posting here; `WC`, native class/owner fields, frame/topmost/opacity mutation, and lock-state detection return unavailable/null semantics rather than approximations.
