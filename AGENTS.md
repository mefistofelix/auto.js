# auto.js

## Purpose

`auto.js` is a minimal desktop-automation library. The current implementation target is **Deno on Windows x64 only**.

The project deliberately keeps the automation core in **JavaScript + Deno FFI directly against Windows system DLLs and COM/WinRT vtables**. Sharp (`npm:sharp`) is the single approved external/native dependency and is used only for image encode/decode. Do not introduce C, C++, Rust, another native addon, a project-owned DLL, generated bindings, additional npm dependencies, or a build step unless the project direction is explicitly changed.

## Repository shape

Keep the library itself in one file:

- `auto.js` — complete library implementation.
- `examples/` — executable end-to-end examples/tests.
- `AGENTS.md` — project rules and architectural notes.
- `DEV_PREF.md` — repository engineering preferences; apply it as written.
- `AAF_SPEC.md` — authoritative user-facing, language-agnostic Automation Action Format (AAF) specification.

Keep `AAF_SPEC.md` visually scannable. The document title and every numbered macro-section use H1; major units inside a macro-section use H2. In the Action Reference, each action is its own H2 with a one-line *italic* purpose statement followed by **Action input** and **Action output** blocks. Explain every action field briefly; for shared structures such as `window`, `a11y`, `display`, `pos`, `rect`, time values, references, or resources, link to the canonical section instead of duplicating their full grammar. Use **bold** for functional labels/constraints and *italic* for concise descriptive prose. Keep generous structural whitespace: macro-sections get clear source spacing, and action H2 blocks use a small rendered spacer when ordinary Markdown blank lines would collapse visually. Keep the micro glossary near the introduction short and limited to recurring vocabulary. Split conceptual terms from fields/references: conceptual terms use normal prose styling, while literal AAF field/reference names use monospace. Do not add placeholder mini-sections that merely say a concept is documented later: introduce macro concepts only where their full canonical explanation belongs. Order actions by domain and keep related prefixes such as `window_*` together. Within each domain, list the most commonly useful actions and fields first.

Do not split `auto.js` into internal modules merely for organization. Minimal distribution is a project goal.

## API design

Ordinary public automation primitives should be functions whose normal input is **one small JSON-compatible object**. This is intentional: the same primitives must be serializable as JSON/YAML scenarios. Actions whose semantics inherently depend on the per-run scenario context, currently `state`, resource-producing `screenshot`, and resource-consuming `screenshot_save`, may exist only inside `run()`.

Example scenario shape:

```yaml
- window_control:
    window: { title: "pdfa" }
    action: restore

- window_control:
    window: { title: "pdfa" }
    action: move
    pos: { x: "+10%", y: "+20" }

- screenshot:
    save: "pdfa-gui.png"
    window: { title: "pdfa" }
    rect: { x: "10%", y: "10%", width: "80%", height: "80%" }

- window_control:
    window: { title: "pdfa" }
    action: close
```

`run([...])` accepts the equivalent JavaScript/JSON action array, executes it sequentially, and returns `{results, state}`: ordered per-action results plus the final scenario state.

Automation primitives are deliberately **stateless** and always resolve their own filters/targets from scratch. `run()` may carry only the explicit, per-execution scenario context defined by AAF: `prev` (resolved input of the most recent non-`state` action), `ret` (its return value), and `state` (explicit temporary scenario data). `curr` is not persistent context: it is the already-resolved current input exposed only while consuming a time expression. Do not add current-window state, hidden aliases, cached selectors/HWNDs, implicit variables, persistence across runs, or optimization state. `run()` remains best-effort, but scenario failures are data rather than thrown exceptions: malformed/unknown actions, unresolved references, invalid state paths/patches, unavailable resources, null action results, and runtime exceptions return a concise JSON-compatible `{error, ...details}` result and execution continues. Non-`state` diagnostics become the new `ret`; when input resolution succeeded that input becomes `prev`. A failed `state` step leaves `state`, `prev`, and `ret` unchanged.

