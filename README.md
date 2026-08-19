# AutoJS

AutoJS is a minimal desktop-automation library for **Deno on Windows x64**.

It is implemented as a single JavaScript file using Deno FFI directly against Win32, COM, and WinRT. There are no npm dependencies, no native addon, no project-owned DLL, and no build step.

AutoJS exposes both direct JavaScript functions and **AAF — Automation Action Format**, a small JSON/YAML-friendly action model for serialized desktop automation scenarios.

## Features

- native window discovery, filtering, tree relations, geometry, control, mutation, hit testing, and text reads
- Windows UI Automation accessibility discovery and window/accessibility cross-relations
- display discovery and W / WC / D coordinate references
- physical and direct-target mouse input
- keyboard press/down/up/type, repeated presses, and active-layout character mapping
- clipboard read/write/clear
- screenshots, PNG encoding, retained scenario image resources, and screenshot reuse
- Windows-native OCR through WinRT
- polling waits for windows, OCR, images, and visual changes
- explicit scenario `state`, references, interpolation, push/delete operations, and resource lifetime
- session lock detection plus one-shot wake and scoped no-sleep/display-off requests

## Requirements

- Windows x64
- Deno

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
    target: "$.prev[0]"

- window_control:
    window: { wid: "$.state.target.wid" }
    action: focus

- keyb:
    type: "AAF test 42"

- wait:
    timeout: 5s
    ocr:
      text: "AAF test 42"
      window: { wid: "$.state.target.wid" }
```

See [`SPEC.md`](SPEC.md) for the complete AAF specification.

## Verification suite

`examples/suite.js` is the primary regression suite. It creates its own private Win32 fixture process and controls that fixture instead of relying on pre-existing desktop state.

It verifies windows, accessibility, relations, limits, geometry, mouse, keyboard, clipboard, screenshots, OCR, waits, scenario state/resources, system/session helpers, and cross-process window text reads.

```text
deno run -A examples/suite.js
```

`examples/notepad.js` is a second integration example against the real Windows Notepad application.

## Project structure

```text
auto.js               complete library implementation
SPEC.md                authoritative AAF specification
AAF_SPEC.md            publish-friendly copy of the AAF specification
examples/suite.js      self-contained regression suite
examples/notepad.js    real-application integration example
AGENTS.md              implementation and project rules
```

## Design goals

AutoJS intentionally favors a small distribution and direct operating-system APIs over abstraction layers. Primitive actions are stateless; `run()` adds only explicit per-scenario `prev`, `state`, and run-scoped resource lifetime.

The current backend is Windows x64. AAF itself is designed so additional platform backends can map the same high-level domains to their native window and accessibility systems.
