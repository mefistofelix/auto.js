# Automation Action Format (AAF)

AAF is a small declarative format for desktop automation. A scenario is an ordered array of actions that can be represented as YAML, JSON, or any equivalent object/array structure.

**Micro glossary**

**Concepts**

| Term | Meaning |
| --- | --- |
| Action | One scenario step containing exactly one command. |
| Target | A selector/filter resolved by an action. |
| Image handle | Opaque run-scoped reference to a captured image resource. |

**Fields and references**

| Name | Meaning |
| --- | --- |
| `window` | Native-window target/filter. |
| `a11y` | Accessibility-element target/filter. |
| `wid` / `uid` | Opaque current identity for a window / accessibility element. |
| `pos` / `rect` | Point / rectangle geometry. |
| `$.curr` | Resolved input of the current action inside the small time-expression syntax. |
| `$.prev` | Resolved input of the most recent non-`state` action. |
| `$.ret` | Return value of the most recent non-`state` action. |
| `$.state` | Explicit temporary state owned by the current run. |


# 1. Quick start: automate Notepad

This scenario finds a Notepad window, remembers it, focuses it, types text, captures its client area, keeps the image in scenario state, saves it to disk, and waits until OCR can see the typed text.

```yaml
- window_find:
    window:
      bin: "notepad\\.exe$"   # regex, case-insensitive
      status: normal

- state:
    target: "$.ret[0]"        # stores the whole typed window record

- window_control:
    window:
      wid: "$.state.target.wid" # exact native window ID
    action: focus

- keyb:
    type: "AAF test 42"

- screenshot:
    window:
      wid: "$.state.target.wid"
    rect:
      at: centerWC              # WC = window client/content area
      width: "80%WC"
      height: "80%WC"

- state:
    shot: "$.ret.image"       # retaining the handle keeps the image alive

- screenshot_save:
    image: "$.state.shot"      # reuse the retained resource; no recapture
    save: "notepad.webp"

- wait:
    timeout: 5s
    ocr:
      text: "AAF test 42"
      window:
        wid: "$.state.target.wid"
```

**Step by step**

1. `window_find` returns matching native windows. `$.ret[0]` is the first one.
2. `state` stores that window record under `target` so later actions can reuse its `wid`.
3. `window_control` focuses exactly that window.
4. `keyb` types Unicode text.
5. `screenshot` captures a new image and returns an opaque `image` resource handle plus capture metadata.
6. `state` retains the image resource under `shot`.
7. `screenshot_save` writes that retained image resource to disk without capturing again.
8. `wait.ocr` polls until the expected text is visible or the timeout expires.

<br>

**Typical per-action `results`** are deliberately plain and reusable:

```yaml
- - wid: "0x730632"
    wpid: null
    woid: null
    depth: 0
    zorder: 0
    title: "Untitled - Notepad"
    class: "Notepad"
    pid: 10308
    bin: "C:\\...\\Notepad.exe"
    display: 0
    rect: { x: 200, y: 120, width: 1200, height: 700 }
    client: { x: 208, y: 151, width: 1184, height: 661 }
    status: normal
    hidden: false
    foreground: false

- target:
    wid: "0x730632"
    title: "Untitled - Notepad"
    # ...

- wid: "0x730632"
  foreground: true
  # ...

- typed: 11                 # number of characters sent

- image: "8b80b0d6-..."
  rect: { x: 320, y: 220, width: 960, height: 520 }
  grayscale: false

- target:
    # ...
  shot: "8b80b0d6-..."

- image: "8b80b0d6-..."
  path: "notepad.webp"
  bytes: 42871
  format: webp
  rect: { x: 320, y: 220, width: 960, height: 520 }
  grayscale: false

- text: "AAF test 42"
  rect: { x: 200, y: 120, width: 1200, height: 700 }
```

---


# 2. Action reference

Every scenario action is an object with exactly one command key. The reference is ordered by domain rather than by implementation history.

## Command index

**Windows**