Prefer micro-actions that compose cleanly instead of large opaque helpers. Examples: move mouse, button down, move mouse, button up; key down, wait, key up; type text; clipboard write; screenshot; OCR; window control. Time values use one deliberately tiny grammar everywhere: numeric terms are milliseconds, units may be `ms`, `s`, or `m`, `rand(expr)` randomizes a bound, `$.curr.foo.len` may inspect already-resolved current action data, multiplication is the only arithmetic, and `user()` requests contextual human-like timing. Never grow this into a general expression language or use `eval`. Conditional `wait` uses one top-level `interval` as the polling cadence for `window`, `ocr`, `image`, and `change`.

## Current public primitives

- `window_find({window?, limit?})`
- `window_control({window?, display?, action, pos?, rect?})`
- `window_get({window?, text?})`
- `window_set({window?, title?, frame?, topmost?, opacity?, enabled?, highlight?})`
- `window_hit({pos?, display?, child?})`
- `a11y_find({a11y?, limit?})`
- `a11y_action({a11y?, action, value?})`
- `keyb({press?, down?, up?, type?, repeat?, interval?, duration?})`
- `input_sel({select? | write? | read?, window?})`
- `mouse_move({pos?, display?, duration?, path?, steps?, window?})`
- `mouse_button({click?, down?, up?, wheel?, hwheel?, window?, display?, pos?, repeat?, interval?})`
- `input_reset()`
- `clipboard({read? | write? | clear?})`
- `ocr({window?, display?, rect?, all?, image?})`
- `wait(time | {timeout?, interval?, not?, window?, ocr?, image?, change?})`
- `window_wait({window?, timeout?, interval?})`
- `display_find({display?})`
- `system({wake? | awake?})` (`system({})` queries lock state)
- `run(actions)`
- scenario-only `state` action for explicit `$.state` mutation
- scenario-only `screenshot` action for capture, run-scoped image resources, and optional `save`
- scenario-only `screenshot_save` action for saving a retained image resource to disk

Keep names and argument objects straightforward. Avoid wrapper classes unless there is a concrete reason.

## Scenario context

Every value in every serialized action may reference `$.prev`, `$.ret`, or `$.state` with the small AAF path grammar: dot-properties plus zero-based `[index]`. A string beginning with one of those paths is a whole-value reference and preserves the referenced value's type. `<<$.state.x>>` / `<<$.ret[0].x>>` placeholders interpolate references inside larger strings; object/array placeholders use compact JSON text. `<<$.state.x|re>>` regex-escapes the inserted text for literal use inside regex-valued filters. `$.curr` is reserved for the small time-expression grammar after the current action input has been resolved; do not make ordinary action values self-reference it. Missing paths do not execute the action with a substituted `null`; that step's `run().results` entry becomes `{error: "unresolved reference", path: "$.…"}`, preventing selectors from being accidentally broadened.

Only the scenario-only `state` action may mutate state. `state` changes neither `prev` nor `ret`; therefore consecutive `state` actions all see the same previous non-state input and return value until another normal action runs. State patches support both nested objects and dotted keys, with automatic creation/replacement of intermediate object paths. An `&` prefix on a path (`&history`, `&app.events`) pushes the resolved value as one item onto an autovivified array; an existing non-array leaf makes the patch fail atomically. The reserved top-level key `-` contains an array of state paths to delete; its path values are resolved against the same pre-patch context, and deleting a missing path is a no-op. Apply normal assignments/pushes first and deletions second, so deletion wins on conflicts. Resolve the whole patch against the pre-patch context first, then apply it atomically. Return the complete resulting state for the `state` step.

Example:

```yaml
- window_find:
    window: { bin: "notepad\\.exe$" }
- state:
    "notepad.wid": "$.ret[0].wid"
    "&history": "$.ret[0]"
    temporary:
      pid: "$.ret[0].pid"
- state:
    "-": [temporary.pid]
- window_control:
    window: { wid: "$.state.notepad.wid" }
    action: focus
```

The mutable state context exists only inside that one `run()` invocation and must never be persisted or cached globally. `run()` returns a final copy under its `state` field; ordinary values are copied out and retained image handles are materialized there into caller-owned image resources.

