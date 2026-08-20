# AutoJS

AutoJS is a minimal desktop-automation library for **Deno** with native
operating-system backends.

The common AAF/scenario core lives in `auto.js`; native operations live in small
backend files using Deno FFI directly against the operating system. Windows uses
Win32, COM, and WinRT. PNG/WebP encode/decode uses libvips directly through its
C ABI and Deno FFI. `npm:sharp` is only a package-graph anchor and source of the
platform libvips binaries; the Sharp native addon is never loaded. Tesseract.js
is an optional lazy OCR provider loaded only when selected or needed by the
Linux fallback; there is no project-owned native library or build step.

AutoJS exposes both direct JavaScript functions and **AAF — Automation Action
Format**, a small JSON/YAML-friendly action model for serialized desktop
automation scenarios. The same `auto.js` file is also executable directly as a
minimal CLI for YAML scenarios.

## Features

- native window discovery, filtering, geometry, control, mutation, and hit
  testing
- native accessibility discovery/actions through Windows UI Automation, macOS
  AX, or Linux AT-SPI
- display discovery and W / WC / D coordinate references
- physical and direct-target mouse input, including independent human-like
  movement path/timing and owned-input recovery
- keyboard press/down/up/type, repeated presses, active-layout character
  mapping, and human/random timing
- `input_sel` focused/targeted text selection by range or regex, plus read/write
  and clipboard read/write/clear
- screenshots with WebP default and PNG support, retained scenario image
  resources, screenshot reuse, and caller-owned final-state images
- native OCR through Windows WinRT or macOS Vision, plus lazy Tesseract.js OCR
  when explicitly selected or used as the Linux fallback
- polling waits for windows, OCR, images, and visual changes
- explicit scenario `state`, references, interpolation, push/delete operations,
  and resource lifetime
- session lock detection plus one-shot wake and scoped no-sleep/display-off
  requests

## Requirements

- Windows x64 for the complete current regression suite
- macOS for the Darwin backend
- Linux with AT-SPI; X11 enables the current global window/input/screenshot
  surface
- Deno
- network access on first resolution of `npm:sharp`; Tesseract OCR also needs
  first-use package/language-data resolution; direct CLI use resolves Deno's
  `@std/yaml` parser on first use

Run scripts with permissions sufficient for FFI, process creation, desktop
input, and file access:

```text
deno run -A examples/suite.js
```

## Compiled CLI

The same entry point compiles directly, without self-extraction or manually
including native libraries:

```text
deno compile -A --output autojs.exe auto.js
```

A dead literal import of `npm:sharp` makes Deno include Sharp's
platform-specific optional dependency graph. At runtime `vips.js` inspects
Sharp's own `runtimePlatformArch()` and optional dependencies, resolves the
matching libvips binary, and opens it directly with `Deno.dlopen`. Sharp's
native addon is never loaded. The same mechanism works in `deno run` and
compiled executables.

The image codec uses fixed-signature GObject/VipsOperation C APIs, like pyvips,
instead of libvips varargs. PNG is lossless; WebP save currently uses libvips
quality 80 and effort 4. All image-library knowledge stays in `vips.js`:
`auto.js` imports its small codec API, while native backends exchange only raw
BGRA8 images and never import an image codec.

This native path was chosen after measuring essentially the same WebP Q80 speed
as Sharp (about 131.8 ms versus 132.6 ms for a local 1920×1200 capture) and
about 93 MB steady RSS after repeated encodes. The constrained WASM libvips
experiment was about 217 MB RSS. Direct FFI therefore keeps native libvips
performance and memory behavior while avoiding Sharp's native-addon loading
problem in normal `deno compile` executables.

Cross-compilation of this CLI is verified for macOS x64/arm64 and Linux glibc
x64/arm64. The full runtime suite and compiled executable are currently
runtime-tested on Windows x64; macOS/Linux backends remain compile-verified
until they are exercised on those operating systems.

## Direct API

From npm, Deno can import AutoJS directly without creating a local
`node_modules` directory:

