# Automation Action Format (AAF)

AAF is a small declarative format for desktop automation. A scenario is an ordered array of actions that can be represented as YAML, JSON, or any equivalent object/array structure.

## 1. Quick start: automate Notepad

This scenario finds a Notepad window, remembers it, focuses it, types text, captures its client area, keeps the image in scenario state, saves it to disk, and waits until OCR can see the typed text.

```yaml
- window_find:
    window:
      bin: "notepad\\.exe$"   # regex, case-insensitive
      status: normal

- state:
    target: "$.prev[0]"        # stores the whole typed window record

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
    shot: "$.prev.image"       # retaining the handle keeps the image alive

- screenshot_save:
    image: "$.state.shot"      # reuse the retained resource; no recapture
    save: "notepad.png"

- wait:
    timeout: 5s
    ocr:
      text: "AAF test 42"
      window:
        wid: "$.state.target.wid"
```

Step by step:

1. `window_find` returns matching native windows. `$.prev[0]` is the first one.
2. `state` stores that window record under `target` so later actions can reuse its `wid`.
3. `window_control` focuses exactly that window.
4. `keyb` types Unicode text.
5. `screenshot` captures a new image and returns an opaque `image` resource handle plus capture metadata.
6. `state` retains the image resource under `shot`.
7. `screenshot_save` writes that retained image resource to disk without capturing again.
8. `wait.ocr` polls until the expected text is visible or the timeout expires.

Typical results are deliberately plain and reusable:

```yaml
- - wid: "0x730632"
    wpid: null
    woid: null
    depth: 0
    title: "Untitled - Notepad"
    class: "Notepad"
    pid: 10308
    bin: "C:\\...\\Notepad.exe"
    display: 0
    rect: { x: 200, y: 120, width: 1200, height: 700 }
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
  path: "notepad.png"
  bytes: 42871
  rect: { x: 320, y: 220, width: 960, height: 520 }
  grayscale: false

- text: "AAF test 42"
  rect: { x: 200, y: 120, width: 1200, height: 700 }
```

---

## 2. Action reference

Every scenario action is an object with exactly one command key.

### Command index

**Discovery and inspection**

- `display_find` — find displays.
- `window_find` — find native windows.
- `window_get` — get one native window, optionally including its control text.
- `a11y_find` — find accessibility elements.

**System and session**

- `system` — inspect lock state, reset idle timers, or keep the system/display awake.

**Window operations and debugging**

- `window_control` — focus, move, resize, minimize, maximize, restore, or close a window.
- `window_set` — change simple window properties.
- `window_hit` — resolve the native window under a point.
- `highlight` — draw a temporary outline around a window or accessibility element.

**Input and clipboard**

- `mouse_move` — move the pointer.
- `mouse_button` — click, hold, release, or scroll.
- `keyb` — press keys or type Unicode text.
- `clipboard` — read, write, or clear clipboard text.

**Images and synchronization**

- `screenshot` — capture a new image resource, optionally saving it immediately.
- `screenshot_save` — save an existing retained image resource.
- `ocr` — recognize text from a capture source or image resource.
- `wait` — delay or poll a condition.

**Scenario helper**

- `state` — mutate temporary scenario state.

### Discovery and inspection

#### `display_find`

Find displays.

```yaml
- display_find: {}
```

**Optional target**

```yaml
- display_find:
    display: { index: 0 }
```

**Output:** an array of display records.

```yaml
- index: 0
  primary: true
  width: 1920
  height: 1200
  work: { width: 1920, height: 1140 }
```

#### `window_find`

Find native windows matching a `window` filter.

```yaml
- window_find:
    window:
      bin: "notepad\\.exe$"
      title: ["^Untitled", "^Document"] # OR within this field
    limit: 1                              # 0 or omitted = no limit
```

**Fields:**