`run()` owns temporary resource handles for non-JSON payloads such as screenshots. Handles are opaque strings. A newly created resource is ephemeral through `ret`; storing its handle anywhere in `state` retains it. Once retained, the resource is owned by state and is released when its last state reference is deleted or overwritten, even if stale copies of the handle remain in `prev`, `ret`, or historical results. Multiple state references may point to the same resource. At return, materialize only resources still referenced by the final state; clear the internal resource map afterward. Never persist an opaque resource handle across runs.

## Windows and filters

Keep one common window filter vocabulary. Whenever a command selects a window, these filters live under its `window` property rather than beside the command's own arguments:

- `wid` — exact window ID.
- `wpid` — exact immediate parent `wid`, including `null` for top-level.
- `woid` — exact owner `wid`, including `null`; owner is parallel to and never part of the parent tree.
- `depth` — exact parent-tree depth (`0` top-level), or `all` to traverse all depths without constraining it.
- `zorder` — zero-based native Z-order within the same sibling level; `0` is frontmost.
- `pid` — exact process ID.
- `title` — case-insensitive regex.
- `bin` — case-insensitive regex against the full executable path.
- `class` — case-insensitive regex.
- `display` — display index.
- `status` — one of `normal`, `minimized`, `maximized`.
- `hidden` — boolean visibility state, separate from `status`.
- `foreground` — boolean.
- `up` / `down` — relation filters. Unwrapped relations traverse the HWND parent tree; local `depth` is traversal distance, default `1`, or `all`. A wrapped `a11y: {...}` switches that relation to the accessibility tree; on Windows this is the UI Automation Control View.

All fields inside `window` are optional and ANDed. `wid`, `wpid`, `woid`, `depth`, `zorder`, `pid`, `title`, `bin`, `class`, `display`, and `status` also accept arrays; alternatives inside one field are ORed while different fields remain ANDed. Empty arrays match nothing. Boolean filters remain scalar. `window_find({})` returns only true depth-0 top-level windows. Tree traversal is opt-in through `wid`, `wpid`, `depth`, `up`, or `down`; `woid` remains an independent owner filter. Regex covers title/class/bin cases such as `pdfa`, `^pdfa$`, `notepad\\.exe$`.

Window IDs are serialized under `wid`, `wpid`, and `woid` as pointer strings such as `"0x123456"`, never JavaScript `BigInt`, so they remain JSON-compatible.

Public window results stay compact:

```yaml
wid: "0x123456"
wpid: null
woid: null
depth: 0
zorder: 0
title: "Notepad"
class: "Notepad"
pid: 1234
bin: "C:\\Program Files\\WindowsApps\\...\\Notepad.exe"
display: 0
rect: { x: 300, y: 200, width: 900, height: 700 }
client: { x: 308, y: 231, width: 884, height: 661 }
status: normal
hidden: false
foreground: true
```

`client` is output-only and is the native client/content rectangle in screen coordinates, equivalent to the `WC` geometry reference. Do not add it as a filter or duplicate WC geometry semantics.

`bin` is the full executable path resolved from the HWND's PID with `OpenProcess` + `QueryFullProcessImageNameW`. The basename is not exposed separately; use a suffix regex such as `notepad\\.exe$` when only the executable name matters.

`window_control({window: {...}, action: "focus"})` attempts foreground acquisition and returns the resulting current state. Public automation commands are best-effort: an unavailable target or unusable operation should be skipped/no-op rather than aborting the scenario. Safety-sensitive tests may still verify `foreground` before injecting keyboard input.

`window_get({window: {...}, text: true})` is the explicit live native-text path. Keep normal window records cheap and retain `title` as the ordinary enumeration field. On Windows, `text: true` uses bounded `WM_GETTEXTLENGTH` / `WM_GETTEXT` through `SendMessageTimeoutW`, which can retrieve cross-process standard control contents such as Edit, Static, and Button text where `GetWindowTextW` deliberately cannot. Return `text: null` when the message cannot be completed safely. Text selection is a separate input helper and must not grow back into `window_get`.