```js
import { keyb, window_control, window_find } from "npm:@mefistofelix/auto.js";

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

The same primitives can be represented as JSON/YAML-compatible actions and
executed with `run()`:

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

`run(actions)` returns `{results, state}`. `results` contains one value per
action; `state` is the final scenario state. Images deliberately retained in
that final state are returned to JavaScript as compact lossless PNG resource
objects (`{format, rect, grayscale, data}`) instead of dead run-scoped handle
strings; direct `ocr({image})` can consume them again.

The same `auto.js` file can execute a scenario directly from YAML. For example,
open a blank Notepad window and run the included CLI example:

```text
deno run -A auto.js examples/notepad.yaml
```

`examples/notepad.yaml` finds the Notepad window, stores it in scenario state,
focuses it, types text, waits for OCR to observe that text, and saves
`notepad-cli.png`. Use the same form with any other AAF YAML file:

```text
deno run -A auto.js scenario.yaml
```

There are no CLI commands or flags: exactly one YAML file is parsed and passed
to `run()`, whose `{results, state}` value is written as JSON to stdout.
Importing `auto.js` as a library does not enter the CLI path or load the YAML
parser.

See [`AAF_SPEC.md`](AAF_SPEC.md) for the complete AAF specification.

## Verification suite

Images retained in final AAF state remain raw while a scenario is executing, so
OCR and image matching never operate on a compressed intermediate. `run()`
encodes those caller-owned images only at the return boundary, using WebP by
default for compact transport payloads; `screenshot.format: png` requests PNG.
`screenshot.scale` can reduce encoded output while preserving aspect ratio
(`50%` or `0.5`, default `100%`) without changing the full-resolution image seen
by OCR/matching during the run. Returned image `rect` values always stay in
absolute desktop coordinates even when the input crop used window-relative or
special geometry; `scale` maps the encoded pixels back to that source rectangle.

`examples/suite.js` is the primary regression suite. It creates its own private
Win32 fixture process and controls that fixture instead of relying on
pre-existing desktop state.

It verifies windows, accessibility/actions, relations, limits, geometry, mouse,
keyboard, `rand($.curr...)` / `user()` timing, input recovery, clipboard,
`input_sel`, WebP/PNG screenshots, OCR, waits, scenario state/resources,
system/session helpers, and cross-process window text reads.

```text
deno run -A examples/suite.js
```

`examples/notepad.js` is a second integration example against the real Windows
Notepad application.

## Project structure

```text
auto.js               common entry point and AAF runtime
auto_win.js           Windows native backend
auto_darwin.js        macOS native backend
auto_linux.js         Linux native backend
AAF_SPEC.md            authoritative AAF specification
examples/suite.js      self-contained regression suite
examples/notepad.js    real-application JavaScript integration example
examples/notepad.yaml  real-application YAML CLI example
AGENTS.md              implementation and project rules
```

## Design goals

AutoJS intentionally favors a small distribution and direct operating-system
APIs over abstraction layers. Primitive actions are stateless; `run()` adds only
explicit per-scenario `prev`, `state`, and run-scoped resource lifetime, then
returns `{results, state}` and transfers final-state image resources to the
caller.

`auto.js` selects the native backend from `Deno.build.os`. The backend boundary
stays flat and functional: the same public actions are offered everywhere, but
unsupported operating-system capabilities return no result instead of being
emulated with misleading semantics.

### Platform backends

**Windows** is the reference backend and currently the only one covered by the
full integration suite. Win32 + UI Automation + WinRT provide the richest
mapping, including HWND hierarchy/owner/client geometry, direct-target mouse,
full `window_set_prop`, native OCR, all conditional waits, lock state, wake, and
continuous awake.

**macOS** uses Quartz for windows/displays, AX for accessibility and
cross-application window operations, CoreGraphics for physical input, AppKit
pasteboard for clipboard, Vision for OCR, and IOKit for wake/awake. It does not
fake capabilities without a public equivalent: there is no native child-window
HWND tree, direct-target mouse posting, reliable foreign-window `WC`, generic
frame/topmost/opacity/enabled mutation, lock-state query, or current `maximize`
implementation. Conditional waits currently cover windows and OCR. Screenshot
uses the legacy Quartz capture symbol when available; if Apple removes it, only
capture becomes unavailable rather than the whole backend failing to load.

**Linux** stays one backend because AT-SPI is common to X11 and Wayland. Under
X11, Xlib/EWMH/XRandR/XTest provide windows, displays, geometry, window control,
physical input and XGetImage screenshots. Clipboard, continuous awake and
conditional waits beyond windows are not yet mapped. Under Wayland, AutoJS keeps
AT-SPI but deliberately does not treat XWayland's `DISPLAY` as permission to
control the whole desktop; global window enumeration/control, capture and input
injection remain unavailable until implemented through compositor-authorized
mechanisms.

OCR provider selection is common policy in `auto.js`: `native` delegates to the
OS backend, `tesseract` lazily imports `npm:tesseract.js`, and `default` falls
back to Tesseract automatically on Linux because Linux has no universal native
OCR service comparable to WinRT or Vision. Tesseract needs no manifest,
`node_modules`, npm install or subprocess, and stores its language cache outside
the project directory.

See the **Portability and backend capabilities** section of `AAF_SPEC.md` for
the exact capability matrix and current verification status.