- [`window_find`](#window_find) — find native windows.
- [`window_control`](#window_control) — focus, move, resize, minimize, maximize, restore, or close a window.
- [`window_get`](#window_get) — get one native window, optionally including live control text.
- [`window_set`](#window_set) — change supported window properties or briefly highlight the window.
- [`window_hit`](#window_hit) — resolve the native window under a point.

**Accessibility**

- [`a11y_find`](#a11y_find) — find accessibility elements and their supported actions.
- [`a11y_action`](#a11y_action) — invoke a supported accessibility operation on one element.

**Input**

- [`keyb`](#keyb) — press keys or type Unicode text.
- [`input_sel`](#input_sel) — read or replace the current native text selection.
- [`mouse_move`](#mouse_move) — move the physical pointer.
- [`mouse_button`](#mouse_button) — click, hold, release, or scroll.
- [`input_reset`](#input_reset) — release held input owned by AutoJS.
- [`clipboard`](#clipboard) — read, write, or clear clipboard text.

**Images and recognition**

- [`screenshot`](#screenshot) — capture a new run-scoped image resource.
- [`ocr`](#ocr) — recognize text from a capture source or image resource.
- [`screenshot_save`](#screenshot_save) — save an existing retained image resource.

**Synchronization**

- [`wait`](#wait) — delay or poll a condition.

**Display and system**

- [`display_find`](#display_find) — enumerate or select displays.
- [`system`](#system) — inspect lock state, reset idle timers, or keep the system/display awake.

---

<br>

## `window_find`

*Find native windows matching a reusable window filter.*

**Action input**

- `window` — [window filter](#window-filters) selecting the windows to return.
- `limit` — maximum number of results. `0` or omission means no limit; a positive integer stops after that many matches.

```yaml
- window_find:
    window:
      bin: "notepad\\.exe$"
      title: ["^Untitled", "^Document"] # OR within this field
    limit: 1                              # 0 or omitted = no limit
```

**Action output**

An array of window records. A valid search with no matches returns `[]`.

---

<br>

## `window_control`

*Perform an operational action on one native window.*

**Action input**

- `window` — [window filter](#window-filters) selecting the target.
- `action` — one of `restore | minimize | maximize | focus | move | size | close`.
- `pos` — optional [position](#position-and-rectangle) used by `move` / `size`.
- `rect` — optional [rectangle](#position-and-rectangle) used by `move` / `size`.
- `display` — optional [display](#displays) context for geometry resolution.

`move` and `size` are exact aliases: both apply the supplied `pos` and/or `rect` in one geometry update.

```yaml
- window_control:
    window: { wid: "0x123456" }
    action: maximize
```

**Action output**

The current window record after the operation, or `null` when no target can be resolved.

---

<br>

## `window_get`

*Get the first native window matching a filter, with optional live native text retrieval.*

**Action input**

- `window` — [window filter](#window-filters) selecting the target.
- `text` — when `true`, also query the target's live text/content rather than relying only on the normal enumerated `title` field.

```yaml
- window_get:
    window: { class: "^Edit$" }
    text: true
```

**Action output**

One window record or `null`. With `text: true`, the record also contains `text`, which is a string when the native control supports safe text retrieval or `null` otherwise.

On Windows, live text uses bounded `WM_GETTEXT`. Text selection is intentionally a separate [`input_sel`](#input_sel) action rather than a window property.

---

<br>

## `window_set`

*Apply supported best-effort properties to one native window.*

**Action input**

- `window` — [window filter](#window-filters) selecting the target.
- `title` — new caption/title when the backend supports changing it.
- `frame` — `none | border | caption | resizable`.
- `topmost` — boolean topmost state.
- `opacity` — number from `0` to `1`.
- `enabled` — boolean enabled/input state.
- `highlight` — `true` or an AAF [time value](#time-values); draws a temporary outline around this window after applying the other fields. There is no standalone highlight action.

There is no generic `class` setter. Native class/control identity is not generally an instance property that can be truthfully renamed across backends.

```yaml
- window_set:
    window: { wid: "$.state.target.wid" }
    title: "DEBUG - <<$.state.target.title>>"
    frame: resizable
    topmost: true
    opacity: 0.85
    enabled: true
    highlight: 800ms
```

**Action output**

The current window record after applying the requested properties, or `null` when no target can be resolved.

---

<br>

## `window_hit`

*Resolve the native window at a screen position.*

**Action input**

- `pos` — [position](#position-and-rectangle) to test.
- `child` — when `true`, return the deepest native child available at that point; otherwise return the root native window.
- `display` — optional [display](#displays) context used to resolve the position.

```yaml
- window_hit:
    pos: { x: 500, y: 300 }
    child: true
```

**Action output**

A window record, or `null` when no native window exists at the resolved point.

---

<br>

## `a11y_find`

*Find elements in the platform accessibility tree.*

**Action input**

- `a11y` — [accessibility filter](#accessibility-filters) selecting elements.
- `limit` — maximum number of results. `0` or omission means no limit; a positive integer stops traversal after that many matches.

```yaml
- a11y_find:
    a11y:
      type: button
      name: ["^Save$", "^OK$"]
      up:
        depth: all
        window:
          bin: "notepad\\.exe$"
    limit: 10
```

**Action output**

An array of accessibility records. A valid search with no matches returns `[]`. Each record includes output-only `actions`, listing the native accessibility operations currently advertised by that element.

---

<br>

## `a11y_action`

*Apply one native accessibility operation to the first element matching an accessibility filter.*

**Action input**

- `a11y` — [accessibility filter](#accessibility-filters) selecting the target.
- `action` — one of `invoke | select | toggle | expand | collapse | focus | set | scroll`.
- `value` — text value used only by `set`; required for that action. An empty string explicitly clears the value when the native pattern allows it.

`invoke`, `select`, `toggle`, `expand`, `collapse`, `set`, and `scroll` use the platform accessibility control patterns rather than synthesized mouse/keyboard input. `focus` uses the accessibility element's native focus operation. `scroll` means *scroll this element into view*.

```yaml
- a11y_action:
    a11y:
      type: button
      name: "^Save$"
    action: invoke

- a11y_action:
    a11y: { type: edit, aid: "^search$" }
    action: set
    value: "hello"
```

**Action output**

The resulting accessibility record with an additional `action` field, or `null` when the target or requested native pattern is unavailable. Inside `run()`, failures use the normal scenario diagnostic object.

---

<br>

## `keyb`

*Generate physical-style key operations or layout-independent Unicode typing.*

**Action input**

- `type` — Unicode text sent directly, independent of keyboard layout.
- `press` — key down+up; a named key, printable character, numeric virtual-key code, or chord array. Printable characters are mapped through the active keyboard layout.
- `down` — hold one named key or chord.
- `up` — release one named key or chord.
- `duration` — total [time value](#time-values) for `type`. When both `duration` and `interval` are supplied, `duration` silently takes precedence. With `user()`, typing uses independent human-like per-character delays instead of a fixed total.
- `interval` — [time value](#time-values) between characters for `type` or between repeated `press` operations; default `0`.
- `repeat` — positive integer, default `1`; valid only with `press`.

Named keys include letters and digits; Backspace, Tab, Enter, Escape and navigation keys; Caps/Num/Scroll Lock; Print Screen; left/right Shift, Ctrl, Alt and Windows keys; numpad keys; F1–F24; Apps/context-menu; and common browser, volume, media and launch keys. Numeric virtual-key codes remain available for backend-specific cases.

```yaml
- keyb:
    press: [ctrl, a]

- keyb:
    press: "@"       # mapped through the active keyboard layout

- keyb:
    press: backspace
    repeat: 3
    interval: 100ms

- keyb:
    type: "Hello world"
    interval: 30ms

- keyb:
    type: "Hello world"
    duration: user()

- keyb:
    type: "Hello world"
    duration: "rand($.curr.type.len*10)"
```

**Action output**

An object reporting each operation that was applied. Repeated `press` also reports `repeat`; `type` returns `typed` with the number of characters sent.

---

<br>

## `input_sel`

*Read or replace the selected text of a supported native text control.*

**Action input**

- `read: true` — return the currently selected text.
- `write: text` — replace the current selection, or insert at the caret when the selection is empty.
- `window` — optional [window filter](#window-filters) selecting a native text control. When omitted, the focused native text control is used.

Exactly one of `read` or `write` is allowed.

```yaml
- input_sel:
    read: true

- input_sel:
    window: { class: "^Edit$" }
    write: "replacement"
```

On the current Windows backend, standard Edit/RichEdit controls use native selection messages. This is a text-input helper, not a `window` property and not an accessibility `select` operation.

**Action output**

- `read` → selected text string.
- `write` → `{length: N}` with the replacement text length.
- unsupported or unresolved text control → `null` outside the scenario diagnostic layer.

---

<br>

## `mouse_move`

*Move the physical pointer to a resolved position.*

**Action input**

- `pos` — destination [position](#position-and-rectangle).
- `window` — optional [window filter](#window-filters) providing a window-relative geometry context.
- `duration` — optional [time value](#time-values) for interpolated movement. `user()` chooses a human-like duration from movement distance.
- `path` — optional movement path, `linear | user`; default `linear`. `user` selects a mildly curved/jittered trajectory that still lands exactly at `pos`.
- `steps` — optional interpolation granularity used during a non-zero-duration move. `path` changes only trajectory; it never changes duration.
- `display` — optional [display](#displays) context.

```yaml
- mouse_move:
    window: { wid: "$.state.target.wid" }
    pos: { at: centerWC, x: "+20", y: "-10" }
    duration: 400ms

- mouse_move:
    pos: { x: 800, y: 500 }
    duration: user()
    path: user
```

**Action output**

`{pos}` containing the final resolved screen position, or `null` when the position cannot be resolved.

---

<br>

## `mouse_button`

*Click, hold, release, or scroll, optionally targeting a native window directly.*

**Action input**

- `click` — click `left | right | middle`.
- `down` — press and hold `left | right | middle`.
- `up` — release `left | right | middle`.
- `wheel` — signed vertical wheel detents; positive scrolls up and negative scrolls down.
- `hwheel` — signed horizontal wheel detents; positive scrolls right and negative scrolls left.
- `window` — optional [window filter](#window-filters). When supported, input is posted directly to that native window instead of moving the physical cursor.
- `pos` — [position](#position-and-rectangle) for the operation; direct-window mode defaults to `centerWC`.
- `display` — optional [display](#displays) geometry context.
- `repeat` — positive integer, default `1`; valid only with `click`.
- `interval` — [time value](#time-values) between repeated clicks, default `0`; `rand(...)` or `user()` may vary each gap.

Exactly one of `click`, `down`, `up`, `wheel`, or `hwheel` is allowed.

```yaml
- mouse_button:
    click: left
    repeat: 2
    interval: 150ms

- mouse_button:
    wheel: -3

- mouse_button:
    hwheel: 2
```

**Action output**

An object describing the applied operation and resolved `pos`; direct-target mode also includes `wid`.

---

<br>

## `input_reset`

*Release keyboard keys and mouse buttons that AutoJS is currently holding through explicit `down` operations.*

**Action input**

No fields.

```yaml
- input_reset: {}
```

AutoJS tracks only holds it created itself. A direct `input_reset()` call releases all currently owned `keyb.down`, physical `mouse_button.down`, and direct-window mouse holds. Normal `press` / `click` operations release themselves immediately and therefore need no reset.

`run()` snapshots the holds that already existed on entry. Its implicit `finally` recovery releases only holds added by that run, and an explicit `input_reset` action inside the scenario uses the same baseline: it releases the scenario's own holds early without disturbing caller-owned holds that predated the run.

**Action output**

`{released: N}` where `N` is the number of owned holds released.

---

<br>

## `clipboard`

*Read, replace, or clear clipboard text.*

**Action input**

- `write: text` — replace clipboard text with the supplied value.
- `read: true` — read current Unicode clipboard text.
- `clear: true` — clear clipboard contents.

Exactly one operation is allowed.

```yaml
- clipboard: { write: "hello" }
- clipboard: { read: true }
- clipboard: { clear: true }
```

**Action output**

- `read` → the current text string.
- `write` → `{length: N}` with the written text length.
- `clear` → `true`.

---

<br>

## `screenshot`

*Capture a new run-scoped image resource; optionally save the same capture immediately.*

**Action input**

- `window` — optional [window filter](#window-filters) selecting a capture window.
- `display` — optional [display](#displays) capture source/context.
- `rect` — optional [rectangle](#position-and-rectangle) crop.
- `all` — when `true`, capture the complete virtual desktop.
- `grayscale` — when `true`, convert the retained image to grayscale.
- `save` — optional destination path for immediately saving the newly captured resource.
- `format` — optional `webp | png`. WebP is the default; when omitted, a `.png` or `.webp` `save` extension selects that codec naturally.

```yaml
- screenshot:
    window: { wid: "$.state.target.wid" }
    rect:
      at: centerWC
      width: "80%WC"
      height: "80%WC"
    save: "capture.webp"
```

**Action output**

```yaml
image: "opaque-resource-id"
rect: { x: 260, y: 180, width: 900, height: 500 }
grayscale: false
path: "capture.webp"  # only when save was used
bytes: 42871           # only when save was used
format: webp           # only when save was used
```

`image` is opaque, run-scoped, and must never be parsed or persisted across runs. Resource lifetime is defined in [Image resources](#image-resources).

---

<br>

## `ocr`

*Recognize text from a fresh capture source or a retained image resource.*

**Action input**

- `image` — optional retained image handle. When supplied, OCR uses that existing resource and does not recapture.
- `window` — optional [window filter](#window-filters) selecting a fresh capture source when `image` is omitted.
- `display` — optional [display](#displays) capture source/context when `image` is omitted.
- `rect` — optional [rectangle](#position-and-rectangle) crop when `image` is omitted.
- `all` — capture the complete virtual desktop when `image` is omitted.

```yaml
- ocr:
    window: { wid: "$.state.target.wid" }
    rect:
      at: centerWC
      width: "80%WC"
      height: "50%WC"

- ocr:
    image: "$.state.shot"
```

**Action output**

`{text, rect}` with recognized text and the image rectangle, or `null` when OCR/capture cannot produce a result outside the scenario diagnostic layer.

---

<br>

## `screenshot_save`

*Save a retained image resource without recapturing the screen.*

**Action input**

- `image` — opaque image handle retained in scenario state; see [Image resources](#image-resources).
- `save` — destination path.
- `format` — optional `webp | png`. WebP is the default; when omitted, a `.png` or `.webp` `save` extension selects that codec naturally.

```yaml
- screenshot_save:
    image: "$.state.shot"
    save: "later.webp"
```

**Action output**

`{image, path, bytes, format, rect, grayscale}` when the retained resource is available. Inside `run()`, an unavailable/stale resource is reported through the scenario diagnostic result described under [`run()`](#run).

---

<br>

## `wait`

*Delay for a duration or poll one condition until it matches or times out.*

**Action input**

A scalar number/string is a fixed [time value](#time-values):

```yaml
- wait: 500
- wait: 2s
```

For conditional waits:

- `window` — [window filter](#window-filters); succeeds when a matching window exists.
- `ocr` — OCR condition. `text` is a case-insensitive regex; remaining fields describe the OCR capture source as in [`ocr`](#ocr).
- `image` — image-template condition. `path` is a WebP or PNG template, `similarity` defaults to `0.98`, and the remaining fields describe the screenshot source.
- `change` — visual-change condition. `percent` is the minimum changed-pixel percentage and the remaining fields describe the screenshot source.
- `timeout` — maximum wait duration; default `10s`.
- `interval` — polling interval; default `100ms`.
- `not` — invert the condition.

Exactly one of `window`, `ocr`, `image`, or `change` is allowed in a conditional wait.

```yaml
- wait:
    timeout: 10s
    interval: 100ms
    window: { title: "Ready" }

- wait:
    timeout: 20s
    ocr:
      text: "Ready|Done"
      window: { wid: "$.state.target.wid" }

- wait:
    timeout: 10s
    image:
      path: "ready.webp"
      window: { wid: "$.state.target.wid" }
      similarity: 0.98
```

**Action output**

Positive conditions return their concrete result directly: matched window, `{text, rect}`, `{path, rect, similarity}`, or `{rect, changed, percent, bounds}`. Timeout returns `null`; a satisfied `not: true` returns `true`.

---

<br>

## `display_find`

*Enumerate displays or select one by display index.*

**Action input**

- `display` — optional display selector. The canonical display selector is described in [Displays](#displays). Omit it to return all displays.

```yaml
- display_find: {}

- display_find:
    display: { index: 0 }
```

**Action output**

An array of display records. A valid selector with no match returns `[]`.

```yaml
- index: 0
  primary: true
  scale: 1.25
  width: 1920
  height: 1200
  work: { width: 1920, height: 1140 }
```

---

<br>

## `system`

*Inspect the current session lock state or influence idle/sleep behavior.*

**Action input**

- no fields — pure session-state query.
- `wake: true` — make a one-shot activity request for both system and display. It can wake an idle/off display while code is running, but cannot resume a machine that is already suspended.
- `awake: boolean` — enable or clear a continuous keep-awake request. A caller that enables it is responsible for later clearing it.

`wake` and `awake` are mutually exclusive.

```yaml
- system: {}              # query
- system: { wake: true }  # one-shot activity request
- system: { awake: true }
- system: { awake: false }
```

**Action output**

`{locked}` for a query, plus `wake: true` or `awake: boolean` for a successful operation. `locked` is `true`, `false`, or `null` when the backend cannot determine the session state. On Windows, wake/awake use the native execution-state API and never unlock an authenticated lock screen.

---


# 3. Targets and filters

AAF separates two target domains:

```text
window   native windows/surfaces exposed by the window system
a11y     elements exposed by the platform accessibility tree
```

They are distinct trees. `up` and `down` can traverse one tree or explicitly bridge to the other.

## General filter rule

Different fields are **ANDed**. Fields documented as scalar-or-array use **OR** inside the array.

```yaml
window:
  title: ["^Save$", "^OK$"]
  status: [normal, maximized]
  pid: [1200, 1300]
```

means:

```text
(title=Save OR title=OK)
AND (status=normal OR status=maximized)
AND (pid=1200 OR pid=1300)
```

An empty array matches nothing.

## Window filters

```yaml
window:
  wid: "0x123456"
  title: "^Untitled"
  bin: "notepad\\.exe$"
  class: "^Notepad$"
  pid: 1234
  foreground: true
  status: normal
  hidden: false
  display: 0
  wpid: null
  woid: null                     # owner is separate from parent
  depth: 0                       # 0 = native top-level
  zorder: 0                      # 0 = frontmost among siblings
```

**Fields**

- `wid` — exact native window ID.
- `title` — case-insensitive regex.
- `bin` — case-insensitive regex over the executable path.
- `class` — case-insensitive regex over native class/type when available.
- `pid` — process ID.
- `foreground` — boolean exact foreground state.
- `status` — `normal | minimized | maximized`.
- `hidden` — boolean visibility state.
- `display` — display index.
- `wpid` — immediate parent `wid`; `null` for top-level.
- `woid` — owner `wid`; owner is independent from the parent tree.
- `depth` — absolute parent-tree depth; top-level is `0`. `all` enables search at any depth without constraining the value.
- `zorder` — zero-based native Z-order among windows sharing the same parent/sibling level; `0` is frontmost.
- `up` / `down` — ancestor/descendant relation filters.

Scalar-or-array fields: `wid`, `title`, `bin`, `class`, `pid`, `status`, `display`, `wpid`, `woid`, `depth`, `zorder`.

Boolean fields stay scalar.

`window_find: {}` searches true top-level windows. Native-tree traversal is opt-in through `wid`, `wpid`, `depth`, `up`, or `down`. `woid` remains a separate owner filter.

Window output:

```yaml
wid: "0x123456"
title: "Untitled - Notepad"
bin: "C:\\...\\Notepad.exe"
class: "Notepad"
pid: 1234
foreground: true
status: normal
hidden: false
display: 0
rect: { x: 200, y: 120, width: 1200, height: 700 }
client: { x: 208, y: 151, width: 1184, height: 661 }
wpid: null
woid: null
depth: 0
zorder: 0
```

`client` is **output-only**: it is the native client/content rectangle in screen coordinates, the same geometry represented by `WC`. It is not a window filter because `WC` already provides the canonical client-area geometry language.

## Accessibility filters

`a11y` is platform-neutral. The current Windows backend maps it to Windows UI Automation; macOS can map it to AX, and Linux to AT-SPI.

```yaml
a11y:
  uid: "opaque-accessibility-id"
  name: "^Save$"
  type: button
  aid: "^saveButton$"
  value: "Draft"
  class: "Button"
  framework: "WPF|XAML"
  pid: 1234
  wid: null                      # accessibility-only elements may have no native window
  enabled: true
  focus: false
  focusable: true
  offscreen: false
  actions: [invoke, focus]
```

**Fields**

- `uid` — opaque current accessibility identity.
- `name` — accessible name, case-insensitive regex.
- `type` — normalized lowercase/kebab-case role/control type, for example `button`, `edit`, `document`, `menu-item`, `tab`.
- `aid` — automation/accessibility ID, case-insensitive regex.
- `value` — accessible value, case-insensitive regex.
- `class` — framework-specific class/type name, case-insensitive regex.
- `framework` — framework/technology name, case-insensitive regex.
- `pid` — process ID.
- `wid` — native window ID when one exists; otherwise `null`.
- `enabled`, `focus`, `focusable`, `offscreen` — booleans when available.
- `up` / `down` — accessibility-tree relation filters.

`actions` is **output-only**. It lists the currently advertised operations from `a11y_action`; it is not a selector field.

Scalar-or-array fields: `uid`, `name`, `type`, `aid`, `value`, `class`, `framework`, `pid`, `wid`.

Example output for an accessibility-only control:

```yaml
uid: "42.11470300.4.1"
name: ""
type: tab
aid: "Tabs"
value: ""
class: "Microsoft.UI.Xaml.Controls.TabView"
framework: "XAML"
pid: 10308
wid: null
rect: { x: 266, y: 150, width: 359, height: 40 }
enabled: true
focus: false
focusable: false
offscreen: false
actions: []
```

## `up` / `down`

Same-domain window relation:

```yaml
window:
  down:
    class: "^Button$"
    depth: 2                     # relation-local traversal distance
```

Same-domain accessibility relation:

```yaml
a11y:
  up:
    type: dialog
    depth: all
```

Window to accessibility:

```yaml
window:
  bin: "notepad\\.exe$"
  down:
    depth: all
    a11y:
      type: button
      name: "^Save$"
```

Accessibility to window:

```yaml
a11y:
  type: button
  name: "^Save$"
  up:
    depth: all
    window:
      bin: "notepad\\.exe$"
```

A relation-local `depth` is the maximum number of edges traversed: default `1`, or `all`. Owner (`woid`) never participates in the parent tree.

The outer command decides the result domain. `window_find` always returns windows; `a11y_find` always returns accessibility elements, even when a relation bridges to the other domain.

---


# 4. Geometry and time

## Displays

A display target is:

```yaml
display: { index: 0 }
```

Display index `0` is the primary display. Display records also expose `scale`, the native desktop scale factor as a ratio (`1`, `1.25`, `1.5`, …).

## Position and rectangle

AAF uses only two geometry objects:

```yaml
pos:
  at: centerWC                   # anchor against the client area
  x: "+20"                      # relative offset
  y: "-10"
```

```yaml
rect:
  at: center
  x: "50%D"
  y: "50%D"
  width: "60%D"                 # D = display rectangle
  height: "70%D"
```

Available anchors:

```text
top-left   top          top-right
left       center       right
bottom-left bottom      bottom-right
```

Geometry reference rectangles:

- `W` — outer window rectangle.
- `WC` — window client/content area expressed in screen coordinates.
- `D` — display rectangle.

Anchor suffixes select a reference explicitly: `centerW`, `centerWC`, `bottom-rightD`.

Value rules:

- numeric position/edge — absolute pixels; with an explicit display, relative to that display origin.
- numeric `width`/`height` — pixel size.
- signed strings such as `"+100"`, `"-50"` — offsets from the current geometry.
- unsigned suffixed pixels such as `"20W"`, `"20WC"`, `"20D"` — pixels from that reference origin; for sizes they remain pixel sizes.
- unsigned percentages such as `"50%WC"` — absolute fraction of the reference.
- signed percentages such as `"+10%WC"` — relative delta by that fraction of the reference dimension.

If a window target exists, the implicit reference is `W`; otherwise it is `D`. Explicit `W`, `WC`, or `D` suffixes override the implicit reference.

`pos.at` selects the position anchor. `rect.at` is the resize/placement pivot. Explicit `left`, `top`, `right`, or `bottom` edges directly constrain that axis and take precedence over pivot behavior on that axis.

For a window geometry update, `rect` is resolved first and `pos` then repositions the resulting rectangle without changing its resolved size.

## Time values

One small grammar is used everywhere:

```text
250                              250 milliseconds
250ms                            250 milliseconds
2s                               2 seconds
1.5m                             90 seconds
rand(300ms)                      random value from 0 to 300 ms
rand($.curr.type.len*10)        random value derived from resolved action data
user()                           short context-sensitive human-like timing
```

Numbers and unitless numeric terms are milliseconds. Strings may use `ms`, `s`, or `m`.

`rand(expr)` evaluates its bound when that time value is consumed. A duration is normally consumed once; a repeated `interval` is consumed again for each gap or poll, so it can vary naturally. Its intentionally tiny expression syntax supports only multiplication of numeric/time terms and `$.curr` dot paths. A final `.len` reads the length of a string or array. There is no general expression language and no `eval`.

Inside `run()`, `$.curr` sees the current action input **after** normal `$.prev` / `$.ret` / `$.state` reference resolution and interpolation. It exists only while a time expression is being consumed, avoiding circular self-references during ordinary action-value resolution. Direct primitive calls use their supplied argument object as `$.curr`.

`user()` is contextual rather than a fixed duration. Generic interval use chooses a short human-like delay. `mouse_move.duration: user()` chooses only a human-like travel time; trajectory is independent and uses the non-time field `mouse_move.path: user`. For `keyb.type`, `duration: user()` or `interval: user()` generates independent per-character pauses, including slightly longer pauses around punctuation. If both keyb fields are present, `duration` wins without an error or warning.

---


# 5. Scenario execution, state, and resources

The automation primitives themselves remain stateless: each action resolves its own targets and arguments. `run()` adds only a small temporary scenario context.

## run()

`run([...])` executes actions sequentially and returns an object with two fields:

```yaml
results: [...]  # one result per action, in order
state: {...}    # final scenario state returned to the caller
```

`results` contains the ordinary per-action return values. During execution, `$.prev` exposes the resolved input of the previous non-`state` action and `$.ret` exposes its return value. `state` is the final scenario state after the last action. Ordinary state values are copied out normally; image handles that are still retained anywhere in the final state are materialized there as image resources, so the caller owns those images after `run()` returns.

Normal scenario actions are best-effort, but failures are **returned as data rather than thrown out of `run()`**. Each failed step produces a small JSON-compatible diagnostic object in `results` and execution continues. Find actions still return `[]` for a valid search with no matches. Direct primitive calls keep their documented direct-call behavior; this diagnostic layer belongs to `run()`.

Typical diagnostics are intentionally compact:

```yaml
- error: unresolved reference
  path: "$.state.missing"

- error: invalid state path
  path: "bad path"

- error: unknown action
  action: unknown_action

- error: no result
  action: screenshot_save

- error: action failed
  action: keyb
  message: "Invalid repeat: 0"
```

`error` is the short category. Optional `action`, `path`, or `image` identifies what failed. `message` is used only when a concise underlying runtime cause is useful. Stack traces are not part of AAF output. A malformed action is reported as `error: invalid action`; a non-array `run()` input returns `{results: [{error: "invalid scenario", ...}], state: {}}`. A diagnostic from a non-`state` step becomes the new `$.ret`. Its resolved input becomes `$.prev` when input resolution succeeded. A failed `state` step changes neither state, `$.prev`, nor `$.ret`.

A new run starts with an empty state and no resources.

## Scenario references

During one run:

```text
$.curr   resolved input of the current action, for time expressions
$.prev   resolved input of the most recent non-state action
$.ret    return value of the most recent non-state action
$.state  explicit temporary scenario memory
```

Ordinary action values may read `$.prev`, `$.ret`, and `$.state`. `$.curr` is available only inside the small time-expression grammar after the current input has been resolved. Only `state` may modify `$.state`.

`state` is transparent to action history: it changes neither `$.prev` nor `$.ret`, so multiple consecutive state patches continue to see the same previous action input and return value.

## Typed references

A string made entirely of a `$.…` path is replaced by the actual referenced value and preserves its type:

```yaml
pid: "$.state.target.pid"
window: "$.prev.window"
items: "$.ret"
```

Supported ordinary path shape:

```text
$.prev
$.prev.window.wid
$.ret
$.ret[0].wid
$.state.target
$.state.items[2].name
```

Indexes are zero-based. A missing path invalidates the step instead of silently becoming a `null` argument. That step's `results` entry becomes `{error: "unresolved reference", path: "$.…"}`.

## Text interpolation

Use `<<…>>` inside a larger string:

```yaml
title: "Document - <<$.state.customer>>"
text: "Window <<$.state.index>>: <<$.ret[0].title>>"
```

Interpolation always produces text. Objects and arrays use compact JSON text.

Regex-valued fields may use `|re`:

```yaml
title: "^<<$.state.target.title|re>>$"
```

So:

```text
$.state.x          full typed replacement
<<$.state.x>>      text interpolation
<<$.state.x|re>>   regex-escaped interpolation
```

<br>

## `state`

*Apply one atomic hierarchical patch to the current scenario state.*

**Action input**

Every normal key is a state path assignment. Nested objects and dotted paths are equivalent.

- `path: value` — assign the resolved value at `path`. Missing intermediate objects are created; a non-object intermediate value is replaced with an object when a deeper path must be written.
- `&path: value` — append one resolved value as a single item to an array. A missing target leaf becomes `[]`; an existing non-array leaf makes the whole patch fail atomically.
- `"-": [paths...]` — delete the listed state paths after assignments and pushes. Missing delete targets are harmless.

State paths use the canonical dotted state-path grammar. Values may use [typed references](#typed-references) or [text interpolation](#text-interpolation). Every reference in one `state` action is resolved against the **pre-patch** context, so writes in the same patch cannot observe each other.

```yaml
- state:
    target:
      wid: "$.ret[0].wid"
      pid: "$.ret[0].pid"
    "target.title": "$.ret[0].title"
    "&history": "$.ret[0]"
    "-":
      - temporary
      - target.pid
```

Assignments and pushes apply first; deletions apply second, so deletion wins on conflicts.

**Action output**

The complete resulting `$.state`. A `state` action does not change `$.prev` or `$.ret`. A failed `state` action also leaves state unchanged and never partially applies a patch.

## Image resources

Some data is too large or implementation-specific to carry through ordinary scenario action data. During execution, AAF represents it with opaque run-scoped resource handles.

`screenshot` creates an image resource and returns an opaque `image` string. Scenario references, `$.ret`, state-action results, OCR, matching, and `screenshot_save` use that handle while the run is active. The current implementation keeps the underlying image as raw BGRA8 pixels in memory throughout scenario execution. Encoding is deferred to disk output or final-state materialization, avoiding encode/decode work in OCR, image matching, and change detection.

A newly created image is temporarily reachable through `$.ret`. Storing its handle anywhere in `$.state` retains the underlying resource:

```yaml
- screenshot:
    window: { wid: "$.state.target.wid" }

- state:
    shot: "$.ret.image"
```

Once retained, state owns the resource. Multiple state paths may reference the same handle. Removing or overwriting one path does not free the resource while another state reference remains.

When the **last** state reference disappears, the resource is released. A stale string containing the old handle no longer resolves to an image resource.

```yaml
- state:
    "-": [shot]
```

When `run()` returns, every image still referenced by the **final** state is materialized into `run().state` and ownership of that image value passes to the caller. The current Deno backend keeps BGRA8 raw while the scenario is active, then normally encodes final-state images once as lossless PNG: `{format: "png", rect, grayscale, data: Uint8Array}`. This keeps OCR/matching on the fast raw path during execution while making retained caller-owned images much smaller. Final-state compaction is best-effort: if PNG encoding itself is unavailable, the caller receives the equivalent raw BGRA8 image rather than losing the state or failing the whole run. If the same handle appears at several state paths, those paths share the same materialized image object.

Direct `ocr({image})` accepts these returned PNG image resources and decodes them back to BGRA8 on demand. Resources not referenced by the final state are released when the run ends. The opaque handle strings themselves are never valid across runs and are not the caller-facing image representation. Per-action `results` remain JSON-compatible; the final returned `state` may contain host-native binary resource values.

`screenshot_save` is therefore a state-to-disk operation **during the run**: it saves an already retained image resource without recapturing anything.

---


# 6. Portability and backend capabilities

AAF is a platform-agnostic model. A backend implements the capabilities that its operating system and security model actually expose.

The common structure is portable:

- ordered actions and simple JSON-compatible results;
- common filters with AND/OR semantics;
- `window` as the native window-system domain;
- `a11y` as the accessibility domain;
- explicit `up` / `down` relationships and cross-domain bridges;
- shared `pos` / `rect` geometry and time syntax;
- keyboard, mouse, clipboard, screenshot, OCR, wait, and input-recovery concepts;
- accessibility discovery plus native accessibility actions when the backend exposes them;
- optional scenario state and run-scoped resources.

Unavailable backend properties are optional capabilities. They must not be imitated with misleading semantics. A filter requiring an unavailable property does not match; an unsupported mutation follows normal best-effort behavior.

## Windows

The current implementation is Windows x64 and is presently the richest backend:

- `window` → HWND / User32.
- `a11y` → Windows UI Automation Control View.
- native parent and owner are distinct relationships; window records also expose sibling `zorder` and output-only client geometry.
- display records expose the native desktop `scale` ratio.
- physical input supports vertical/horizontal wheel and owned-input recovery; some mouse input can also be directed to a specific HWND.
- accessibility records expose supported native pattern actions, and `a11y_action` executes those patterns directly.
- `window_set` can use native caption, frame/style, topmost, opacity, and enabled state.

## macOS

The same model can map to:

- native application/window surfaces for `window`.
- Accessibility API (AX) for `a11y`.
- accessibility parent/children, role/name/value/focus, and geometry.

The native window tree is generally less expressive than the Windows HWND tree, so more structural information may naturally live under `a11y`. The AAF grammar does not need to change.

## Linux

On X11, `window` maps naturally to the X Window hierarchy and window-manager properties, while `a11y` can map to AT-SPI.

On Wayland, the main difference is capability and permission rather than grammar. A normal client cannot assume that it may enumerate, focus, move, or inject input into arbitrary surfaces belonging to other applications. A Wayland backend exposes only what its compositor, portals, accessibility services, and environment permit.

Windows, macOS, and Linux therefore do not need identical native fields. AAF keeps one model while each backend exposes its supported subset or superset without changing scenario structure.

---


# 7. Design principles

AAF intentionally keeps a small set of stable rules:

- explicit targets; no implicit current window or control.
- small composable actions.
- separate `window` and `a11y` trees, never one artificial merged tree.
- one filter model: OR within a field, AND across fields.
- one geometry grammar.
- one time grammar.
- platform-specific capabilities remain explicit and best-effort.
- scenario state is optional infrastructure, not the center of the action model.
- heavy runtime data uses opaque resources instead of being embedded in JSON.
- per-action results stay simple, JSON-compatible, and reusable by later actions; final `run().state` may materialize explicitly retained binary resources for the caller.

The goal is for an AAF scenario to stay readable by hand, easy to generate, and precise enough for robust desktop automation without becoming a general-purpose programming language.