`window_control({window: {...}, action: "move" | "size", pos?, rect?})` changes window geometry directly with one Win32 `SetWindowPos` call, without synthesizing mouse input, changing Z-order, or activating it. `move` and `size` are exact aliases and use the same implementation. `pos` controls the resulting top-left position and `rect` controls its rectangle/size; both may be supplied together. `rect` is resolved first, then any axes present in `pos` move the resulting rectangle without changing its resolved size. There is no separate `resize` action.

`window_set()` is the compact best-effort mutation/debug primitive for simple HWND properties. Current fields are `title`, `frame: none|border|caption|resizable`, `topmost`, `opacity: 0..1`, `enabled`, and optional `highlight` (`true` or an AAF duration). `highlight` draws a temporary outline around that resolved window after applying the other fields; there is no standalone highlight action. Implement title with bounded `WM_SETTEXT`, frame via per-window style bits plus `SWP_FRAMECHANGED`, topmost via `SetWindowPos`, opacity via `WS_EX_LAYERED` + `SetLayeredWindowAttributes`, and enabled via `EnableWindow`. Do not expose text selection here: `input_sel` belongs to the input domain. Do not expose a fake class-name setter: an existing HWND's registered class name is not locally renameable, while class-wide WndProc/style mutations affect shared class behavior and are unsafe for arbitrary foreign processes.

## Accessibility domain

`a11y` is the platform-neutral accessibility target domain. Keep it separate from `window`; never flatten accessibility metadata into native-window filters and never invent one mixed tree. Same-domain `up` / `down` relations traverse the accessibility tree; cross-domain relations use explicit `window:` / `a11y:` wrappers.

Public `a11y` filters are compact. `uid`, `wid`, `pid`, `aid`, `name`, `type`, `class`, `framework`, and `value` accept scalar or array values with OR semantics inside one field; different fields remain ANDed. Boolean filters stay scalar.

- `uid` — exact opaque current accessibility identity.
- `wid` — native window ID when the backend exposes one, including `null` for accessibility-only elements.
- `aid`, `name`, `class`, `framework`, `value` — case-insensitive regex.
- `type` — normalized lowercase/kebab-case control/role type.
- `pid` — exact process ID.
- `enabled`, `focus`, `focusable`, `offscreen` — booleans when available.
- `up` / `down` — accessibility-tree relation filters; local `depth` defaults to `1` or accepts `all`.

```yaml
window:
  down:
    depth: all
    a11y: { type: document }

a11y:
  up:
    depth: all
    window: { bin: "notepad\\.exe$" }
```

On the current Windows backend, `a11y` is implemented with Windows UI Automation Control View. `window -> a11y` converts the starting HWND with `ElementFromHandle`; `a11y -> window` traverses UIA and tests nodes exposing a real NativeWindowHandle. Internal helpers may keep `uia*` names because they are Windows-backend implementation details, but the public AAF vocabulary must remain `a11y` / `a11y_find`.

`a11y_find({a11y: {...}})` always returns accessibility records even when a relation references `window`; `window_find()` always returns window records even when a relation references `a11y`. Results are JSON-compatible and include `{uid, wid, aid, name, type, class, framework, pid, rect, value, enabled, focus, focusable, offscreen, actions}`. `wid` may be `null`; accessibility `offscreen` remains independent from `window.hidden`.

`actions` is output-only and lists the native operations currently advertised by the element. `a11y_action({a11y, action, value?})` resolves one target from scratch and supports `invoke|select|toggle|expand|collapse|focus|set|scroll`; `set` requires `value`, and `scroll` means scroll-into-view. Use native accessibility patterns, never synthesize mouse/keyboard input as a substitute for these actions.

Implementation stays dependency-free: instantiate `CUIAutomation` through COM, use `ElementFromHandle` and the Control View `IUIAutomationTreeWalker`, read current element properties directly from `IUIAutomationElement`, and use RuntimeId only as an opaque current identity. Caching COM automation/walker interfaces is infrastructure only; never cache selectors, resolved elements, RuntimeIds, or scenario state across actions.

AAF itself is platform-agnostic even though `auto.js` currently implements Windows x64 only. Future backends should map `window` to their native window system and `a11y` to the platform accessibility tree (for example AX on macOS or AT-SPI on Linux). Backend-specific fields such as owner IDs, direct-target mouse injection, native class names, frame/topmost/opacity mutations, or rich native parent trees are optional capabilities: never emulate an unavailable capability with misleading semantics.