- `window` — common window filter described in [Window filters](#window-filters).
- `limit` — maximum number of results. `0` or omitted means no limit.

**Output:** array of window records; `[]` when nothing matches.

#### `window_get`

Get the first native window matching a `window` filter.

```yaml
- window_get:
    window: { class: "^Edit$" }
    text: true # query the live window/control text
```

**Fields:**

- `window` — common window filter described in [Window filters](#window-filters).
- `text` — when `true`, also query the target's live text/content.

**Output:** one window record or `null`. With `text: true`, the record also contains `text`, which is a string when the native control supports text retrieval or `null` when it cannot be retrieved. `text` is distinct from the normal `title` field: on Windows it uses bounded `WM_GETTEXT`, so it can read cross-process Edit, Static, Button, and similar controls that `GetWindowText` cannot read reliably.

#### `a11y_find`

Find elements in the platform accessibility tree.

```yaml
- a11y_find:
    a11y:
      type: button
      name: ["^Save$", "^OK$"]
      up:
        depth: all
        window:
          bin: "notepad\\.exe$"
    limit: 10                             # stop after 10 matches
```

**Fields:**

- `a11y` — common accessibility filter described in [Accessibility filters](#accessibility-filters).
- `limit` — maximum number of results. `0` or omitted means no limit.

**Output:** array of accessibility records; `[]` when nothing matches.

### System and session

#### `system`

Inspect or influence the current desktop session's idle/power state.

```yaml
- system: {}              # -> { locked: false }

- system:
    wake: true            # one-shot reset of system + display idle timers

- system:
    awake: true           # continuously prevent sleep/display-off

- system:
    awake: false          # clear the continuous request
```

`wake` and `awake` are mutually exclusive. With neither field, `system` is a pure query.

**Fields:**

- `wake: true` — make a one-shot activity request for both system and display. It can wake an idle/off display while the process is running, but cannot resume a machine that is already suspended because no action executes during suspension.
- `awake: boolean` — enable or clear a continuous keep-awake request. A caller that enables it is responsible for later clearing it.

**Output:** `{locked}` for a query, plus `wake: true` or `awake: boolean` for a successful operation. `locked` is `true`, `false`, or `null` if the backend cannot determine the session state. Invalid combinations or failed operations return `null`.

On Windows, lock state comes from the current `WTSSessionInfoEx` session state. Wake/awake use the native execution-state API; they do not unlock an authenticated lock screen.

### Window operations and debugging

#### `window_control`

Perform an operational window action.

```yaml
- window_control:
    window: { wid: "0x123456" }
    action: maximize
```

**Fields**

- `window` — window filter selecting the target.
- `action` — one of `restore | minimize | maximize | focus | move | size | close`.
- `pos` — optional position for `move` / `size`.
- `rect` — optional rectangle/size for `move` / `size`.
- `display` — optional display context for geometry.

`move` and `size` are exact aliases: both apply the supplied `pos` and/or `rect` in one geometry update.

**Output:** current window record after the operation, or `null`.

#### `window_set`

Apply simple best-effort window properties.

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

**Fields**

- `window` — window filter selecting the target.
- `title` — caption/title when supported.
- `frame` — `none | border | caption | resizable`.
- `topmost` — boolean.
- `opacity` — number from `0` to `1`.
- `enabled` — boolean.
- `highlight` — `true` or an AAF duration; highlights after applying the other fields.

There is no generic `class` setter. Native class/control identity is not generally an instance property that can be truthfully renamed across backends.

**Output:** current window record, or `null`.

#### `window_hit`

Return the native window under a screen point.

```yaml
- window_hit:
    pos: { x: 500, y: 300 }
    child: true
```

**Fields**

- `pos` — point to test.
- `display` — optional display context.
- `child` — when true, resolve the deepest native child available at that point.

**Output:** window record or `null`.

#### `highlight`

Draw a temporary visual outline around one window or accessibility element without mutating the target.

```yaml
- highlight:
    a11y:
      type: button
      name: "^Save$"
    duration: 1s
```

**Fields**

- exactly one of `window` or `a11y`.
- `duration` — default `800ms`.

**Output:** `{wid?, uid?, rect}` or `null`.

### Input and clipboard

#### `mouse_move`

Move the physical pointer.

```yaml
- mouse_move:
    window: { wid: "$.state.target.wid" }
    pos: { at: centerWC, x: "+20", y: "-10" }
    duration: 400ms
```

**Fields**

- `pos` — target point.
- `window` — optional geometry reference window.
- `display` — optional display context.
- `duration` — optional movement duration.
- `steps` — optional interpolation granularity.

**Output:** `{pos}` or `null`.

#### `mouse_button`

Perform one mouse button/wheel operation, optionally repeating `click`.

```yaml
- mouse_button:
    click: left
    repeat: 2        # repeat only applies to click
    interval: 150ms  # delay between repeated clicks
```

```yaml
- mouse_button:
    down: left

- mouse_button:
    up: left
```

```yaml
- mouse_button:
    wheel: -3
```

**Fields**

- exactly one of `click`, `down`, `up`, `wheel`.
- `click/down/up` — `left | right | middle`.
- `wheel` — signed wheel detents; positive is up, negative is down.
- `window` — when supported, target that native window directly instead of producing physical pointer input.
- `pos` — action position; direct window mode defaults to `centerWC`.
- `display` — optional geometry context.
- `repeat` — positive integer, default `1`; valid only with `click`.
- `interval` — delay between repeated clicks, default `0`.

Output includes the operation and resolved `pos`; direct-target mode also includes `wid`.

#### `keyb`

Generate keyboard input.

```yaml
- keyb:
    press: [ctrl, a]
```

```yaml
- keyb:
    press: "@"       # mapped through the active keyboard layout
```

```yaml
- keyb:
    press: backspace
    repeat: 3
    interval: 100ms

```yaml
- keyb:
    down: ctrl
- wait: 1s
- keyb:
    up: ctrl
```

```yaml
- keyb:
    type: "Hello world"
    interval: 30ms
```

**Fields**

- `press` — key down+up; scalar or chord array. Named keys use the canonical key catalog; a single printable character is mapped through the active keyboard layout.
- `down` — hold one named key or a chord of named keys.
- `up` — release one named key or a chord of named keys.
- `type` — Unicode text sent directly, independent of keyboard layout.
- `repeat` — positive integer, default `1`; valid only with `press`.
- `interval` — delay between repeated `press` operations, or between characters for `type`; default `0`.

Output reports the operation that was applied. Repeated `press` also reports `repeat`. For `type`, the result field is `typed` and contains the number of characters sent.

Named keys include letters and digits; Backspace, Tab, Enter, Escape and navigation keys; Caps/Num/Scroll Lock; Print Screen; left/right Shift, Ctrl, Alt and Windows keys; numpad keys; F1–F24; Apps/context-menu; and common browser, volume, media and launch keys. Numeric virtual-key codes remain accepted for backend-specific cases.

#### `clipboard`

Read, write, or clear clipboard text. Exactly one operation is allowed.

```yaml
- clipboard: { write: "hello" }
- clipboard: { read: true }
- clipboard: { clear: true }
```

**Fields**

- `read: true` — return current text.
- `write: text` — replace clipboard text; returns `{length}`.
- `clear: true` — clear clipboard; returns `true`.

### Images and synchronization

#### `screenshot`

Capture a **new** image resource. Saving it immediately is optional.

```yaml
- screenshot:
    window: { wid: "$.state.target.wid" }
    rect:
      at: centerWC
      width: "80%WC"
      height: "80%WC"
    grayscale: false
    save: "capture.png"         # optional; capture still returns an image handle
```

**Fields**

- `window` — optional capture window.
- `display` — optional display source/context.
- `rect` — optional crop.
- `all` — capture the complete virtual desktop when true.
- `grayscale` — convert the retained image to grayscale.
- `save` — optional file path; saves the newly captured resource immediately.
- `format` — currently `png`.

**Output:**

```yaml
image: "opaque-resource-id"     # never parse or persist across runs
rect: { x: 260, y: 180, width: 900, height: 500 }
grayscale: false
path: "capture.png"   # only when save was used
bytes: 42871           # only when save was used
```

`image` is opaque. Scenarios must never inspect its format or derive meaning from it.

#### `screenshot_save`

Save an **existing retained image resource** to disk. It never captures the screen.

```yaml
- screenshot_save:
    image: "$.state.shot"       # must still be retained in state
    save: "later.png"
```

**Fields**

- `image` — opaque image handle retained in scenario state.
- `save` — destination path.
- `format` — currently `png`.

**Output:** `{image, path, bytes, rect, grayscale}`, or `null` when the resource is unavailable.

#### `ocr`

Run OCR on a capture source or on an image resource.

```yaml
- ocr:
    window: { wid: "$.state.target.wid" }
    rect:
      at: centerWC
      width: "80%WC"
      height: "50%WC"
```

Or reuse an image resource:

```yaml
- ocr:
    image: "$.state.shot"
```

**Fields**

- `image` — optional retained image handle.
- otherwise `window`, `display`, `rect`, `all` describe a fresh capture source.

**Output:** `{text, rect}` or `null`.

#### `wait`

Wait for time or poll a condition.

Fixed delay:

```yaml
- wait: 500
- wait: 2s
```

Window condition:

```yaml
- wait:
    timeout: 10s
    interval: 100ms
    window:
      title: "Ready"
```

OCR condition:

```yaml
- wait:
    timeout: 20s
    ocr:
      text: "Ready|Done"
      window: { wid: "$.state.target.wid" }
```

Image-template condition:

```yaml
- wait:
    timeout: 10s
    image:
      path: "ready.png"
      window: { wid: "$.state.target.wid" }
      similarity: 0.98
```

Change condition:

```yaml
- wait:
    timeout: 10s
    change:
      window: { wid: "$.state.target.wid" }
      rect:
        at: centerWC
        width: "60%WC"
        height: "40%WC"
      percent: 5
```

**Conditional fields**

- `timeout` — default `10s`.
- `interval` — default `100ms`.
- `not` — invert the condition.
- exactly one of `window`, `ocr`, `image`, `change`.

Positive results are returned directly: matched window, `{text, rect}`, `{path, rect, similarity}`, or `{rect, changed, percent, bounds}`. Timeout returns `null`. A satisfied `not: true` returns `true`.

### Scenario helper

#### `state`

Modify temporary scenario state. Its detailed semantics are intentionally described later in [Scenario execution, state, and resources](#5-scenario-execution-state-and-resources).

```yaml
- state:
    target: "$.prev[0]"
```

**Output:** complete resulting state, or `null` if the patch is invalid.

---

## 3. Targets and filters

AAF separates two target domains:

```text
window   native windows/surfaces exposed by the window system
a11y     elements exposed by the platform accessibility tree
```

They are distinct trees. `up` and `down` can traverse one tree or explicitly bridge to the other.

### General filter rule

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

### Window filters

```yaml
window:
  wid: "0x123456"
  wpid: null
  woid: null                     # owner is separate from parent
  depth: 0                       # 0 = native top-level
  pid: 1234
  title: "^Untitled"
  bin: "notepad\\.exe$"
  class: "^Notepad$"
  display: 0
  status: normal
  hidden: false
  foreground: true
```

**Fields**

- `wid` — exact native window ID.
- `wpid` — immediate parent `wid`; `null` for top-level.
- `woid` — owner `wid`; owner is independent from the parent tree.
- `depth` — absolute parent-tree depth; top-level is `0`. `all` enables search at any depth without constraining the value.
- `pid` — process ID.
- `title` — case-insensitive regex.
- `bin` — case-insensitive regex over the executable path.
- `class` — case-insensitive regex over native class/type when available.
- `display` — display index.
- `status` — `normal | minimized | maximized`.
- `hidden` — boolean visibility state.
- `foreground` — boolean exact foreground state.
- `up` / `down` — ancestor/descendant relation filters.

Scalar-or-array fields: `wid`, `wpid`, `woid`, `depth`, `pid`, `title`, `bin`, `class`, `display`, `status`.

Boolean fields stay scalar.

`window_find: {}` searches true top-level windows. Native-tree traversal is opt-in through `wid`, `wpid`, `depth`, `up`, or `down`. `woid` remains a separate owner filter.

Window output:

```yaml
wid: "0x123456"
wpid: null
woid: null
depth: 0
title: "Untitled - Notepad"
class: "Notepad"
pid: 1234
bin: "C:\\...\\Notepad.exe"
display: 0
rect: { x: 200, y: 120, width: 1200, height: 700 }
status: normal
hidden: false
foreground: true
```

### Accessibility filters

`a11y` is platform-neutral. The current Windows backend maps it to Windows UI Automation; macOS can map it to AX, and Linux to AT-SPI.

```yaml
a11y:
  uid: "opaque-accessibility-id"
  wid: null                      # accessibility-only elements may have no native window
  aid: "^saveButton$"
  name: "^Save$"
  type: button
  class: "Button"
  framework: "WPF|XAML"
  pid: 1234
  value: "Draft"
  enabled: true
  focus: false
  focusable: true
  offscreen: false
```

**Fields**

- `uid` — opaque current accessibility identity.
- `wid` — native window ID when one exists; otherwise `null`.
- `aid` — automation/accessibility ID, case-insensitive regex.
- `name` — accessible name, case-insensitive regex.
- `type` — normalized lowercase/kebab-case role/control type, for example `button`, `edit`, `document`, `menu-item`, `tab`.
- `class` — framework-specific class/type name, case-insensitive regex.
- `framework` — framework/technology name, case-insensitive regex.
- `pid` — process ID.
- `value` — accessible value, case-insensitive regex.
- `enabled`, `focus`, `focusable`, `offscreen` — booleans when available.
- `up` / `down` — accessibility-tree relation filters.

Scalar-or-array fields: `uid`, `wid`, `pid`, `aid`, `name`, `type`, `class`, `framework`, `value`.

Example output for an accessibility-only control:

```yaml
uid: "42.11470300.4.1"
wid: null
aid: "Tabs"
name: ""
type: tab
class: "Microsoft.UI.Xaml.Controls.TabView"
framework: "XAML"
pid: 10308
rect: { x: 266, y: 150, width: 359, height: 40 }
value: ""
enabled: true
focus: false
focusable: false
offscreen: false
```

### `up` / `down`

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

## 4. Geometry and time

### Displays

A display target is:

```yaml
display: { index: 0 }
```

Display index `0` is the primary display.

### Position and rectangle

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

### Time values

One grammar is used everywhere:

```text
250       250 milliseconds
250ms     250 milliseconds
2s        2 seconds
1.5m      90 seconds
```

Numbers are milliseconds. String time values require `ms`, `s`, or `m`.

---

## 5. Scenario execution, state, and resources

The automation primitives themselves remain stateless: each action resolves its own targets and arguments. `run()` adds only a small temporary scenario context.

### `run()`

`run([...])` executes actions sequentially and returns one result per action in the same order.

Normal scenario actions are best-effort. A missing target, unresolved reference, unsupported operation, or runtime failure normally produces `null` and execution continues. Find actions return `[]` for no matches. A malformed action object with more or fewer than one command key is invalid.

A new run starts with an empty state and no resources.

### `$.prev` and `$.state`

During one run:

```text
$.prev    result of the most recent non-state action
$.state   explicit temporary scenario memory
```

Every action may read both. Only `state` may modify `$.state`.

`state` does not replace `$.prev`, so multiple consecutive state patches may all read the same previous action result.

### Typed references

A string made entirely of a `$.…` path is replaced by the actual referenced value and preserves its type:

```yaml
pid: "$.state.target.pid"
window: "$.state.window_filter"
items: "$.prev"
```

Supported path shape:

```text
$.prev
$.prev[0].wid
$.state.target
$.state.items[2].name
```

Indexes are zero-based. A missing path invalidates the step instead of silently becoming `null`.

### Text interpolation

Use `<<…>>` inside a larger string:

```yaml
title: "Document - <<$.state.customer>>"
text: "Window <<$.state.index>>: <<$.prev[0].title>>"
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

### State patches

`state` applies one atomic hierarchical patch.

```yaml
- state:
    target:
      wid: "$.prev[0].wid"
      pid: "$.prev[0].pid"
    "target.title": "$.prev[0].title"
```

Nested maps and dotted paths are equivalent. Missing intermediate objects are autovivified. If an intermediate value is not an object, it is replaced with an object so the requested deeper path can be written.

Push one item to an array with `&path`:

```yaml
- state:
    "&history": "$.prev[0]"   # &path appends one item to an array
    "&events":
      type: found
      wid: "$.prev[0].wid"
```

If the target leaf does not exist it becomes `[]`. If it exists and is not an array, the entire patch fails atomically.

Delete paths with the reserved `"-"` key:

```yaml
- state:
    "-":                        # delete after writes/pushes
      - temporary
      - target.pid
      - "<<$.state.path_to_remove>>"
```

All references in one state action are resolved against the pre-patch context. Assignments and pushes apply first; deletions apply second, so deletion wins on conflicts.

### Image resources

Some data is too large or implementation-specific to place directly in JSON state. AAF represents it with opaque run-scoped resource handles.

`screenshot` creates an image resource and returns an opaque `image` string. The raw pixels never appear in AAF data.

A newly created image is temporarily reachable through `$.prev`. Storing its handle anywhere in `$.state` retains the underlying resource:

```yaml
- screenshot:
    window: { wid: "$.state.target.wid" }

- state:
    shot: "$.prev.image"
```

Once retained, state owns the resource. Multiple state paths may reference the same handle. Removing or overwriting one path does not free the resource while another state reference remains.

When the **last** state reference disappears, the resource is released. A stale string containing the old handle no longer resolves to an image resource.

```yaml
- state:
    "-": [shot]
```

All remaining resources are released when the run ends. Resource handles are never valid across runs.

`screenshot_save` is therefore a state-to-disk operation: it saves an already retained image resource without recapturing anything.

---

## 6. Portability and backend capabilities

AAF is a platform-agnostic model. A backend implements the capabilities that its operating system and security model actually expose.

The common structure is portable:

- ordered actions and simple JSON-compatible results;
- common filters with AND/OR semantics;
- `window` as the native window-system domain;
- `a11y` as the accessibility domain;
- explicit `up` / `down` relationships and cross-domain bridges;
- shared `pos` / `rect` geometry and time syntax;
- keyboard, mouse, clipboard, screenshot, OCR, and wait concepts;
- optional scenario state and run-scoped resources.

Unavailable backend properties are optional capabilities. They must not be imitated with misleading semantics. A filter requiring an unavailable property does not match; an unsupported mutation follows normal best-effort behavior.

### Windows

The current implementation is Windows x64 and is presently the richest backend:

- `window` → HWND / User32.
- `a11y` → Windows UI Automation Control View.
- native parent and owner are distinct relationships.
- physical input is supported; some mouse input can also be directed to a specific HWND.
- `window_set` can use native caption, frame/style, topmost, opacity, and enabled state.

### macOS

The same model can map to:

- native application/window surfaces for `window`.
- Accessibility API (AX) for `a11y`.
- accessibility parent/children, role/name/value/focus, and geometry.

The native window tree is generally less expressive than the Windows HWND tree, so more structural information may naturally live under `a11y`. The AAF grammar does not need to change.

### Linux

On X11, `window` maps naturally to the X Window hierarchy and window-manager properties, while `a11y` can map to AT-SPI.

On Wayland, the main difference is capability and permission rather than grammar. A normal client cannot assume that it may enumerate, focus, move, or inject input into arbitrary surfaces belonging to other applications. A Wayland backend exposes only what its compositor, portals, accessibility services, and environment permit.

Windows, macOS, and Linux therefore do not need identical native fields. AAF keeps one model while each backend exposes its supported subset or superset without changing scenario structure.

---

## 7. Design principles

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
- results stay simple, JSON-compatible, and reusable by later actions.

The goal is for an AAF scenario to stay readable by hand, easy to generate, and precise enough for robust desktop automation without becoming a general-purpose programming language.