## Displays and coordinates

Public display identity is only the integer `index`. Internal monitor handles, device names, and virtual-desktop origins are implementation details.

`display_find()` returns only conceptually useful data. A display target is represented as an object such as `display: { index: 0 }`; `display_find({display: {index: 0}})` narrows the result to that display:

```yaml
- index: 0
  primary: true
  scale: 1.25
  width: 1920
  height: 1200
  work: { width: 1920, height: 1140 }
```

Display index `0` is the primary display after sorting. `scale` is the native desktop scale factor as a ratio (`1`, `1.25`, `1.5`, ...), not a percentage.

Geometry rules:

- Every point lives under `pos: {at?, x?, y?}`. `at` is one of `top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right` and defaults to `top-left`. It selects the anchor used by that position. The optional reference suffixes `W`, `WC`, and `D` may also be appended to anchors, for example `centerW`, `centerWC`, or `bottom-rightD`.
- Every area lives under `rect: {at?, x?, y?, width?, height?, left?, top?, right?, bottom?}`. `rect.at` uses the same anchors and is the resize/placement pivot. When only `width`/`height` change, that anchor stays fixed. `x`/`y` position that anchor. Explicit `left`/`top`/`right`/`bottom` edges directly constrain their axis and take precedence over the pivot behavior on that axis. Anchor suffixes select the pivot reference rectangle in exactly the same way as `pos.at`.
- `display` is a target object just like `window`, normally `display: { index: 0 }`.
- The geometry reference rectangles are `W` = full outer window rectangle, `WC` = window client area converted to screen coordinates, and `D` = display rectangle. `window` remains one target type; client-area selection is purely geometric and is not exposed as a second kind of window target.
- Numeric position/edge values are absolute pixels. Without an explicit `display` they are virtual-desktop coordinates; with an explicit display they are relative to that display's top-left. Numeric `width`/`height` values are pixel sizes.
- Unsigned pixel strings may carry an explicit reference suffix: `"20W"`, `"20WC"`, `"20D"`. On positions and edges they mean that many pixels from the selected reference rectangle's top/left origin. On `width`/`height` they remain pixel sizes.
- Signed numeric strings such as `"+100"` or `"-50"` are relative offsets from the current anchor/geometry. They deliberately do not take `W`/`WC`/`D` suffixes; use `at` to choose the relative anchor instead.
- Percentage strings use the same absolute/relative distinction: `"50%"` is absolute within a reference rectangle, while `"+10%"` / `"-10%"` are offsets by that percentage of the reference width or height.
- The reference defaults to the selected window (`W`) when a `window` target exists, otherwise to the display (`D`). `W`, `WC`, and `D` suffixes override it explicitly: `"50%W"`, `"50%WC"`, `"25%D"`, `"+10%WC"`, `"-5%D"`. If no explicit display target is supplied, `D` means the target window's display when available, otherwise the primary display.
- On `width`/`height`, an unsigned percentage means that fraction of the reference dimension; a signed percentage changes the current dimension by that fraction.
- `mouse_move()` uses `pos.at`; there is no command-level `at`. For example `pos: {at: "centerWC", x: "+20", y: "-10"}` means the center of the target window's client area plus that offset, while `centerD` explicitly means the display center. Clicking remains a separate `mouse_button()` action.
- AAF `screenshot` with no source captures display `0`; `all: true` captures the full virtual desktop. A `rect` combined with `window` is resolved against that window by default; a `rect` without `window` is resolved against the display by default.

## Wait conditions

AAF `wait` is polling-based and stateless between actions. A scalar wait is a fixed delay. A conditional wait accepts exactly one of `window`, `ocr`, `image`, or `change`, plus `timeout`, one common polling `interval`, and optional `not` inversion. Defaults are `timeout: 10s`, `interval: 100ms`.

Positive waits return the concrete condition result directly: the matched window, `{text, rect}` OCR result, image match `{path, rect, similarity}`, or change report `{rect, changed, percent, bounds}`. Timeout returns `null`; a satisfied `not: true` wait returns `true`. Do not introduce condition-result wrappers.

`window` reuses the common window filters. `ocr` adds a case-insensitive regex `text` to the normal OCR capture source. `image` loads one WebP or PNG template once for that wait call through Sharp, then searches it in the requested screenshot geometry on every poll; `similarity` defaults to `0.98`. `change` captures the first available source image as the local baseline and compares every later poll against that initial baseline; absent `percent`, one changed RGB pixel is enough. Keep template/baseline state local to the individual wait call: never cache it across actions.

Image matching always converts the decoded template back to the internal BGRA8 representation. Matching compares screen RGB and returns the first match at or above the requested similarity.

## Screenshots

AAF `screenshot` always captures a new run-scoped image resource and returns `{image, rect, grayscale, path?, bytes?, format?}`. `image` is an opaque resource handle owned by the current `run()`. Optional `save` writes that new capture to disk immediately. Sharp encodes `webp | png`; WebP is the default, while an omitted `format` follows a recognized `.webp` or `.png` output extension. `screenshot_save` never captures: it accepts a retained image handle plus `save` and writes that existing state-owned resource to disk.

The internal capture helper returns raw top-down **BGRA8** because it maps directly to Win32 GDI and Windows `SoftwareBitmap` for OCR. Run-scoped images stay raw in memory so OCR, matching, and change detection never pay an encode/decode round trip during the scenario. `wait.ocr` does not retain prior poll captures, so compressing each sample saves no accumulating resource memory; a local 1920×1200 benchmark measured raw capture+OCR at about 112 ms versus about 151 ms for capture→PNG→decode→OCR. Only opaque handles cross scenario steps and per-action results. At the `run()` API boundary, final-state image handles are normally encoded once as lossless PNG and replaced by `{format:"png", rect, grayscale, data: Uint8Array}`; duplicate state references must share that same object. Compaction is best-effort: if PNG encoding fails, return the equivalent raw BGRA8 resource rather than failing the whole run. Direct `ocr({image})` must accept either returned form and decode encoded images back to BGRA8 on demand. Do not use WebP lossless for final-state compaction by default unless profiling changes: current desktop measurements show much slower encoding than PNG for only modest additional savings.

Sharp is used only at the image-codec boundary: raw BGRA8 is converted to RGBA for disk/final-state encoding, and encoded files or caller-returned image resources are decoded back to BGRA8 when needed. Default disk WebP uses quality 80 to keep images sent to an LLM compact; explicit PNG and final-state PNG remain lossless. `grayscale: true` is optional and non-default.

Full-window capture first uses `PrintWindow(PW_RENDERFULLCONTENT)` and falls back to a screen `BitBlt` if needed. Display captures and explicit `rect` captures use `BitBlt` from the desktop DC. Screenshot/OCR results expose their captured area under `rect`.

## OCR

OCR must remain Windows-native and dependency-free:

1. raw BGRA8 pixels
2. WinRT `Windows.Storage.Streams.Buffer`
3. `Windows.Graphics.Imaging.SoftwareBitmap`
4. `Windows.Media.Ocr.OcrEngine.RecognizeAsync`
5. returned OCR text

COM and WinRT methods are invoked directly from their vtables with `Deno.UnsafeFnPointer`. Async WinRT operations are observed through `IAsyncInfo` and then `GetResults`.

Do not replace this with Tesseract or a subprocess.

## Input

Physical keyboard/mouse injection uses Windows `SendInput`; smooth pointer movement uses interpolated `SetCursorPos` calls so movement duration is explicit and scenario-friendly. Mouse timing and trajectory are separate: `mouse_move({duration:"user()"})` derives only a plausible duration from distance, while `path:"user"` selects a small randomized curved/jittered trajectory that still ends exactly at the resolved destination. `path` is not a time value and never changes duration. `mouse_button` accepts exactly one of `click`, `down`, `up`, `wheel`, or `hwheel`. `click/down/up` use `left|right|middle`; signed `wheel` values are vertical wheel detents (`+` up, `-` down), while signed `hwheel` values are horizontal detents (`+` right, `-` left). `repeat` is a positive integer defaulting to `1` and is valid only with `click`; `interval` is the AAF delay between repeated clicks and is re-resolved for each gap so `rand(...)` / `user()` can vary. Without `window`, input is physical and an explicit `pos` moves the real cursor before the action. With `window`, mouse input is posted directly to that resolved HWND without moving the physical cursor; button coordinates are client-relative internally, wheel coordinates screen-relative, while AAF `pos` remains one unified screen-space geometry model. When direct `window` targeting has no `pos`, use `centerWC`. Return the resolved screen `pos` and include `wid` only for direct-target mode.

Keyboard input is exposed through the single `keyb` command. `press` is key down+up, while `down` and `up` hold/release named keys. `keyb({press: ["ctrl", "z"]})` presses and releases a chord; scalar `press` handles one key. A single printable character supplied to `press`, such as `"@"` or `"€"`, is translated through the foreground thread's active keyboard layout using `VkKeyScanExW`; Ctrl+Alt mappings use right Alt / AltGr semantics. Named keys cover the canonical Windows keyboard set including Backspace/Tab/navigation, Caps/Num/Scroll Lock, Print Screen, left/right modifiers and Windows keys, numpad, F1-F24, Apps/context-menu, and common browser/media/volume/launch keys; numeric VK codes remain accepted. Use `MapVirtualKeyExW(..., MAPVK_VK_TO_VSC_EX)` to detect extended keys instead of maintaining an extended-key list. `repeat` is a positive integer defaulting to `1` and is valid only with `press`; `interval` is re-resolved between repeated presses. `keyb({down: "ctrl"})` holds a key and `keyb({up: "ctrl"})` releases it, so long holds compose naturally as `down` → `wait` → `up`. `keyb({type:"hello", interval:35})` types text with `KEYEVENTF_UNICODE`, independent of keyboard layout, except line breaks: `\n`, `\r`, and `\r\n` become one real `VK_RETURN`. For `type`, explicit `duration` is a total duration spread over character gaps; if both `duration` and `interval` are supplied, `duration` silently wins with no error or warning. `duration:"user()"` or `interval:"user()"` generates independent per-character human-like delays with slightly longer punctuation pauses. Unknown/unusable keys are skipped rather than making the whole command fail. Track explicit holds created by `keyb.down`, physical `mouse_button.down`, and direct-window `mouse_button.down`; direct `input_reset()` releases all currently owned holds and returns `{released}`. `run()` snapshots the pre-existing owned holds and releases only holds added by that run in `finally`; an `input_reset` action inside the scenario uses that same baseline and therefore releases only run-owned holds, preserving anything the caller was already holding before entry.

## Text selection

Expose one `input_sel` primitive with exactly one of `select`, `write`, or `read` plus optional `window`. With `window`, resolve that native text control explicitly; without it, use the focused native text control. `select: true` selects all text, `select: {start,end}` selects an explicit zero-based UTF-16 range, and a string `select` is a case-insensitive regex selecting its first complete match. Select returns `{start,end,text}`. Read returns only the selected text string. Write replaces the current selection or inserts at an empty caret and returns `{length}`. On Windows, standard Edit/RichEdit controls use `EM_GETSEL`, `EM_SETSEL`, bounded live text, and `EM_REPLACESEL`. Keep this in the input domain; it is not a window mutation and is unrelated to accessibility `select`.

## Clipboard

Expose one `clipboard` primitive with exactly one of `{read: true}`, `{write: text}`, or `{clear: true}`. Read returns the current text, write returns `{length}`, and clear returns `true`.

Clipboard text uses `CF_UNICODETEXT` through the native Win32 clipboard APIs. Clipboard memory is allocated with `GlobalAlloc` and copied with `RtlMoveMemory` from `ntdll.dll`.

## System/session state

`system({})` queries the current session lock state. On Windows use `WTSQuerySessionInformationW(..., WTSSessionInfoEx, ...)` and `WTSINFOEX_LEVEL1.SessionFlags`; expose only `locked: true|false|null`, not raw WTS structures. `system({wake: true})` performs a one-shot `ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED` request. `system({awake: true})` sets `ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED`; `system({awake: false})` clears it with `ES_CONTINUOUS`. `wake` and `awake` are mutually exclusive. This is an explicit OS execution-state exception to the usual primitive-statelessness rule: callers that enable continuous awake state must clear it. It never unlocks an authenticated Windows lock screen and cannot resume code from a machine that is already suspended.

## Current end-to-end tests

`examples/suite.js` is the primary self-contained regression suite. It launches a private Win32 fixture process implemented inside the example itself, creates a unique top-level window plus native Edit/Button/Static/nested child controls, and asserts behavior instead of merely exercising calls. It covers system lock detection/wake/awake; displays including scale; native window filters/tree relations/limits, Z-order, output client rect, and cross-process live text; native `input_sel` select-by-range/regex, read, and write; accessibility filters/capabilities/actions/limits and window↔a11y bridges; wait/window_wait; window control/set/highlight/hit; W/WC geometry; physical and direct-target mouse input including repeated clicks, horizontal wheel, separate `user` path / `user()` duration, and run-scoped hold cleanup; clipboard; `keyb` press/chords/type/down/up, repeated presses, active-layout character mapping, `$.curr`/`rand(...)` timing, human typing, duration-over-interval precedence, and input reset scoping; WebP/PNG screenshot save, OCR, WebP template matching, wait OCR/image/change; and `run` references/interpolation/state push/delete, `{results,state}` output, plus final-state image materialization. Temporary files, clipboard contents, cursor position, fixture window/process, awake state, and screenshot resources are cleaned up best-effort. Physical desktop assertions are skipped only when another system surface prevents the fixture from being interactively hit.

Run it before and after implementation simplification:

```text
deno run -A examples/suite.js
```

`examples/notepad.js` remains a second real-application integration test and intentionally exercises a broad slice of the API:

1. enumerate displays and existing Notepad windows;
2. launch Notepad and require a newly observed top-level HWND (never fall back to an existing user Notepad window);
3. identify that new HWND with `bin: "notepad\\.exe$"`;
4. minimize, restore, and focus it;
5. test clipboard read/write;
6. type a distinctive OCR string via keyboard input;
7. save a single-window PNG;
8. save a centered `50%WC` client-area PNG and verify a `20WC,30WC` point hits the same Notepad window;
9. save primary-display and grayscale rect PNGs;
10. OCR the window and assert the typed text is present;
11. move and resize the window simultaneously with one `action: "move"` carrying relative `pos` plus percentage `rect`, then restore the original geometry the same way;
12. anchor the mouse to the window's `top` edge with `pos.at`, then hold the mouse button and drag using cursor-relative moves;
13. verify the window moved and verify `window_hit()` at its new position;
14. undo the test typing back to the original blank state;
15. send the close action and assert the new HWND disappears.

Modern Notepad can share one process between multiple user tabs/windows. Never kill a Notepad process as test cleanup, and never automate a pre-existing Notepad HWND.

Run with permissions sufficient for FFI, process launch, and file output, for example:

```text
deno run -A examples/notepad.js
```

## Development rules

- Keep the implementation small but readable; do not code-golf unrelated logic together.
- No boilerplate frameworks.
- No PowerShell, AutoHotkey, external automation executables, or subprocess helpers inside the library.
- Prefer Windows API capabilities already present in the OS.
- Direct automation primitives remain best-effort and may use null/current-state/no-op results for unavailable targets or unusable inputs. Inside `run()`, never abort the scenario for an ordinary step failure: convert it to a concise `{error, ...details}` result. Do not expose stacks. Preserve the underlying exception text only as a short `message` on `{error: "action failed", action, message}`.
- Keep per-action public data JSON-compatible wherever practical. Final `run().state` is the explicit exception for retained host-native binary resources such as image `Uint8Array` buffers.
- Keep primitives stateless. Re-enumerating/re-resolving is preferred over caches or hidden cross-command state; optimization is not a project goal.
- Examples are real integration tests: they should verify results, not merely call functions.
- When adding an ordinary primitive, make it usable both directly and as a serialized action. Keep run-context-only behavior limited to explicit scenario facilities such as `state` and opaque resources.
