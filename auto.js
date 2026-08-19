// auto.js — Windows desktop automation for Deno, pure FFI.
// Current target: Windows x64 + Deno. No native addon, no C/C++, no dependencies.

if (Deno.build.os !== "windows" || Deno.build.arch !== "x86_64") throw new Error("auto.js currently supports Windows x64 only");

function dll(name, text) {
  const symbols = {};
  for (const spec of text.split(/[;\n]/).map((x) => x.trim()).filter(Boolean)) {
    const [symbol, result, ...parameters] = spec.split(/\s+/);
    symbols[symbol] = { parameters, result };
  }
  return Deno.dlopen(name, symbols);
}

const user32 = dll("user32.dll", `
EnumWindows i32 pointer pointer; EnumChildWindows i32 pointer pointer pointer; EnumDisplayMonitors i32 pointer pointer pointer pointer
GetMonitorInfoW i32 pointer buffer; GetWindowTextLengthW i32 pointer; GetWindowTextW i32 pointer buffer i32; GetClassNameW i32 pointer buffer i32
GetWindowThreadProcessId u32 pointer buffer; GetKeyboardLayout pointer u32; VkKeyScanExW i16 u16 pointer; MapVirtualKeyExW u32 u32 u32 pointer
GetWindowRect i32 pointer buffer; GetWindowLongW i32 pointer i32; SetWindowLongW i32 pointer i32 i32; GetWindow pointer pointer u32
GetClientRect i32 pointer buffer; ClientToScreen i32 pointer buffer; IsWindowVisible i32 pointer; IsWindowEnabled i32 pointer; IsIconic i32 pointer; IsZoomed i32 pointer
MonitorFromWindow pointer pointer u32; ShowWindow i32 pointer i32; SetWindowPos i32 pointer pointer i32 i32 i32 i32 u32
SetForegroundWindow i32 pointer; BringWindowToTop i32 pointer; SetFocus pointer pointer; GetForegroundWindow pointer; AttachThreadInput i32 u32 u32 i32
PostMessageW i32 pointer u32 usize isize; SendMessageTimeoutW isize pointer u32 usize pointer u32 u32 buffer
EnableWindow i32 pointer i32; SetLayeredWindowAttributes i32 pointer u32 u8 u32; GetDC pointer pointer; ReleaseDC i32 pointer pointer
RegisterClassExW u16 buffer; CreateWindowExW pointer u32 buffer buffer u32 i32 i32 i32 i32 pointer pointer pointer pointer
DefWindowProcW isize pointer u32 usize isize; DestroyWindow i32 pointer; UpdateWindow i32 pointer; FillRect i32 pointer buffer pointer; PrintWindow i32 pointer pointer u32
SetCursorPos i32 i32 i32; GetCursorPos i32 buffer; SendInput u32 u32 buffer i32; WindowFromPoint pointer u64; GetAncestor pointer pointer u32; SetProcessDPIAware i32
OpenClipboard i32 pointer; CloseClipboard i32; EmptyClipboard i32; GetClipboardData pointer u32; SetClipboardData pointer u32 pointer; IsClipboardFormatAvailable i32 u32
`);
const kernel32 = dll("kernel32.dll", `
OpenProcess pointer u32 i32 u32; QueryFullProcessImageNameW i32 pointer u32 buffer buffer; CloseHandle i32 pointer; GetCurrentThreadId u32
GlobalAlloc pointer u32 usize; GlobalLock pointer pointer; GlobalUnlock i32 pointer; GlobalFree pointer pointer; GetModuleHandleW pointer pointer; SetThreadExecutionState u32 u32
`);
const gdi32 = dll("gdi32.dll", `
CreateCompatibleDC pointer pointer; DeleteDC i32 pointer; CreateDIBSection pointer pointer buffer u32 buffer pointer u32; SelectObject pointer pointer pointer
DeleteObject i32 pointer; CreateSolidBrush pointer u32; BitBlt i32 pointer i32 i32 i32 i32 pointer i32 i32 u32
`);
const ntdll = dll("ntdll.dll", `RtlMoveMemory void pointer buffer usize`);
const wtsapi32 = dll("wtsapi32.dll", `WTSQuerySessionInformationW i32 pointer u32 u32 buffer buffer; WTSFreeMemory void pointer`);
const ole32 = dll("ole32.dll", `CoInitializeEx i32 pointer u32; CoCreateInstance i32 buffer pointer u32 buffer buffer`);
const oleaut32 = dll("oleaut32.dll", `
SysStringLen u32 pointer; SysFreeString void pointer; SafeArrayGetLBound i32 pointer u32 buffer; SafeArrayGetUBound i32 pointer u32 buffer
SafeArrayAccessData i32 pointer buffer; SafeArrayUnaccessData i32 pointer; SafeArrayDestroy i32 pointer; VariantClear i32 buffer
`);
const combase = dll("combase.dll", `
RoInitialize i32 u32; RoGetActivationFactory i32 pointer buffer buffer; WindowsCreateString i32 buffer u32 buffer
WindowsDeleteString i32 pointer; WindowsGetStringRawBuffer pointer pointer buffer
`);

try { user32.symbols.SetProcessDPIAware(); } catch { /* already configured is fine */ }

const textDecoder16 = new TextDecoder("utf-16le");
const POINTER_SIZE = 8, CF_UNICODETEXT = 13, PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, MONITOR_DEFAULTTONEAREST = 2;
const SRCCOPY = 0x00cc0020, PW_RENDERFULLCONTENT = 2;
const WM_CLOSE = 0x0010, WM_SETTEXT = 0x000c, WM_GETTEXT = 0x000d, WM_GETTEXTLENGTH = 0x000e;
const WM_LBUTTONDOWN = 0x0201, WM_LBUTTONUP = 0x0202, WM_RBUTTONDOWN = 0x0204, WM_RBUTTONUP = 0x0205;
const WM_MBUTTONDOWN = 0x0207, WM_MBUTTONUP = 0x0208, WM_MOUSEWHEEL = 0x020a;
const GA_PARENT = 1, GA_ROOT = 2, GW_OWNER = 4, GWL_STYLE = -16, GWL_EXSTYLE = -20;
const WS_CHILD = 0x40000000, WS_BORDER = 0x00800000, WS_DLGFRAME = 0x00400000, WS_CAPTION = WS_BORDER | WS_DLGFRAME;
const WS_THICKFRAME = 0x00040000, WS_SYSMENU = 0x00080000, WS_MINIMIZEBOX = 0x00020000, WS_MAXIMIZEBOX = 0x00010000;
const WS_EX_LAYERED = 0x00080000, LWA_ALPHA = 2;
const FRAME_STYLE_MASK = WS_BORDER | WS_DLGFRAME | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
const INPUT_MOUSE = 0, INPUT_KEYBOARD = 1, KEYEVENTF_EXTENDEDKEY = 1, KEYEVENTF_KEYUP = 2, KEYEVENTF_UNICODE = 4;
const MOUSEEVENTF_WHEEL = 0x0800, WHEEL_DELTA = 120;

function sleepSync(ms) {
  const a = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(a, 0, 0, ms);
}

function timeMs(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value !== "string") return fallback;
  const match = value.trim().match(/^(\d+(?:\.\d*)?|\.\d+)\s*(ms|s|m)$/i);
  if (!match) return fallback;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  return amount * (unit === "m" ? 60000 : unit === "s" ? 1000 : 1);
}

function delay(value) {
  return new Promise((resolve) => setTimeout(resolve, timeMs(value)));
}

export async function wait(options = 0) {
  if (typeof options !== "object" || options == null || Array.isArray(options)) {
    await delay(options);
    return true;
  }

  const kinds = ["window", "ocr", "image", "change"].filter((key) => options[key] != null);
  if (!kinds.length) {
    await delay(options.time ?? options.ms ?? 0);
    return true;
  }
  if (kinds.length !== 1) return null;

  const kind = kinds[0];
  const prepared = await prepareWaitCondition(kind, options[kind]);
  if (!prepared) return null;
  const timeout = timeMs(options.timeout, 10000);
  const interval = Math.max(1, timeMs(options.interval, 100));
  const until = performance.now() + timeout;

  for (;;) {
    const state = await testWaitCondition(kind, prepared);
    if (state.ready !== false && (options.not ? !state.matched : state.matched)) {
      return options.not ? true : state.value;
    }
    const remaining = until - performance.now();
    if (remaining <= 0) return null;
    await delay(Math.min(interval, remaining));
  }
}

function ptrValue(pointer) { return pointer ? Deno.UnsafePointer.value(pointer) : 0n; }
function ptrId(pointer) { return `0x${ptrValue(pointer).toString(16)}`; }

function asPointer(value) {
  if (!value) return null;
  if (typeof value === "object") value = value.wid ?? value.hwnd ?? value.handle;
  if (typeof value === "string") return Deno.UnsafePointer.create(BigInt(value));
  if (typeof value === "number") return Deno.UnsafePointer.create(BigInt(value));
  if (typeof value === "bigint") return Deno.UnsafePointer.create(value);
  return value;
}

function wide(text, nul = false) {
  const out = new Uint16Array(text.length + (nul ? 1 : 0));
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

function decodeWide(buffer, length = buffer.length) { return textDecoder16.decode(new Uint8Array(buffer.buffer, buffer.byteOffset, length * 2)); }

function rectFromBuffer(buffer) {
  const v = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const left = v.getInt32(0, true);
  const top = v.getInt32(4, true);
  const right = v.getInt32(8, true);
  const bottom = v.getInt32(12, true);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function windowText(hwnd) {
  const length = user32.symbols.GetWindowTextLengthW(hwnd);
  if (length <= 0) return "";
  const buffer = new Uint16Array(length + 1);
  const written = user32.symbols.GetWindowTextW(hwnd, buffer, buffer.length);
  return written > 0 ? decodeWide(buffer, written) : "";
}

function windowClass(hwnd) {
  const buffer = new Uint16Array(512);
  const written = user32.symbols.GetClassNameW(hwnd, buffer, buffer.length);
  return written > 0 ? decodeWide(buffer, written) : "";
}

function processPath(pid) {
  const handle = kernel32.symbols.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!handle) return "";
  try {
    const buffer = new Uint16Array(32768);
    const size = new Uint32Array([buffer.length]);
    if (!kernel32.symbols.QueryFullProcessImageNameW(handle, 0, buffer, size)) return "";
    return decodeWide(buffer, size[0]);
  } finally {
    kernel32.symbols.CloseHandle(handle);
  }
}

function displayRecords() {
  const found = [];
  const callback = new Deno.UnsafeCallback(
    { parameters: ["pointer", "pointer", "pointer", "pointer"], result: "i32" },
    (monitor) => {
      const info = new Uint8Array(104);
      const v = new DataView(info.buffer);
      v.setUint32(0, 104, true);
      if (!user32.symbols.GetMonitorInfoW(monitor, info)) return 1;

      const bounds = {
        x: v.getInt32(4, true),
        y: v.getInt32(8, true),
        width: v.getInt32(12, true) - v.getInt32(4, true),
        height: v.getInt32(16, true) - v.getInt32(8, true),
      };
      const work = {
        x: v.getInt32(20, true),
        y: v.getInt32(24, true),
        width: v.getInt32(28, true) - v.getInt32(20, true),
        height: v.getInt32(32, true) - v.getInt32(24, true),
      };
      const device = decodeWide(new Uint16Array(info.buffer, 40, 32)).split("\0", 1)[0];
      found.push({
        id: device,
        handle: ptrId(monitor),
        primary: !!(v.getUint32(36, true) & 1),
        ...bounds,
        work,
      });
      return 1;
    },
  );

  try {
    if (!user32.symbols.EnumDisplayMonitors(null, null, callback.pointer, null)) {
      throw new Error("EnumDisplayMonitors failed");
    }
  } finally {
    callback.close();
  }

  found.sort((a, b) => Number(b.primary) - Number(a.primary) || a.x - b.x || a.y - b.y);
  return found.map((display, index) => ({ index, ...display }));
}

export function display_find({ display } = {}) {
  const found = displayRecords().map(({ index, primary, width, height, work }) => ({ index, primary, width, height, work: { width: work.width, height: work.height } }));
  if (display == null) return found;
  const index = Number(typeof display === "object" ? display.index : display);
  return Number.isInteger(index) ? found.filter((x) => x.index === index) : [];
}

function resolveDisplay(display) {
  const list = displayRecords();
  if (!list.length) throw new Error("No displays found");
  if (display == null) return list[0];
  if (typeof display === "object") display = display.index;
  const index = Number(display);
  if (!Number.isInteger(index) || !list[index]) throw new Error(`Display ${display} not found`);
  return list[index];
}

function displayMap() { return new Map(displayRecords().map((x) => [x.handle.toLowerCase(), x])); }

function clientRect(hwnd) {
  if (!hwnd) return null;
  const rect = new Int32Array(4);
  if (!user32.symbols.GetClientRect(hwnd, rect)) return null;
  const origin = new Int32Array(2);
  if (!user32.symbols.ClientToScreen(hwnd, origin)) return null;
  return { x: origin[0], y: origin[1], width: rect[2] - rect[0], height: rect[3] - rect[1] };
}

function isChildWindow(hwnd) { return !!(user32.symbols.GetWindowLongW(hwnd, GWL_STYLE) & WS_CHILD); }
function windowParent(hwnd) { return isChildWindow(hwnd) ? user32.symbols.GetAncestor(hwnd, GA_PARENT) : null; }
function windowOwner(hwnd) { return isChildWindow(hwnd) ? null : user32.symbols.GetWindow(hwnd, GW_OWNER); }

function windowDepth(hwnd) {
  let depth = 0;
  let current = hwnd;
  const seen = new Set();
  while (current && isChildWindow(current) && depth < 256) {
    const parent = user32.symbols.GetAncestor(current, GA_PARENT);
    if (!parent) break;
    const key = ptrId(parent).toLowerCase();
    if (seen.has(key)) break;
    seen.add(key);
    depth++;
    current = parent;
  }
  return depth;
}

function getWindowInfo(hwnd, monitors = displayMap()) {
  if (!hwnd) return null;
  const pidOut = new Uint32Array(1);
  const tid = user32.symbols.GetWindowThreadProcessId(hwnd, pidOut);
  const pid = pidOut[0];
  const rectBuffer = new Uint8Array(16);
  const hasRect = !!user32.symbols.GetWindowRect(hwnd, rectBuffer);
  const rect = hasRect ? rectFromBuffer(rectBuffer) : { x: 0, y: 0, width: 0, height: 0 };
  const path = processPath(pid);
  const monitor = user32.symbols.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  const monitorId = monitor ? ptrId(monitor).toLowerCase() : "";
  const display = monitors.get(monitorId);
  const parent = windowParent(hwnd);
  const owner = windowOwner(hwnd);

  const minimized = !!user32.symbols.IsIconic(hwnd);
  const maximized = !!user32.symbols.IsZoomed(hwnd);
  const visible = !!user32.symbols.IsWindowVisible(hwnd);

  return {
    wid: ptrId(hwnd),
    wpid: parent ? ptrId(parent) : null,
    woid: owner ? ptrId(owner) : null,
    depth: windowDepth(hwnd),
    title: windowText(hwnd),
    class: windowClass(hwnd),
    pid,
    bin: path,
    display: display?.index ?? null,
    rect,
    status: minimized ? "minimized" : maximized ? "maximized" : "normal",
    hidden: !visible,
    foreground: ptrValue(user32.symbols.GetForegroundWindow()) === ptrValue(hwnd),
    _tid: tid,
  };
}

function publicWindow({ _tid, ...window }) { return window; }

function regexMatch(value, pattern) {
  try {
    return new RegExp(String(pattern), "i").test(String(value ?? ""));
  } catch {
    throw new Error(`Invalid regex: ${pattern}`);
  }
}

function normalizeWindowFilter(filter) {
  if (filter == null) return {};
  if (typeof filter === "string") return filter.startsWith("0x") ? { wid: filter } : { title: filter };
  if (typeof filter === "number" || typeof filter === "bigint") return { wid: ptrId(asPointer(filter)) };
  return filter;
}

function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
function sameWindowId(actual, expected) {
  return actual == null || expected == null ? actual == null && expected == null : String(actual).toLowerCase() === String(expected).toLowerCase();
}
function anyFilter(value, match) { const values = Array.isArray(value) ? value : [value]; return values.length > 0 && values.some(match); }
function regexFilter(value, patterns) { return anyFilter(patterns, (pattern) => regexMatch(value, pattern)); }

function relationSpec(spec, defaultDomain) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return null;
  let depth = 1;
  if (spec.depth != null) {
    if (String(spec.depth).toLowerCase() === "all") depth = Infinity;
    else {
      depth = Number(spec.depth);
      if (!Number.isInteger(depth) || depth < 1) return null;
    }
  }

  const hasWindow = own(spec, "window");
  const hasA11y = own(spec, "a11y");
  if (hasWindow && hasA11y) return null;

  if (hasWindow || hasA11y) {
    const domain = hasWindow ? "window" : "a11y";
    return { depth, domain, filter: spec[domain] ?? {} };
  }

  const filter = { ...spec };
  delete filter.depth;
  return { depth, domain: defaultDomain, filter };
}

function windowTree(records) {
  const byWid = new Map();
  const children = new Map();
  for (const record of records) {
    byWid.set(record.wid.toLowerCase(), record);
    if (record.wpid) {
      const key = record.wpid.toLowerCase();
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(record);
    }
  }
  return { byWid, children };
}

function matchesWindowUp(window, spec, tree) {
  const relation = relationSpec(spec, "window");
  if (!relation) return false;
  if (relation.domain === "a11y") return matchesWindowUiaRelation(window, "up", relation);

  let current = window;
  for (let depth = 1; depth <= relation.depth && current.wpid; depth++) {
    current = tree.byWid.get(current.wpid.toLowerCase());
    if (!current) break;
    if (matchesWindow(current, relation.filter, tree)) return true;
  }
  return false;
}

function matchesWindowDown(window, spec, tree) {
  const relation = relationSpec(spec, "window");
  if (!relation) return false;
  if (relation.domain === "a11y") return matchesWindowUiaRelation(window, "down", relation);

  const queue = (tree.children.get(window.wid.toLowerCase()) ?? []).map((child) => [child, 1]);
  for (let i = 0; i < queue.length; i++) {
    const [child, depth] = queue[i];
    if (matchesWindow(child, relation.filter, tree)) return true;
    if (depth < relation.depth) {
      for (const next of tree.children.get(child.wid.toLowerCase()) ?? []) queue.push([next, depth + 1]);
    }
  }
  return false;
}

function matchesWindow(w, filter, tree) {
  if (filter.wid != null && !anyFilter(filter.wid, (value) => sameWindowId(w.wid, value))) return false;
  if (own(filter, "wpid") && !anyFilter(filter.wpid, (value) => sameWindowId(w.wpid, value))) return false;
  if (own(filter, "woid") && !anyFilter(filter.woid, (value) => sameWindowId(w.woid, value))) return false;
  if (filter.depth != null) {
    const depths = Array.isArray(filter.depth) ? filter.depth : [filter.depth];
    if (!depths.some((value) => String(value).toLowerCase() === "all" || w.depth === Number(value))) return false;
  }
  if (filter.pid != null && !anyFilter(filter.pid, (value) => w.pid === Number(value))) return false;
  if (filter.title != null && !regexFilter(w.title, filter.title)) return false;
  if (filter.bin != null && !regexFilter(w.bin, filter.bin)) return false;
  if (filter.class != null && !regexFilter(w.class, filter.class)) return false;
  if (filter.display != null && !anyFilter(filter.display, (value) => w.display === resolveDisplay(value).index)) return false;
  if (filter.status != null && !anyFilter(filter.status, (value) => w.status === String(value).toLowerCase())) return false;
  if (filter.hidden != null && w.hidden !== !!filter.hidden) return false;
  if (filter.foreground != null && w.foreground !== !!filter.foreground) return false;
  if (filter.up != null && !matchesWindowUp(w, filter.up, tree)) return false;
  if (filter.down != null && !matchesWindowDown(w, filter.down, tree)) return false;
  return true;
}

function deepWindowFilter(filter) {
  return filter.wid != null || own(filter, "wpid") || filter.depth != null || filter.up != null || filter.down != null;
}

function windowRecords(filter = {}) {
  filter = normalizeWindowFilter(filter);
  const monitors = displayMap();
  const handles = [];
  const seen = new Set();
  const top = [];
  const add = (hwnd) => {
    const key = ptrId(hwnd).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    handles.push(hwnd);
  };
  const callback = new Deno.UnsafeCallback(
    { parameters: ["pointer", "pointer"], result: "i32" },
    (hwnd) => {
      if (isChildWindow(hwnd)) return 1;
      top.push(hwnd);
      add(hwnd);
      return 1;
    },
  );
  try {
    if (!user32.symbols.EnumWindows(callback.pointer, null)) throw new Error("EnumWindows failed");
  } finally {
    callback.close();
  }

  if (deepWindowFilter(filter)) {
    const childCallback = new Deno.UnsafeCallback(
      { parameters: ["pointer", "pointer"], result: "i32" },
      (hwnd) => {
        add(hwnd);
        return 1;
      },
    );
    try {
      for (const hwnd of top) user32.symbols.EnumChildWindows(hwnd, childCallback.pointer, null);
    } finally {
      childCallback.close();
    }
  }

  const records = handles.map((hwnd) => getWindowInfo(hwnd, monitors)).filter(Boolean);
  const tree = windowTree(records);
  return records.filter((window) => matchesWindow(window, filter, tree));
}

function findLimit(limit) {
  if (limit == null || limit === 0) return Infinity;
  return Number.isInteger(limit) && limit > 0 ? limit : null;
}

export function window_find({ window = {}, limit = 0 } = {}) {
  const max = findLimit(limit);
  if (max == null) return [];
  const found = windowRecords(window).map(publicWindow);
  return max === Infinity ? found : found.slice(0, max);
}

function windowMessageText(hwnd) {
  const result = new BigUint64Array(1);
  const flags = 0x0002 | 0x0001; // SMTO_ABORTIFHUNG | SMTO_BLOCK
  if (!user32.symbols.SendMessageTimeoutW(hwnd, WM_GETTEXTLENGTH, 0n, null, flags, 250, result)) return null;
  const length = Number(result[0]);
  if (!Number.isSafeInteger(length) || length < 0 || length > 1048576) return null;
  const buffer = new Uint16Array(length + 1);
  result[0] = 0n;
  if (!user32.symbols.SendMessageTimeoutW(
    hwnd,
    WM_GETTEXT,
    BigInt(buffer.length),
    Deno.UnsafePointer.of(buffer),
    flags,
    250,
    result,
  )) return null;
  return decodeWide(buffer, Math.min(Number(result[0]), length));
}

export function window_get({ window = {}, text = false } = {}) {
  const found = windowRecords(window)[0];
  if (!found) return null;
  const out = publicWindow(found);
  if (text) out.text = windowMessageText(asPointer(found.wid));
  return out;
}

export async function window_wait({ window = {}, timeout = 5000, interval = 50 } = {}) {
  return await wait({ window, timeout: timeout, interval });
}

function sessionLocked() {
  const buffer = new BigUint64Array(1);
  const bytes = new Uint32Array(1);
  if (!wtsapi32.symbols.WTSQuerySessionInformationW(null, 0xffffffff, 25, buffer, bytes) || !buffer[0]) return null;
  const pointer = Deno.UnsafePointer.create(buffer[0]);
  try {
    if (bytes[0] < 20) return null;
    const data = new DataView(new Deno.UnsafePointerView(pointer).getArrayBuffer(bytes[0]));
    if (data.getUint32(0, true) !== 1) return null;
    const state = data.getInt32(16, true);
    return state === 0 ? true : state === 1 ? false : null;
  } finally {
    wtsapi32.symbols.WTSFreeMemory(pointer);
  }
}

export function system({ wake, awake } = {}) {
  if (wake != null && awake != null) return null;
  if (wake != null) {
    if (wake !== true) return null;
    if (!kernel32.symbols.SetThreadExecutionState(0x00000003)) return null;
    return { locked: sessionLocked(), wake: true };
  }
  if (awake != null) {
    if (typeof awake !== "boolean") return null;
    const flags = awake ? 0x80000003 : 0x80000000;
    if (!kernel32.symbols.SetThreadExecutionState(flags)) return null;
    return { locked: sessionLocked(), awake };
  }
  return { locked: sessionLocked() };
}

function focusWindow(info) {
  const hwnd = asPointer(info.wid);
  const currentTid = kernel32.symbols.GetCurrentThreadId();
  const targetTid = info._tid;

  for (let attempt = 0; attempt < 3; attempt++) {
    const foreground = user32.symbols.GetForegroundWindow();
    const foregroundPid = new Uint32Array(1);
    const foregroundTid = foreground
      ? user32.symbols.GetWindowThreadProcessId(foreground, foregroundPid)
      : 0;
    const attached = [];

    try {
      if (foregroundTid && foregroundTid !== currentTid) {
        if (user32.symbols.AttachThreadInput(currentTid, foregroundTid, 1)) attached.push(foregroundTid);
      }
      if (targetTid !== currentTid && targetTid !== foregroundTid) {
        if (user32.symbols.AttachThreadInput(currentTid, targetTid, 1)) attached.push(targetTid);
      }

      user32.symbols.ShowWindow(hwnd, 9);
      user32.symbols.BringWindowToTop(hwnd);
      user32.symbols.SetForegroundWindow(hwnd);
      user32.symbols.SetFocus(hwnd);
    } finally {
      for (const tid of attached.reverse()) user32.symbols.AttachThreadInput(currentTid, tid, 0);
    }

    sleepSync(30);
    if (ptrValue(user32.symbols.GetForegroundWindow()) === ptrValue(hwnd)) return;
  }

  const actual = user32.symbols.GetForegroundWindow();
  throw new Error(`Failed to focus ${info.wid}; foreground is ${actual ? ptrId(actual) : "none"}`);
}

export function window_control({ window = {}, display, action, pos, rect } = {}) {
  const info = windowRecords(window)[0];
  if (!info) return null;
  const hwnd = asPointer(info.wid);
  const geometry = geometryContext(info, display);
  switch (action) {
    case "restore": user32.symbols.ShowWindow(hwnd, 9); break;
    case "minimize": user32.symbols.ShowWindow(hwnd, 6); break;
    case "maximize": user32.symbols.ShowWindow(hwnd, 3); break;
    case "focus":
      try { focusWindow(info); } catch { /* best effort */ }
      break;
    case "move":
    case "size": {
      const shaped = resolveRect(rect, info.rect, geometry);
      const next = positionRect(shaped, pos, geometry);
      if (next.width > 0 && next.height > 0) {
        const SWP_NOZORDER = 0x0004;
        const SWP_NOACTIVATE = 0x0010;
        user32.symbols.SetWindowPos(hwnd, null, next.x, next.y, next.width, next.height, SWP_NOZORDER | SWP_NOACTIVATE);
      }
      break;
    }
    case "close": user32.symbols.PostMessageW(hwnd, WM_CLOSE, 0n, 0n); break;
    default: break;
  }
  return window_get({ window: { wid: info.wid } });
}

const WINDOW_FRAMES = {
  none: 0,
  border: WS_BORDER,
  caption: WS_CAPTION | WS_SYSMENU,
  resizable: WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX,
};

function setWindowTitle(hwnd, title) {
  const text = wide(String(title), true);
  const result = new BigUint64Array(1);
  return !!user32.symbols.SendMessageTimeoutW(
    hwnd,
    WM_SETTEXT,
    0n,
    Deno.UnsafePointer.of(text),
    0x0002 | 0x0001,
    250,
    result,
  );
}

function setWindowFrame(hwnd, frame) {
  const bits = WINDOW_FRAMES[String(frame).toLowerCase()];
  if (bits == null) return false;
  const current = user32.symbols.GetWindowLongW(hwnd, GWL_STYLE) >>> 0;
  const next = ((current & ~FRAME_STYLE_MASK) | bits) >>> 0;
  user32.symbols.SetWindowLongW(hwnd, GWL_STYLE, next | 0);
  const SWP_NOSIZE = 0x0001;
  const SWP_NOMOVE = 0x0002;
  const SWP_NOZORDER = 0x0004;
  const SWP_NOACTIVATE = 0x0010;
  const SWP_FRAMECHANGED = 0x0020;
  return !!user32.symbols.SetWindowPos(
    hwnd,
    null,
    0,
    0,
    0,
    0,
    SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
  );
}

function setWindowTopmost(hwnd, value) {
  const SWP_NOSIZE = 0x0001;
  const SWP_NOMOVE = 0x0002;
  const SWP_NOACTIVATE = 0x0010;
  const after = Deno.UnsafePointer.create(value ? 0xffffffffffffffffn : 0xfffffffffffffffen);
  return !!user32.symbols.SetWindowPos(hwnd, after, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
}

function setWindowOpacity(hwnd, opacity) {
  opacity = Number(opacity);
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return false;
  const ex = user32.symbols.GetWindowLongW(hwnd, GWL_EXSTYLE) >>> 0;
  if (!(ex & WS_EX_LAYERED)) user32.symbols.SetWindowLongW(hwnd, GWL_EXSTYLE, (ex | WS_EX_LAYERED) | 0);
  return !!user32.symbols.SetLayeredWindowAttributes(hwnd, 0, Math.round(opacity * 255), LWA_ALPHA);
}

export async function window_set({ window = {}, title, frame, topmost, opacity, enabled, highlight: mark } = {}) {
  const info = windowRecords(window)[0];
  if (!info) return null;
  const hwnd = asPointer(info.wid);

  if (title != null) setWindowTitle(hwnd, title);
  if (frame != null) setWindowFrame(hwnd, frame);
  if (topmost != null) setWindowTopmost(hwnd, !!topmost);
  if (opacity != null) setWindowOpacity(hwnd, opacity);
  if (enabled != null) user32.symbols.EnableWindow(hwnd, enabled ? 1 : 0);

  if (mark) {
    const duration = mark === true ? 800 : mark;
    await highlight({ window: { wid: info.wid }, duration });
  }

  return window_get({ window: { wid: info.wid } });
}

export function window_hit({ pos, display, child = false } = {}) {
  const cursor = new Int32Array(2);
  if (!user32.symbols.GetCursorPos(cursor)) return null;
  const from = { x: cursor[0], y: cursor[1] };
  const geometry = geometryContext(null, display);
  let relative = from;
  if (display != null || pos?.at != null) relative = geometryAnchor(geometry, pos?.at, geometry.display);
  const fallback = pos?.at == null ? from : relative;
  const p = resolvePos(pos, relative, geometry, fallback);
  const packed = (BigInt(p.y >>> 0) << 32n) | BigInt(p.x >>> 0);
  let hwnd = user32.symbols.WindowFromPoint(packed);
  if (!hwnd) return null;
  if (!child) hwnd = user32.symbols.GetAncestor(hwnd, GA_ROOT) || hwnd;
  return publicWindow(getWindowInfo(hwnd));
}

const HIGHLIGHT_CLASS = "AAF.Highlight";
const HIGHLIGHT_THICKNESS = 3;
let highlightClass = 0;
let highlightBrush = null;
let highlightWndProc = null;

function ensureHighlightClass() {
  if (highlightClass) return;
  const instance = kernel32.symbols.GetModuleHandleW(null);
  if (!instance) throw new Error("GetModuleHandleW failed");
  highlightBrush ??= gdi32.symbols.CreateSolidBrush(0x000000ff); // COLORREF red
  if (!highlightBrush) throw new Error("CreateSolidBrush failed");

  highlightWndProc ??= new Deno.UnsafeCallback(
    { parameters: ["pointer", "u32", "usize", "isize"], result: "isize" },
    (hwnd, message, wParam, lParam) => {
      if (message === 0x0084) return -1n; // WM_NCHITTEST -> HTTRANSPARENT
      return user32.symbols.DefWindowProcW(hwnd, message, wParam, lParam);
    },
  );

  const name = wide(HIGHLIGHT_CLASS, true);
  const wc = new Uint8Array(80);
  const v = new DataView(wc.buffer);
  v.setUint32(0, 80, true);
  v.setBigUint64(8, Deno.UnsafePointer.value(highlightWndProc.pointer), true);
  v.setBigUint64(24, Deno.UnsafePointer.value(instance), true);
  v.setBigUint64(48, Deno.UnsafePointer.value(highlightBrush), true);
  v.setBigUint64(64, Deno.UnsafePointer.value(Deno.UnsafePointer.of(name)), true);
  highlightClass = user32.symbols.RegisterClassExW(wc);
  if (!highlightClass) throw new Error("RegisterClassExW(highlight) failed");
}

function createHighlightRect(rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return [];
  ensureHighlightClass();
  const name = wide(HIGHLIGHT_CLASS, true);
  const title = wide("", true);
  const exStyle = 0x00000008 | 0x00000020 | 0x00000080 | 0x08000000; // TOPMOST | TRANSPARENT | TOOLWINDOW | NOACTIVATE
  const style = (0x80000000 | 0x10000000) >>> 0; // POPUP | VISIBLE
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const t = Math.min(HIGHLIGHT_THICKNESS, width, height);
  const segments = [
    [x, y, width, t],
    [x, y + height - t, width, t],
    [x, y + t, t, Math.max(1, height - 2 * t)],
    [x + width - t, y + t, t, Math.max(1, height - 2 * t)],
  ];
  const instance = kernel32.symbols.GetModuleHandleW(null);
  const windows = [];
  try {
    for (const [left, top, w, h] of segments) {
      const hwnd = user32.symbols.CreateWindowExW(
        exStyle,
        name,
        title,
        style,
        left,
        top,
        w,
        h,
        null,
        null,
        instance,
        null,
      );
      if (!hwnd) throw new Error("CreateWindowExW(highlight) failed");
      windows.push(hwnd);
      user32.symbols.UpdateWindow(hwnd);
      const dc = user32.symbols.GetDC(hwnd);
      if (dc) {
        try {
          user32.symbols.FillRect(dc, new Int32Array([0, 0, w, h]), highlightBrush);
        } finally {
          user32.symbols.ReleaseDC(hwnd, dc);
        }
      }
    }
    return windows;
  } catch (error) {
    for (const hwnd of windows) user32.symbols.DestroyWindow(hwnd);
    throw error;
  }
}

export async function highlight({ window, a11y, duration = 800 } = {}) {
  if ((window == null) === (a11y == null)) return null;

  const target = window != null ? window_get({ window }) : a11y_find({ a11y })[0];
  if (!target?.rect) return null;
  const overlays = createHighlightRect(target.rect);
  if (!overlays.length) return null;
  try {
    await delay(timeMs(duration, 800));
  } finally {
    for (const hwnd of overlays) user32.symbols.DestroyWindow(hwnd);
  }

  return {
    ...(target.wid ? { wid: target.wid } : {}),
    ...(target.uid ? { uid: target.uid } : {}),
    rect: target.rect,
  };
}

function captureArea(options = {}) {
  const info = options.window == null ? null : windowRecords(options.window)[0];
  if (options.window != null && !info) return null;

  if (options.rect) {
    const geometry = geometryContext(info, options.display);
    const base = info?.rect ?? geometry.display;
    if (!base) return null;
    const rect = resolveRect(options.rect, base, geometry);
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { kind: "screen", ...rect };
  }

  if (info) {
    return {
      kind: "window",
      hwnd: asPointer(info.wid),
      x: info.rect.x,
      y: info.rect.y,
      width: info.rect.width,
      height: info.rect.height,
    };
  }

  if (options.all || options.desktop === "all") {
    const ds = displayRecords();
    const left = Math.min(...ds.map((d) => d.x));
    const top = Math.min(...ds.map((d) => d.y));
    const right = Math.max(...ds.map((d) => d.x + d.width));
    const bottom = Math.max(...ds.map((d) => d.y + d.height));
    return { kind: "screen", x: left, y: top, width: right - left, height: bottom - top };
  }

  try {
    const d = resolveDisplay(options.display);
    return { kind: "screen", x: d.x, y: d.y, width: d.width, height: d.height, display: d };
  } catch {
    return null;
  }
}

function grayscaleBGRA(data) {
  const out = data.slice();
  for (let i = 0; i < out.length; i += 4) {
    const y = (29 * out[i] + 150 * out[i + 1] + 77 * out[i + 2]) >> 8;
    out[i] = out[i + 1] = out[i + 2] = y;
  }
  return out;
}

function captureScreenshot(options = {}) {
  const area = captureArea(options);
  if (!area) return null;
  const { width, height } = area;
  if (width <= 0 || height <= 0) return null;

  const screenDC = user32.symbols.GetDC(null);
  if (!screenDC) throw new Error("GetDC failed");
  const memoryDC = gdi32.symbols.CreateCompatibleDC(screenDC);
  if (!memoryDC) {
    user32.symbols.ReleaseDC(null, screenDC);
    throw new Error("CreateCompatibleDC failed");
  }

  const bmi = new Uint8Array(40);
  const v = new DataView(bmi.buffer);
  v.setUint32(0, 40, true);
  v.setInt32(4, width, true);
  v.setInt32(8, -height, true); // top-down BGRA
  v.setUint16(12, 1, true);
  v.setUint16(14, 32, true);
  v.setUint32(16, 0, true);

  const bitsOut = new BigUint64Array(1);
  const bitmap = gdi32.symbols.CreateDIBSection(screenDC, bmi, 0, bitsOut, null, 0);
  if (!bitmap || !bitsOut[0]) {
    gdi32.symbols.DeleteDC(memoryDC);
    user32.symbols.ReleaseDC(null, screenDC);
    throw new Error("CreateDIBSection failed");
  }

  const old = gdi32.symbols.SelectObject(memoryDC, bitmap);
  try {
    let ok;
    if (area.kind === "window") {
      ok = user32.symbols.PrintWindow(area.hwnd, memoryDC, PW_RENDERFULLCONTENT);
      if (!ok) ok = gdi32.symbols.BitBlt(memoryDC, 0, 0, width, height, screenDC, area.x, area.y, SRCCOPY);
    } else {
      ok = gdi32.symbols.BitBlt(memoryDC, 0, 0, width, height, screenDC, area.x, area.y, SRCCOPY);
    }
    if (!ok) throw new Error("Screenshot capture failed");

    const bits = Deno.UnsafePointer.create(bitsOut[0]);
    let data = new Uint8Array(new Deno.UnsafePointerView(bits).getArrayBuffer(width * height * 4)).slice();
    if (options.grayscale) data = grayscaleBGRA(data);
    return {
      rect: { x: area.x, y: area.y, width, height },
      format: "bgra8",
      grayscale: !!options.grayscale,
      data,
    };
  } finally {
    if (old) gdi32.symbols.SelectObject(memoryDC, old);
    gdi32.symbols.DeleteObject(bitmap);
    gdi32.symbols.DeleteDC(memoryDC);
    user32.symbols.ReleaseDC(null, screenDC);
  }
}

let crcTable;
function crc32(data) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(...parts) {
  const size = parts.reduce((n, x) => n + x.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function pngChunk(type, data) {
  const name = new TextEncoder().encode(type);
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, data.length, false);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(concat(name, data)), false);
  return concat(head, name, data, crc);
}

async function png(image) {
  const { width, height } = image.rect;
  const { data, grayscale } = image;
  const channels = grayscale ? 1 : 4;
  const stride = width * channels + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    let dst = y * stride;
    raw[dst++] = 0;
    let src = y * width * 4;
    for (let x = 0; x < width; x++, src += 4) {
      if (grayscale) {
        raw[dst++] = data[src];
      } else {
        raw[dst++] = data[src + 2];
        raw[dst++] = data[src + 1];
        raw[dst++] = data[src];
        raw[dst++] = data[src + 3];
      }
    }
  }

  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width, false);
  v.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = grayscale ? 0 : 6;
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return concat(signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", compressed), pngChunk("IEND", new Uint8Array()));
}

async function saveImage(image, path, format = "png") {
  if (!path) return {};
  if (String(format).toLowerCase() !== "png") throw new Error(`Unsupported image format: ${format}`);
  const bytes = await png(image);
  await Deno.writeFile(path, bytes);
  return { path, bytes: bytes.length };
}

function mouseInput(flags, data = 0) {
  const input = new Uint8Array(40);
  const v = new DataView(input.buffer);
  v.setUint32(0, INPUT_MOUSE, true);
  v.setUint32(8 + 8, data >>> 0, true);
  v.setUint32(8 + 12, flags >>> 0, true);
  if (user32.symbols.SendInput(1, input, 40) !== 1) throw new Error("SendInput(mouse) failed");
}

function geometryContext(windowInfo, display) {
  let explicitDisplay = null;
  if (display != null) {
    try { explicitDisplay = resolveDisplay(display); } catch { /* best effort */ }
  }

  let displayRect = explicitDisplay;
  if (!displayRect && windowInfo?.display != null) {
    try { displayRect = resolveDisplay({ index: windowInfo.display }); } catch { /* best effort */ }
  }
  if (!displayRect) {
    try { displayRect = resolveDisplay(); } catch { /* best effort */ }
  }

  return {
    window: windowInfo?.rect ?? null,
    client: windowInfo ? clientRect(asPointer(windowInfo.wid)) : null,
    display: displayRect,
    explicitDisplay,
  };
}

function geometryReference(context, suffix) {
  const kind = (suffix || (context.window ? "W" : "D")).toUpperCase();
  if (kind === "W") return context.window;
  if (kind === "WC") return context.client;
  if (kind === "D") return context.display;
  return null;
}

function geometryValue(value, axis, current, context, size = false) {
  if (value == null) return Math.round(current);

  if (typeof value === "number" && Number.isFinite(value)) {
    if (size) return Math.round(value);
    const origin = context.explicitDisplay?.[axis] ?? 0;
    return Math.round(origin + value);
  }

  if (typeof value !== "string") return Math.round(current);

  const percent = value.match(/^([+-]?)(\d+(?:\.\d*)?|\.\d+)%(WC|W|D)?$/i);
  if (percent) {
    const [, sign, amount, suffix] = percent;
    const reference = geometryReference(context, suffix);
    if (!reference) return Math.round(current);
    const dimension = axis === "x" ? reference.width : reference.height;
    const delta = Number(amount) / 100 * dimension;
    if (sign) return Math.round(current + (sign === "-" ? -delta : delta));
    if (size) return Math.round(delta);
    return Math.round(reference[axis] + delta);
  }

  const absolute = value.match(/^(\d+(?:\.\d*)?|\.\d+)(WC|W|D)$/i);
  if (absolute) {
    const [, amount, suffix] = absolute;
    const reference = geometryReference(context, suffix);
    if (!reference) return Math.round(current);
    if (size) return Math.round(Number(amount));
    return Math.round(reference[axis] + Number(amount));
  }

  if (/^[+-](?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    return Math.round(current + Number(value));
  }

  return Math.round(current);
}

function resolvePos(pos, relative, context, fallback = relative) {
  return {
    x: pos?.x == null ? Math.round(fallback.x) : geometryValue(pos.x, "x", relative.x, context),
    y: pos?.y == null ? Math.round(fallback.y) : geometryValue(pos.y, "y", relative.y, context),
  };
}

const ANCHORS = {
  "top-left": [0, 0],
  top: [0.5, 0],
  "top-right": [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  "bottom-left": [0, 1],
  bottom: [0.5, 1],
  "bottom-right": [1, 1],
};

function anchorSpec(at) {
  const value = String(at ?? "top-left").toLowerCase();
  const match = value.match(/^(top-left|top|top-right|left|center|right|bottom-left|bottom|bottom-right)(wc|w|d)?$/);
  const name = match?.[1] ?? "top-left";
  return { factors: ANCHORS[name], suffix: match?.[2]?.toUpperCase() ?? null };
}

function anchorFactors(at) {
  return anchorSpec(at).factors;
}

function rectAnchor(rect, at) {
  const [fx, fy] = anchorFactors(at);
  return {
    x: rect.x + rect.width * fx,
    y: rect.y + rect.height * fy,
  };
}

function geometryAnchor(context, at, fallback) {
  const spec = anchorSpec(at);
  const reference = spec.suffix ? geometryReference(context, spec.suffix) : fallback;
  return rectAnchor(reference ?? fallback, at);
}

function resolveRectAxis(rect, base, context, axis) {
  const horizontal = axis === "x";
  const startKey = horizontal ? "left" : "top";
  const endKey = horizontal ? "right" : "bottom";
  const sizeKey = horizontal ? "width" : "height";
  const posKey = axis;
  const start = base[axis];
  const size = base[sizeKey];
  const end = start + size;
  const [fx, fy] = anchorFactors(rect.at);
  const factor = horizontal ? fx : fy;

  if (rect[startKey] != null || rect[endKey] != null) {
    const nextStart = rect[startKey] == null
      ? start
      : geometryValue(rect[startKey], axis, start, context);
    let nextEnd;
    if (rect[endKey] != null) {
      nextEnd = geometryValue(rect[endKey], axis, end, context);
    } else if (rect[sizeKey] != null) {
      nextEnd = nextStart + geometryValue(rect[sizeKey], axis, size, context, true);
    } else {
      nextEnd = end;
    }
    return [nextStart, nextEnd];
  }

  const nextSize = rect[sizeKey] == null
    ? size
    : geometryValue(rect[sizeKey], axis, size, context, true);
  const currentAnchor = geometryAnchor(context, rect.at, base)[axis];
  const nextAnchor = rect[posKey] == null
    ? currentAnchor
    : geometryValue(rect[posKey], axis, currentAnchor, context);
  const nextStart = nextAnchor - nextSize * factor;
  return [nextStart, nextStart + nextSize];
}

function resolveRect(rect, base, context) {
  rect ??= {};
  const [left, right] = resolveRectAxis(rect, base, context, "x");
  const [top, bottom] = resolveRectAxis(rect, base, context, "y");
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

function positionRect(rect, pos, context) {
  if (!pos || (pos.x == null && pos.y == null)) return rect;
  const anchor = geometryAnchor(context, pos.at, rect);
  const to = resolvePos(pos, anchor, context, anchor);
  return {
    x: Math.round(rect.x + to.x - anchor.x),
    y: Math.round(rect.y + to.y - anchor.y),
    width: rect.width,
    height: rect.height,
  };
}

export async function mouse_move({ pos, display, duration = 0, steps, window } = {}) {
  duration = timeMs(duration);
  const p = new Int32Array(2);
  if (!user32.symbols.GetCursorPos(p)) return null;
  const from = { x: p[0], y: p[1] };

  const info = window == null ? null : windowRecords(window)[0];
  if (window != null && !info) return { pos: from };
  const geometry = geometryContext(info, display);

  let relative = from;
  const anchorRect = info?.rect ?? (display != null || pos?.at != null ? geometry.display : null);
  if (anchorRect) relative = geometryAnchor(geometry, pos?.at, anchorRect);
  const fallback = pos?.at == null ? from : relative;
  const to = resolvePos(pos, relative, geometry, fallback);

  if (duration <= 0) {
    return { pos: user32.symbols.SetCursorPos(to.x, to.y) ? to : from };
  }

  steps ??= Math.max(2, Math.round(duration / 16));
  const delay = duration / steps;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(from.x + (to.x - from.x) * t);
    const y = Math.round(from.y + (to.y - from.y) * t);
    user32.symbols.SetCursorPos(x, y);
    if (i < steps) await wait({ ms: delay });
  }
  return { pos: to };
}

const mouseButtons = {
  left: { input: [0x0002, 0x0004], message: [WM_LBUTTONDOWN, WM_LBUTTONUP], state: 0x0001 },
  right: { input: [0x0008, 0x0010], message: [WM_RBUTTONDOWN, WM_RBUTTONUP], state: 0x0002 },
  middle: { input: [0x0020, 0x0040], message: [WM_MBUTTONDOWN, WM_MBUTTONUP], state: 0x0010 },
};

function mousePoint(info, display, pos) {
  const cursor = new Int32Array(2);
  if (!user32.symbols.GetCursorPos(cursor)) return null;
  const from = { x: cursor[0], y: cursor[1] };
  const geometry = geometryContext(info, display);
  const target = info ? { at: "centerWC", ...(pos ?? {}) } : pos;
  let relative = from;
  const anchorRect = info?.rect ?? (display != null || target?.at != null ? geometry.display : null);
  if (anchorRect) relative = geometryAnchor(geometry, target?.at, anchorRect);
  const fallback = target?.at == null ? from : relative;
  return resolvePos(target, relative, geometry, fallback);
}

function packMousePoint(pos) {
  const packed = ((pos.x & 0xffff) | ((pos.y & 0xffff) << 16)) >>> 0;
  return BigInt(packed);
}

function postMouseButton(hwnd, button, down, screenPos) {
  const spec = mouseButtons[button];
  const client = clientRect(hwnd);
  if (!client) throw new Error("GetClientRect failed");
  const pos = { x: screenPos.x - client.x, y: screenPos.y - client.y };
  const ok = user32.symbols.PostMessageW(
    hwnd,
    spec.message[down ? 0 : 1],
    BigInt(down ? spec.state : 0),
    packMousePoint(pos),
  );
  if (!ok) throw new Error("PostMessage(mouse button) failed");
}

function postMouseWheel(hwnd, amount, screenPos) {
  const delta = Math.round(amount * WHEEL_DELTA);
  const wParam = BigInt(((delta & 0xffff) << 16) >>> 0);
  if (!user32.symbols.PostMessageW(hwnd, WM_MOUSEWHEEL, wParam, packMousePoint(screenPos))) {
    throw new Error("PostMessage(mouse wheel) failed");
  }
}

export function mouse_button({ click, down, up, wheel, window, display, pos, repeat = 1, interval = 0 } = {}) {
  const actions = [["click", click], ["down", down], ["up", up], ["wheel", wheel]].filter(([, value]) => value != null);
  if (actions.length !== 1) throw new Error("mouse_button requires exactly one of click, down, up, wheel");

  const [action, value] = actions[0];
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error(`Invalid repeat: ${repeat}`);
  if (repeat !== 1 && action !== "click") throw new Error("mouse_button repeat is only valid with click");
  interval = timeMs(interval);
  const info = window == null ? null : windowRecords(window)[0];
  if (window != null && !info) return null;
  const point = mousePoint(info, display, pos);
  if (!point) return null;
  const direct = !!info;

  if (!direct && pos != null && !user32.symbols.SetCursorPos(point.x, point.y)) return null;

  if (action === "wheel") {
    const amount = Number(value);
    if (!Number.isFinite(amount)) throw new Error(`Invalid wheel amount: ${value}`);
    if (direct) postMouseWheel(asPointer(info.wid), amount, point);
    else mouseInput(MOUSEEVENTF_WHEEL, Math.round(amount * WHEEL_DELTA));
    return { wheel: amount, ...(direct ? { wid: info.wid } : {}), pos: point };
  }

  const button = String(value).toLowerCase();
  const spec = mouseButtons[button];
  if (!spec) throw new Error(`Unknown mouse button: ${value}`);

  const send = (isDown) => {
    if (direct) postMouseButton(asPointer(info.wid), button, isDown, point);
    else mouseInput(spec.input[isDown ? 0 : 1]);
  };

  if (action === "click") {
    for (let i = 0; i < repeat; i++) {
      send(true);
      send(false);
      if (interval > 0 && i + 1 < repeat) sleepSync(interval);
    }
  } else {
    send(action === "down");
  }

  return {
    [action]: button,
    ...(repeat !== 1 ? { repeat } : {}),
    ...(direct ? { wid: info.wid } : {}),
    pos: point,
  }; 
}

const VK = {
  backspace: 0x08, back: 0x08, tab: 0x09, clear: 0x0c, enter: 0x0d, return: 0x0d,
  shift: 0x10, ctrl: 0x11, control: 0x11, alt: 0x12, pause: 0x13, capslock: 0x14,
  escape: 0x1b, esc: 0x1b, space: 0x20, pageup: 0x21, pgup: 0x21, pagedown: 0x22,
  pgdn: 0x22, end: 0x23, home: 0x24, left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  select: 0x29, print: 0x2a, execute: 0x2b, printscreen: 0x2c, prtsc: 0x2c, snapshot: 0x2c,
  insert: 0x2d, ins: 0x2d, delete: 0x2e, del: 0x2e, help: 0x2f,
  lwin: 0x5b, rwin: 0x5c, win: 0x5b, apps: 0x5d, contextmenu: 0x5d, sleep: 0x5f,
  multiply: 0x6a, add: 0x6b, separator: 0x6c, subtract: 0x6d, decimal: 0x6e, divide: 0x6f,
  numlock: 0x90, scrolllock: 0x91,
  lshift: 0xa0, rshift: 0xa1, lctrl: 0xa2, rctrl: 0xa3, lalt: 0xa4, ralt: 0xa5, altgr: 0xa5,
  browserback: 0xa6, browserforward: 0xa7, browserrefresh: 0xa8, browserstop: 0xa9,
  browsersearch: 0xaa, browserfavorites: 0xab, browserhome: 0xac,
  volumemute: 0xad, volumedown: 0xae, volumeup: 0xaf,
  medianext: 0xb0, mediaprev: 0xb1, mediastop: 0xb2, mediaplaypause: 0xb3,
  launchmail: 0xb4, launchmedia: 0xb5, launchapp1: 0xb6, launchapp2: 0xb7,
  oem1: 0xba, oemplus: 0xbb, oemcomma: 0xbc, oemminus: 0xbd, oemperiod: 0xbe,
  oem2: 0xbf, oem3: 0xc0, oem4: 0xdb, oem5: 0xdc, oem6: 0xdd, oem7: 0xde,
  oem8: 0xdf, oem102: 0xe2,
};
for (let i = 0; i <= 9; i++) {
  VK[String(i)] = 0x30 + i;
  VK[`numpad${i}`] = 0x60 + i;
}
for (let i = 0; i < 26; i++) VK[String.fromCharCode(97 + i)] = 0x41 + i;
for (let i = 1; i <= 24; i++) VK[`f${i}`] = 0x6f + i;

function keyboardInput(vk, scan, flags) {
  const input = new Uint8Array(40);
  const v = new DataView(input.buffer);
  v.setUint32(0, INPUT_KEYBOARD, true);
  v.setUint16(8, vk, true);
  v.setUint16(10, scan, true);
  v.setUint32(12, flags, true);
  if (user32.symbols.SendInput(1, input, 40) !== 1) throw new Error("SendInput(keyboard) failed");
}

function foregroundKeyboardLayout() {
  const foreground = user32.symbols.GetForegroundWindow();
  const pid = new Uint32Array(1);
  const tid = foreground ? user32.symbols.GetWindowThreadProcessId(foreground, pid) : 0;
  return user32.symbols.GetKeyboardLayout(tid);
}

function virtualKey(name) {
  if (typeof name === "number") return name;
  return VK[String(name).toLowerCase()] ?? null;
}

function keyFlags(vk, layout, up = false) {
  const scan = user32.symbols.MapVirtualKeyExW(vk, 4, layout);
  const extended = ((scan >>> 8) & 0xff) === 0xe0 || ((scan >>> 8) & 0xff) === 0xe1;
  return (extended ? KEYEVENTF_EXTENDEDKEY : 0) | (up ? KEYEVENTF_KEYUP : 0);
}

function sendVirtualKey(vk, down, layout = foregroundKeyboardLayout()) {
  keyboardInput(vk, 0, keyFlags(vk, layout, !down));
}

function characterKeys(text, layout) {
  if (typeof text !== "string" || [...text].length !== 1 || text.length !== 1) return null;
  const mapped = user32.symbols.VkKeyScanExW(text.charCodeAt(0), layout);
  if (mapped === -1) return null;
  const value = mapped & 0xffff;
  const vk = value & 0xff;
  const state = (value >>> 8) & 0xff;
  const keys = [];
  if ((state & 0x06) === 0x06) keys.push(0xa5); // AltGr / right Alt on layouts using Ctrl+Alt.
  else {
    if (state & 0x02) keys.push(0x11);
    if (state & 0x04) keys.push(0x12);
  }
  if (state & 0x01) keys.push(0x10);
  keys.push(vk);
  return keys;
}

function keySequence(name, layout) {
  const vk = virtualKey(name);
  if (vk != null) return [vk];
  return characterKeys(name, layout);
}

function keyState(name, down) {
  const layout = foregroundKeyboardLayout();
  const keys = keySequence(name, layout);
  if (!keys || keys.length !== 1) return false;
  try {
    sendVirtualKey(keys[0], down, layout);
    return true;
  } catch {
    return false;
  }
}

function keyNames(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

async function pressKeys(value) {
  const layout = foregroundKeyboardLayout();
  const requested = keyNames(value);
  const sequence = [];
  const accepted = [];
  const active = new Set();
  for (const name of requested) {
    const keys = keySequence(name, layout);
    if (!keys) continue;
    accepted.push(name);
    for (const vk of keys) {
      if (active.has(vk)) continue;
      sendVirtualKey(vk, true, layout);
      active.add(vk);
      sequence.push(vk);
    }
  }
  for (const vk of sequence.reverse()) sendVirtualKey(vk, false, layout);
  return accepted;
}

function typeCodeUnit(code) {
  try {
    keyboardInput(0, code, KEYEVENTF_UNICODE);
    keyboardInput(0, code, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
    return true;
  } catch {
    return false;
  }
}

async function typeText(text, interval) {
  let typed = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0d || code === 0x0a) {
      if (code === 0x0d && text.charCodeAt(i + 1) === 0x0a) i++;
      if ((await pressKeys("enter")).length) typed++;
    } else if (typeCodeUnit(code)) {
      typed++;
    }
    if (interval > 0 && i + 1 < text.length) await wait({ ms: interval });
  }
  return typed;
}

export async function keyb({ press, down, up, type, repeat = 1, interval = 0 } = {}) {
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error(`Invalid repeat: ${repeat}`);
  if (repeat !== 1 && press == null) throw new Error("keyb repeat is only valid with press");
  interval = timeMs(interval);
  const result = {};
  if (press != null) {
    for (let i = 0; i < repeat; i++) {
      result.press = await pressKeys(press);
      if (interval > 0 && i + 1 < repeat) await delay(interval);
    }
    if (repeat !== 1) result.repeat = repeat;
  }
  if (down != null) result.down = keyNames(down).filter((name) => keyState(name, true));
  if (up != null) result.up = keyNames(up).filter((name) => keyState(name, false));
  if (type != null) result.typed = await typeText(String(type), interval);
  return result;
}

function openClipboard() {
  for (let i = 0; i < 20; i++) {
    if (user32.symbols.OpenClipboard(null)) return;
    sleepSync(5);
  }
  throw new Error("OpenClipboard failed");
}

function clipboardRead() {
  if (!user32.symbols.IsClipboardFormatAvailable(CF_UNICODETEXT)) return "";
  openClipboard();
  try {
    const handle = user32.symbols.GetClipboardData(CF_UNICODETEXT);
    if (!handle) return "";
    const pointer = kernel32.symbols.GlobalLock(handle);
    if (!pointer) return "";
    try {
      const view = new Deno.UnsafePointerView(pointer);
      let length = 0;
      while (view.getUint16(length * 2) !== 0) length++;
      const bytes = new Uint8Array(view.getArrayBuffer(length * 2));
      return textDecoder16.decode(bytes);
    } finally {
      kernel32.symbols.GlobalUnlock(handle);
    }
  } finally {
    user32.symbols.CloseClipboard();
  }
}

function clipboardWrite(text) {
  text = String(text ?? "");
  const data16 = wide(text, true);
  const bytes = new Uint8Array(data16.buffer);
  const handle = kernel32.symbols.GlobalAlloc(0x0002, bytes.byteLength);
  if (!handle) throw new Error("GlobalAlloc failed");
  const pointer = kernel32.symbols.GlobalLock(handle);
  if (!pointer) {
    kernel32.symbols.GlobalFree(handle);
    throw new Error("GlobalLock failed");
  }
  ntdll.symbols.RtlMoveMemory(pointer, bytes, bytes.byteLength);
  kernel32.symbols.GlobalUnlock(handle);

  openClipboard();
  let transferred = false;
  try {
    if (!user32.symbols.EmptyClipboard()) throw new Error("EmptyClipboard failed");
    if (!user32.symbols.SetClipboardData(CF_UNICODETEXT, handle)) throw new Error("SetClipboardData failed");
    transferred = true;
  } finally {
    user32.symbols.CloseClipboard();
    if (!transferred) kernel32.symbols.GlobalFree(handle);
  }
  return { length: text.length };
}

function clipboardClear() {
  openClipboard();
  try {
    if (!user32.symbols.EmptyClipboard()) throw new Error("EmptyClipboard failed");
  } finally {
    user32.symbols.CloseClipboard();
  }
  return true;
}

export function clipboard(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return null;
  const operations = ["read", "write", "clear"].filter((key) => own(options, key));
  if (operations.length !== 1) throw new Error("clipboard requires exactly one of read, write, clear");
  if (operations[0] === "read") return options.read === true ? clipboardRead() : null;
  if (operations[0] === "clear") return options.clear === true ? clipboardClear() : null;
  return clipboardWrite(options.write);
}

function guid(text) {
  const h = text.replace(/[{}-]/g, "");
  const b = new Uint8Array(16);
  const v = new DataView(b.buffer);
  v.setUint32(0, parseInt(h.slice(0, 8), 16), true);
  v.setUint16(4, parseInt(h.slice(8, 12), 16), true);
  v.setUint16(6, parseInt(h.slice(12, 16), 16), true);
  for (let i = 0; i < 8; i++) b[8 + i] = parseInt(h.slice(16 + i * 2, 18 + i * 2), 16);
  return b;
}

function checkHR(hr, label) {
  if (hr < 0) throw new Error(`${label} failed: HRESULT 0x${(hr >>> 0).toString(16)}`);
  return hr;
}

function comMethod(object, index, definition) {
  const vtable = new Deno.UnsafePointerView(object).getPointer(0);
  const fn = new Deno.UnsafePointerView(vtable).getPointer(index * POINTER_SIZE);
  return new Deno.UnsafeFnPointer(fn, definition);
}

function comCall(object, index, result, parameters = [], args = []) {
  return comMethod(object, index, { parameters: ["pointer", ...parameters], result }).call(object, ...args);
}

function comOut(object, index, Out = BigUint64Array, length = 1, args = [], parameters = args.map(() => "pointer")) {
  const out = new Out(length);
  const hr = comCall(object, index, "i32", [...parameters, "buffer"], [...args, out]);
  return { hr, out };
}

function comRelease(object) {
  if (object) comCall(object, 2, "u32");
}

function comQuery(object, iid) {
  const { hr, out } = comOut(object, 0, BigUint64Array, 1, [guid(iid)], ["buffer"]);
  checkHR(hr, "QueryInterface");
  return out[0] ? Deno.UnsafePointer.create(out[0]) : null;
}

const CLSID_CUIAutomation = "ff48dba4-60ef-4201-aa87-54103eef594e";
const IID_IUIAutomation = "30cbe57d-d9d0-452a-ab13-7ac5ac4825ee";
const CLSCTX_INPROC_SERVER = 1;

const UIA_TYPES = new Map([
  [50000, "button"], [50001, "calendar"], [50002, "check-box"], [50003, "combo-box"],
  [50004, "edit"], [50005, "hyperlink"], [50006, "image"], [50007, "list-item"],
  [50008, "list"], [50009, "menu"], [50010, "menu-bar"], [50011, "menu-item"],
  [50012, "progress-bar"], [50013, "radio-button"], [50014, "scroll-bar"], [50015, "slider"],
  [50016, "spinner"], [50017, "status-bar"], [50018, "tab"], [50019, "tab-item"],
  [50020, "text"], [50021, "tool-bar"], [50022, "tool-tip"], [50023, "tree"],
  [50024, "tree-item"], [50025, "custom"], [50026, "group"], [50027, "thumb"],
  [50028, "data-grid"], [50029, "data-item"], [50030, "document"], [50031, "split-button"],
  [50032, "window"], [50033, "pane"], [50034, "header"], [50035, "header-item"],
  [50036, "table"], [50037, "title-bar"], [50038, "separator"], [50039, "semantic-zoom"],
  [50040, "app-bar"],
]);
const UIA_TYPE_IDS = new Map([...UIA_TYPES].map(([id, name]) => [name, id]));

let comReady = false;
let uiaAutomation = null;
let uiaWalker = null;

function ensureCom() {
  if (comReady) return;
  const hr = ole32.symbols.CoInitializeEx(null, 0);
  if (hr < 0 && (hr >>> 0) !== 0x80010106) checkHR(hr, "CoInitializeEx");
  comReady = true;
}

function ensureUia() {
  if (uiaAutomation && uiaWalker) return;
  ensureCom();
  const out = new BigUint64Array(1);
  checkHR(ole32.symbols.CoCreateInstance(guid(CLSID_CUIAutomation), null, CLSCTX_INPROC_SERVER, guid(IID_IUIAutomation), out), "CoCreateInstance(CUIAutomation)");
  uiaAutomation = out[0] ? Deno.UnsafePointer.create(out[0]) : null;
  if (!uiaAutomation) throw new Error("CUIAutomation returned no interface");

  const walker = comOut(uiaAutomation, 14);
  if (walker.hr < 0 || !walker.out[0]) {
    comRelease(uiaAutomation);
    uiaAutomation = null;
    checkHR(walker.hr, "IUIAutomation.ControlViewWalker");
    throw new Error("UI Automation ControlViewWalker unavailable");
  }
  uiaWalker = Deno.UnsafePointer.create(walker.out[0]);
}

function uiaOutElement(object, index, args = []) {
  const { hr, out } = comOut(object, index, BigUint64Array, 1, args);
  return hr >= 0 && out[0] ? Deno.UnsafePointer.create(out[0]) : null;
}

function uiaRootElement() { ensureUia(); return uiaOutElement(uiaAutomation, 5); }
function uiaElementFromHandle(hwnd) { if (!hwnd) return null; ensureUia(); return uiaOutElement(uiaAutomation, 6, [hwnd]); }
function uiaParent(element) { ensureUia(); return uiaOutElement(uiaWalker, 3, [element]); }
function uiaFirstChild(element) { ensureUia(); return uiaOutElement(uiaWalker, 4, [element]); }
function uiaNextSibling(element) { ensureUia(); return uiaOutElement(uiaWalker, 6, [element]); }

function uiaInt(element, index) {
  const { hr, out } = comOut(element, index, Int32Array);
  return hr >= 0 ? out[0] : null;
}
function uiaBool(element, index) { const value = uiaInt(element, index); return value == null ? null : !!value; }

function bstrText(pointer) {
  const length = pointer ? oleaut32.symbols.SysStringLen(pointer) : 0;
  return length ? textDecoder16.decode(new Uint8Array(new Deno.UnsafePointerView(pointer).getArrayBuffer(length * 2))) : "";
}

function uiaBstr(element, index) {
  const { hr, out } = comOut(element, index);
  if (hr < 0 || !out[0]) return "";
  const pointer = Deno.UnsafePointer.create(out[0]);
  try { return bstrText(pointer); } finally { oleaut32.symbols.SysFreeString(pointer); }
}

function uiaNativeWid(element) {
  const { hr, out } = comOut(element, 36);
  return hr >= 0 && out[0] ? `0x${out[0].toString(16)}` : null;
}

function uiaRect(element) {
  const { hr, out: rect } = comOut(element, 43, Int32Array, 4);
  return hr < 0 ? null : { x: rect[0], y: rect[1], width: rect[2] - rect[0], height: rect[3] - rect[1] };
}

function uiaRuntimeId(element) {
  const out = new BigUint64Array(1);
  const hr = comMethod(element, 4, { parameters: ["pointer", "buffer"], result: "i32" }).call(element, out);
  if (hr < 0 || !out[0]) return null;

  const safeArray = Deno.UnsafePointer.create(out[0]);
  let accessed = false;
  try {
    const lower = new Int32Array(1);
    const upper = new Int32Array(1);
    if (oleaut32.symbols.SafeArrayGetLBound(safeArray, 1, lower) < 0) return null;
    if (oleaut32.symbols.SafeArrayGetUBound(safeArray, 1, upper) < 0) return null;
    const count = upper[0] - lower[0] + 1;
    if (count <= 0) return [];

    const data = new BigUint64Array(1);
    if (oleaut32.symbols.SafeArrayAccessData(safeArray, data) < 0 || !data[0]) return null;
    accessed = true;
    const pointer = Deno.UnsafePointer.create(data[0]);
    return [...new Int32Array(new Deno.UnsafePointerView(pointer).getArrayBuffer(count * 4))];
  } finally {
    if (accessed) oleaut32.symbols.SafeArrayUnaccessData(safeArray);
    oleaut32.symbols.SafeArrayDestroy(safeArray);
  }
}

function uiaVariant(element, propertyId) {
  const variant = new Uint8Array(24);
  const hr = comMethod(element, 10, {
    parameters: ["pointer", "i32", "buffer"],
    result: "i32",
  }).call(element, propertyId, variant);
  if (hr < 0) return null;

  try {
    const view = new DataView(variant.buffer);
    const type = view.getUint16(0, true);
    if (type === 0 || type === 1) return null;
    if (type === 3) return view.getInt32(8, true);
    if (type === 5) return view.getFloat64(8, true);
    if (type === 11) return view.getInt16(8, true) !== 0;
    if (type === 19) return view.getUint32(8, true);
    if (type === 8) {
      const raw = view.getBigUint64(8, true);
      if (!raw) return "";
      return bstrText(Deno.UnsafePointer.create(raw));
    }
    return null;
  } finally {
    oleaut32.symbols.VariantClear(variant);
  }
}

function uiaTypeName(id) {
  return UIA_TYPES.get(Number(id)) ?? (id == null ? null : String(id));
}

function normalizeUiaType(value) {
  if (typeof value === "number") return uiaTypeName(value);
  return String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function uiaRecord(element) {
  const runtimeId = uiaRuntimeId(element);
  const typeId = uiaInt(element, 21);
  return {
    uid: runtimeId ? runtimeId.join(".") : null,
    wid: uiaNativeWid(element),
    aid: uiaBstr(element, 29),
    name: uiaBstr(element, 23),
    type: uiaTypeName(typeId),
    class: uiaBstr(element, 30),
    framework: uiaBstr(element, 40),
    pid: uiaInt(element, 20),
    rect: uiaRect(element),
    value: uiaVariant(element, 30045),
    enabled: uiaBool(element, 28),
    focus: uiaBool(element, 26),
    focusable: uiaBool(element, 27),
    offscreen: uiaBool(element, 38),
    _typeId: typeId,
  };
}

function publicUia({ _typeId, ...element }) {
  return element;
}

function normalizeUiaFilter(filter) {
  if (filter == null) return {};
  if (typeof filter === "string") return { name: filter };
  return filter;
}

function matchesUiaOwn(record, filter) {
  if (filter.uid != null && !anyFilter(filter.uid, (value) => record.uid === String(value))) return false;
  if (own(filter, "wid") && !anyFilter(filter.wid, (value) => sameWindowId(record.wid, value))) return false;
  if (filter.pid != null && !anyFilter(filter.pid, (value) => record.pid === Number(value))) return false;
  if (filter.aid != null && !regexFilter(record.aid, filter.aid)) return false;
  if (filter.name != null && !regexFilter(record.name, filter.name)) return false;
  if (filter.type != null && !anyFilter(filter.type, (value) => record.type === normalizeUiaType(value))) return false;
  if (filter.class != null && !regexFilter(record.class, filter.class)) return false;
  if (filter.framework != null && !regexFilter(record.framework, filter.framework)) return false;
  if (filter.value != null && !regexFilter(record.value, filter.value)) return false;
  if (filter.enabled != null && record.enabled !== !!filter.enabled) return false;
  if (filter.focus != null && record.focus !== !!filter.focus) return false;
  if (filter.focusable != null && record.focusable !== !!filter.focusable) return false;
  if (filter.offscreen != null && record.offscreen !== !!filter.offscreen) return false;
  return true;
}

function uiaWalkDown(root, maxDepth, visitor) {
  function walk(parent, depth) {
    if (depth > maxDepth) return false;
    let child = uiaFirstChild(parent);
    while (child) {
      let next = null;
      try {
        if (visitor(child, depth)) return true;
        if (depth < maxDepth && walk(child, depth + 1)) return true;
        next = uiaNextSibling(child);
      } finally {
        comRelease(child);
      }
      child = next;
    }
    return false;
  }
  return walk(root, 1);
}

function uiaWalkUp(root, maxDepth, visitor) {
  let current = uiaParent(root);
  for (let depth = 1; current && depth <= maxDepth; depth++) {
    let next = null;
    try {
      if (visitor(current, depth)) return true;
      if (depth < maxDepth) next = uiaParent(current);
    } finally {
      comRelease(current);
    }
    current = next;
  }
  return false;
}

function uiaWindowTargetSet(filter) {
  return new Set(windowRecords(filter ?? {}).map((window) => window.wid.toLowerCase()));
}

function matchesUiaRelation(element, direction, spec) {
  const relation = relationSpec(spec, "a11y");
  if (!relation) return false;
  const walk = direction === "up" ? uiaWalkUp : uiaWalkDown;

  if (relation.domain === "window") {
    const targets = uiaWindowTargetSet(relation.filter);
    if (!targets.size) return false;
    return walk(element, relation.depth, (candidate) => {
      const wid = uiaNativeWid(candidate);
      return !!wid && targets.has(wid.toLowerCase());
    });
  }

  return walk(element, relation.depth, (candidate) => {
    const record = uiaRecord(candidate);
    return matchesUia(candidate, record, relation.filter);
  });
}

function matchesUia(element, record, filter) {
  filter = normalizeUiaFilter(filter);
  if (!matchesUiaOwn(record, filter)) return false;
  if (filter.up != null && !matchesUiaRelation(element, "up", filter.up)) return false;
  if (filter.down != null && !matchesUiaRelation(element, "down", filter.down)) return false;
  return true;
}

function matchesWindowUiaRelation(window, direction, relation) {
  const root = uiaElementFromHandle(asPointer(window.wid));
  if (!root) return false;
  try {
    const walk = direction === "up" ? uiaWalkUp : uiaWalkDown;
    return walk(root, relation.depth, (candidate) => {
      const record = uiaRecord(candidate);
      return matchesUia(candidate, record, relation.filter);
    });
  } finally {
    comRelease(root);
  }
}

function uiaCollectFromRoot(root, filter, maxDepth, found, seen, limit) {
  return uiaWalkDown(root, maxDepth, (element) => {
    const record = uiaRecord(element);
    if (!matchesUia(element, record, filter)) return false;
    const key = record.uid ?? `${record.wid ?? ""}:${record.pid ?? ""}:${record.name}:${record.type}:${record.rect?.x ?? ""}:${record.rect?.y ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      found.push(publicUia(record));
    }
    return found.length >= limit;
  });
}

export function a11y_find({ a11y = {}, limit = 0 } = {}) {
  const max = findLimit(limit);
  if (max == null) return [];
  const filter = normalizeUiaFilter(a11y);
  const found = [];
  const seen = new Set();

  if (own(filter, "wid") && filter.wid != null && !Array.isArray(filter.wid)) {
    const element = uiaElementFromHandle(asPointer(filter.wid));
    if (!element) return [];
    try {
      const record = uiaRecord(element);
      return matchesUia(element, record, filter) ? [publicUia(record)] : [];
    } finally {
      comRelease(element);
    }
  }

  const upRelation = filter.up == null ? null : relationSpec(filter.up, "a11y");
  if (upRelation?.domain === "window") {
    const windows = windowRecords(upRelation.filter);
    for (const window of windows) {
      const root = uiaElementFromHandle(asPointer(window.wid));
      if (!root) continue;
      try {
        uiaCollectFromRoot(root, filter, upRelation.depth, found, seen, max);
      } finally {
        comRelease(root);
      }
      if (found.length >= max) break;
    }
    return found;
  }

  const root = uiaRootElement();
  if (!root) return [];
  try {
    uiaCollectFromRoot(root, filter, Infinity, found, seen, max);
  } finally {
    comRelease(root);
  }
  return found;
}

let roReady = false;
function ensureRo() {
  if (roReady) return;
  const hr = combase.symbols.RoInitialize(1);
  // S_OK, S_FALSE and RPC_E_CHANGED_MODE are all usable for our calls.
  if (hr < 0 && (hr >>> 0) !== 0x80010106) checkHR(hr, "RoInitialize");
  roReady = true;
}

function createHString(text) {
  const chars = wide(text);
  const out = new BigUint64Array(1);
  checkHR(combase.symbols.WindowsCreateString(chars, chars.length, out), "WindowsCreateString");
  return out[0] ? Deno.UnsafePointer.create(out[0]) : null;
}

function hstringText(hstring, free = true) {
  if (!hstring) return "";
  try {
    const length = new Uint32Array(1);
    const pointer = combase.symbols.WindowsGetStringRawBuffer(hstring, length);
    if (!pointer || !length[0]) return "";
    return textDecoder16.decode(new Uint8Array(new Deno.UnsafePointerView(pointer).getArrayBuffer(length[0] * 2)));
  } finally {
    if (free) combase.symbols.WindowsDeleteString(hstring);
  }
}

function activationFactory(className, iid) {
  ensureRo();
  const name = createHString(className);
  const out = new BigUint64Array(1);
  try {
    checkHR(combase.symbols.RoGetActivationFactory(name, guid(iid), out), `RoGetActivationFactory(${className})`);
  } finally {
    combase.symbols.WindowsDeleteString(name);
  }
  return out[0] ? Deno.UnsafePointer.create(out[0]) : null;
}

const IID_IBufferFactory = "71af914d-c10f-484b-bc50-14bc623b3a27";
const IID_IBufferByteAccess = "905a0fef-bc53-11df-8c49-001e4fc686da";
const IID_ISoftwareBitmapStatics = "df0385db-672f-4a9d-806e-c2442f343e86";
const IID_IOcrEngineStatics = "5bffa85a-3384-3540-9940-699120d428a8";
const IID_IAsyncInfo = "00000036-0000-0000-c000-000000000046";

function softwareBitmapFromBGRA(image) {
  const bufferFactory = activationFactory("Windows.Storage.Streams.Buffer", IID_IBufferFactory);
  let buffer;
  let byteAccess;
  let softwareStatics;
  try {
    const bufferOut = new BigUint64Array(1);
    checkHR(
      comMethod(bufferFactory, 6, { parameters: ["pointer", "u32", "buffer"], result: "i32" }).call(bufferFactory, image.data.length, bufferOut),
      "IBufferFactory.Create",
    );
    buffer = Deno.UnsafePointer.create(bufferOut[0]);

    checkHR(
      comMethod(buffer, 8, { parameters: ["pointer", "u32"], result: "i32" }).call(buffer, image.data.length),
      "IBuffer.SetLength",
    );

    byteAccess = comQuery(buffer, IID_IBufferByteAccess);
    const bytesOut = new BigUint64Array(1);
    checkHR(
      comMethod(byteAccess, 3, { parameters: ["pointer", "buffer"], result: "i32" }).call(byteAccess, bytesOut),
      "IBufferByteAccess.Buffer",
    );
    ntdll.symbols.RtlMoveMemory(Deno.UnsafePointer.create(bytesOut[0]), image.data, image.data.length);

    softwareStatics = activationFactory("Windows.Graphics.Imaging.SoftwareBitmap", IID_ISoftwareBitmapStatics);
    const bitmapOut = new BigUint64Array(1);
    checkHR(
      comMethod(softwareStatics, 9, { parameters: ["pointer", "pointer", "i32", "i32", "i32", "buffer"], result: "i32" })
        .call(softwareStatics, buffer, 87, image.rect.width, image.rect.height, bitmapOut),
      "SoftwareBitmap.CreateCopyFromBuffer",
    );
    return Deno.UnsafePointer.create(bitmapOut[0]);
  } finally {
    comRelease(softwareStatics);
    comRelease(byteAccess);
    comRelease(buffer);
    comRelease(bufferFactory);
  }
}

async function asyncResult(operation) {
  const info = comQuery(operation, IID_IAsyncInfo);
  try {
    for (;;) {
      const status = new Int32Array(1);
      checkHR(comMethod(info, 7, { parameters: ["pointer", "buffer"], result: "i32" }).call(info, status), "IAsyncInfo.Status");
      if (status[0] === 1) break;
      if (status[0] === 2) throw new Error("WinRT operation canceled");
      if (status[0] === 3) {
        const error = new Int32Array(1);
        comMethod(info, 8, { parameters: ["pointer", "buffer"], result: "i32" }).call(info, error);
        throw new Error(`WinRT operation failed: HRESULT 0x${(error[0] >>> 0).toString(16)}`);
      }
      await wait({ ms: 5 });
    }

    const out = new BigUint64Array(1);
    checkHR(
      comMethod(operation, 8, { parameters: ["pointer", "buffer"], result: "i32" }).call(operation, out),
      "IAsyncOperation.GetResults",
    );
    return out[0] ? Deno.UnsafePointer.create(out[0]) : null;
  } finally {
    comRelease(info);
  }
}

export async function ocr(options = {}) {
  const image = options.image ?? captureScreenshot(options);
  if (!image) return null;
  const bitmap = softwareBitmapFromBGRA(image);
  const statics = activationFactory("Windows.Media.Ocr.OcrEngine", IID_IOcrEngineStatics);
  let engine;
  let operation;
  let result;
  try {
    const engineOut = new BigUint64Array(1);
    checkHR(
      comMethod(statics, 10, { parameters: ["pointer", "buffer"], result: "i32" }).call(statics, engineOut),
      "OcrEngine.TryCreateFromUserProfileLanguages",
    );
    if (!engineOut[0]) throw new Error("Windows OCR engine unavailable for user languages");
    engine = Deno.UnsafePointer.create(engineOut[0]);

    const operationOut = new BigUint64Array(1);
    checkHR(
      comMethod(engine, 6, { parameters: ["pointer", "pointer", "buffer"], result: "i32" }).call(engine, bitmap, operationOut),
      "OcrEngine.RecognizeAsync",
    );
    operation = Deno.UnsafePointer.create(operationOut[0]);
    result = await asyncResult(operation);

    const textOut = new BigUint64Array(1);
    checkHR(
      comMethod(result, 8, { parameters: ["pointer", "buffer"], result: "i32" }).call(result, textOut),
      "OcrResult.Text",
    );
    const text = hstringText(textOut[0] ? Deno.UnsafePointer.create(textOut[0]) : null);
    return { text, rect: image.rect };
  } finally {
    comRelease(result);
    comRelease(operation);
    comRelease(engine);
    comRelease(statics);
    comRelease(bitmap);
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

async function readPng(path) {
  const bytes = await Deno.readFile(path);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || signature.some((byte, i) => bytes[i] !== byte)) return null;

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idat = [];
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const v = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const length = v.getUint32(0, false);
    if (offset + 12 + length > bytes.length) return null;
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      if (length !== 13) return null;
      const h = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = h.getUint32(0, false);
      height = h.getUint32(4, false);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data.slice());
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[colorType];
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0 || !idat.length) return null;

  const compressed = concat(...idat);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  const rowBytes = width * channels;
  if (raw.length < (rowBytes + 1) * height) return null;

  const pixels = new Uint8Array(rowBytes * height);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const value = raw[src++];
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const up = y ? pixels[row - rowBytes + x] : 0;
      const upperLeft = y && x >= channels ? pixels[row - rowBytes + x - channels] : 0;
      const prediction = filter === 0 ? 0
        : filter === 1 ? left
        : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2)
        : filter === 4 ? paeth(left, up, upperLeft)
        : null;
      if (prediction == null) return null;
      pixels[row + x] = (value + prediction) & 0xff;
    }
  }

  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    const out = i * 4;
    if (colorType === 0) {
      data[out] = data[out + 1] = data[out + 2] = pixels[j];
      data[out + 3] = 255;
    } else if (colorType === 2) {
      data[out] = pixels[j + 2];
      data[out + 1] = pixels[j + 1];
      data[out + 2] = pixels[j];
      data[out + 3] = 255;
    } else if (colorType === 4) {
      data[out] = data[out + 1] = data[out + 2] = pixels[j];
      data[out + 3] = pixels[j + 1];
    } else {
      data[out] = pixels[j + 2];
      data[out + 1] = pixels[j + 1];
      data[out + 2] = pixels[j];
      data[out + 3] = pixels[j + 3];
    }
  }
  return { rect: { x: 0, y: 0, width, height }, format: "bgra8", data };
}

function imageScoreAt(source, template, ox, oy, threshold) {
  const sw = source.rect.width;
  const tw = template.rect.width;
  const th = template.rect.height;
  const total = tw * th * 3 * 255;
  const maxDiff = (1 - threshold) * total;
  let diff = 0;

  for (let y = 0; y < th; y++) {
    let si = ((oy + y) * sw + ox) * 4;
    let ti = y * tw * 4;
    for (let x = 0; x < tw; x++, si += 4, ti += 4) {
      diff += Math.abs(source.data[si] - template.data[ti]);
      diff += Math.abs(source.data[si + 1] - template.data[ti + 1]);
      diff += Math.abs(source.data[si + 2] - template.data[ti + 2]);
      if (diff > maxDiff) return 0;
    }
  }
  return 1 - diff / total;
}

function imageProbe(source, template, ox, oy, threshold) {
  const sw = source.rect.width;
  const tw = template.rect.width;
  const th = template.rect.height;
  const xs = [...new Set([0, Math.floor(tw / 2), tw - 1])];
  const ys = [...new Set([0, Math.floor(th / 2), th - 1])];
  let diff = 0;
  let count = 0;
  for (const y of ys) {
    for (const x of xs) {
      const si = ((oy + y) * sw + ox + x) * 4;
      const ti = (y * tw + x) * 4;
      diff += Math.abs(source.data[si] - template.data[ti]);
      diff += Math.abs(source.data[si + 1] - template.data[ti + 1]);
      diff += Math.abs(source.data[si + 2] - template.data[ti + 2]);
      count++;
    }
  }
  return 1 - diff / (count * 3 * 255) >= Math.max(0, threshold - 0.03);
}

function findImage(source, template, similarity = 0.98) {
  if (!source || !template) return null;
  similarity = Math.max(0, Math.min(1, Number(similarity)));
  const sw = source.rect.width;
  const sh = source.rect.height;
  const tw = template.rect.width;
  const th = template.rect.height;
  if (tw > sw || th > sh) return null;

  for (let y = 0; y <= sh - th; y++) {
    for (let x = 0; x <= sw - tw; x++) {
      if (!imageProbe(source, template, x, y, similarity)) continue;
      const score = imageScoreAt(source, template, x, y, similarity);
      if (score >= similarity) {
        return {
          rect: { x: source.rect.x + x, y: source.rect.y + y, width: tw, height: th },
          similarity: score,
        };
      }
    }
  }
  return null;
}

function imageChange(before, after) {
  if (!before || !after) return null;
  const width = after.rect.width;
  const height = after.rect.height;
  const total = width * height;
  if (!total) return null;

  if (before.rect.width !== width || before.rect.height !== height) {
    return { rect: after.rect, changed: total, percent: 100, bounds: after.rect };
  }

  let changed = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (
        before.data[i] === after.data[i] &&
        before.data[i + 1] === after.data[i + 1] &&
        before.data[i + 2] === after.data[i + 2]
      ) continue;
      changed++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  return {
    rect: after.rect,
    changed,
    percent: changed * 100 / total,
    bounds: changed ? {
      x: after.rect.x + minX,
      y: after.rect.y + minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    } : null,
  };
}

async function prepareWaitCondition(kind, spec) {
  if (kind === "window") return { window: spec };
  if (kind === "ocr") {
    if (!spec || typeof spec !== "object" || spec.text == null) return null;
    return spec;
  }
  if (kind === "image") {
    if (typeof spec === "string") spec = { path: spec };
    if (!spec || typeof spec !== "object" || !spec.path) return null;
    const template = await readPng(spec.path);
    return template ? { spec, template } : null;
  }
  if (kind === "change") {
    if (spec == null) spec = {};
    if (typeof spec !== "object" || Array.isArray(spec)) return null;
    if (spec.percent != null) {
      const percent = Number(spec.percent);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
    }
    return { spec, baseline: null };
  }
  return null;
}

async function testWaitCondition(kind, prepared) {
  try {
    if (kind === "window") {
      const value = window_get(prepared);
      return { matched: !!value, value };
    }
    if (kind === "ocr") {
      const { text, ...source } = prepared;
      const value = await ocr(source);
      return { matched: !!value && regexMatch(value.text, text), value };
    }
    if (kind === "image") {
      const { path, similarity = 0.98, ...source } = prepared.spec;
      const match = findImage(captureScreenshot(source), prepared.template, similarity);
      return {
        matched: !!match,
        value: match ? { path, ...match } : null,
      };
    }
    if (kind === "change") {
      const { percent, ...source } = prepared.spec;
      const image = captureScreenshot(source);
      if (!image) return { matched: false, value: null };
      if (!prepared.baseline) {
        prepared.baseline = image;
        return { ready: false, matched: false, value: null };
      }
      const value = imageChange(prepared.baseline, image);
      const threshold = percent == null ? 0 : Number(percent);
      return {
        matched: !!value && value.changed > 0 && value.percent >= threshold,
        value,
      };
    }
  } catch {
    // A temporarily unavailable target is simply a false polling sample.
  }
  return { matched: false, value: null };
}

function resourceRefs(value, resources, found = new Set(), seen = new Set()) {
  if (typeof value === "string") {
    if (resources.has(value)) found.add(value);
    return found;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return found;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) resourceRefs(item, resources, found, seen);
  } else {
    for (const item of Object.values(value)) resourceRefs(item, resources, found, seen);
  }
  return found;
}

function imageResource(resources, id) {
  if (typeof id !== "string") return null;
  const resource = resources.get(id);
  return resource?.kind === "image" ? resource.value : null;
}

function collectScenarioResources(resources, context) {
  const stateRefs = resourceRefs(context.state, resources);
  const prevRefs = resourceRefs(context.prev, resources);

  for (const id of stateRefs) {
    const resource = resources.get(id);
    if (resource) resource.retained = true;
  }

  for (const [id, resource] of resources) {
    if (resource.retained) {
      if (!stateRefs.has(id)) resources.delete(id);
    } else if (!stateRefs.has(id) && !prevRefs.has(id)) {
      resources.delete(id);
    }
  }
}

async function scenarioScreenshot(options, resources) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return null;
  const { save, format = "png", ...capture } = options;
  const image = captureScreenshot(capture);
  if (!image) return null;
  const id = crypto.randomUUID();
  resources.set(id, { kind: "image", value: image, retained: false });

  try {
    const saved = await saveImage(image, save, format);
    return {
      image: id,
      rect: image.rect,
      grayscale: image.grayscale,
      ...saved,
    };
  } catch (error) {
    resources.delete(id);
    throw error;
  }
}

async function scenarioScreenshotSave(options, resources) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return null;
  const { image: id, save, format = "png" } = options;
  if (typeof id !== "string" || !save) return null;
  const resource = resources.get(id);
  if (!resource?.retained || resource.kind !== "image") return null;
  const saved = await saveImage(resource.value, save, format);
  return {
    image: id,
    rect: resource.value.rect,
    grayscale: resource.value.grayscale,
    ...saved,
  };
}

function resolveActionResources(name, value, resources) {
  if (name === "ocr" && value && typeof value === "object" && typeof value.image === "string") {
    const image = imageResource(resources, value.image);
    if (!image) return { ok: false };
    return { ok: true, value: { ...value, image } };
  }
  return { ok: true, value };
}

const ACTIONS = {
  wait,
  window_control,
  window_set,
  mouse_move,
  mouse_button,
  keyb,
  clipboard,
  ocr,
  window_find,
  window_get,
  a11y_find,
  display_find,
  system,
  window_hit,
  highlight,
};

function scenarioPath(path) {
  const root = path.match(/^\$\.(prev|state)/);
  if (!root) return null;
  const parts = [root[1]];
  let offset = root[0].length;
  while (offset < path.length) {
    const rest = path.slice(offset);
    const property = rest.match(/^\.([A-Za-z_][A-Za-z0-9_-]*)/);
    if (property) {
      parts.push(property[1]);
      offset += property[0].length;
      continue;
    }
    const index = rest.match(/^\[(\d+)\]/);
    if (index) {
      parts.push(Number(index[1]));
      offset += index[0].length;
      continue;
    }
    return null;
  }
  return parts;
}

function scenarioReference(path, context) {
  const parts = scenarioPath(path);
  if (!parts) return { ok: false };
  let value = context[parts[0]];
  for (let i = 1; i < parts.length; i++) {
    const key = parts[i];
    if (value == null || !own(Object(value), key)) return { ok: false };
    value = value[key];
  }
  return { ok: true, value: structuredClone(value) };
}

function scenarioText(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveScenarioString(value, context) {
  if (value.startsWith("$.")) return scenarioReference(value, context);

  let failed = false;
  const text = value.replace(/<<([^<>]+)>>/g, (placeholder, expression) => {
    const match = expression.match(/^(\$\..*?)(?:\|(re))?$/);
    if (!match) return placeholder;
    const resolved = scenarioReference(match[1], context);
    if (!resolved.ok) {
      failed = true;
      return "";
    }
    const text = scenarioText(resolved.value);
    return match[2] === "re" ? regexEscape(text) : text;
  });
  return failed ? { ok: false } : { ok: true, value: text };
}

function resolveScenarioValue(value, context) {
  if (typeof value === "string") return resolveScenarioString(value, context);
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      const resolved = resolveScenarioValue(item, context);
      if (!resolved.ok) return resolved;
      out.push(resolved.value);
    }
    return { ok: true, value: out };
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const resolved = resolveScenarioValue(item, context);
      if (!resolved.ok) return resolved;
      out[key] = resolved.value;
    }
    return { ok: true, value: out };
  }
  return { ok: true, value };
}

function statePath(value) {
  if (typeof value !== "string") return null;
  const path = value.split(".");
  if (!path.length || path.some((part) => !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(part))) return null;
  return path;
}

function statePatchPath(value) {
  if (typeof value !== "string") return null;
  const push = value.startsWith("&");
  const path = statePath(push ? value.slice(1) : value);
  return path ? { push, path } : null;
}

function stateParent(root, path, create) {
  let target = root;
  for (const key of path.slice(0, -1)) {
    if (!own(target, key)) {
      if (!create) return null;
      target[key] = Object.create(null);
    } else if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) {
      if (!create) return null;
      target[key] = Object.create(null);
    }
    target = target[key];
  }
  return target;
}

const STATE_VALUE = Symbol("state-value");
const STATE_PUSH = Symbol("state-push");

function resolveStatePatch(value, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false };
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const parsed = statePatchPath(key);
    if (!parsed) return { ok: false };

    if (parsed.push) {
      const resolved = resolveScenarioValue(item, context);
      if (!resolved.ok) return resolved;
      out[key] = { [STATE_PUSH]: resolved.value };
      continue;
    }

    if (typeof item === "string" && item.startsWith("$.")) {
      const resolved = scenarioReference(item, context);
      if (!resolved.ok) return resolved;
      out[key] = { [STATE_VALUE]: resolved.value };
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const resolved = resolveStatePatch(item, context);
      if (!resolved.ok) return resolved;
      out[key] = resolved.value;
      continue;
    }
    const resolved = resolveScenarioValue(item, context);
    if (!resolved.ok) return resolved;
    out[key] = resolved.value;
  }
  return { ok: true, value: out };
}

function resolveStateAction(value, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false };
  const patch = {};
  const remove = [];

  for (const [key, item] of Object.entries(value)) {
    if (key === "-") {
      if (!Array.isArray(item)) return { ok: false };
      for (const name of item) {
        const resolved = resolveScenarioValue(name, context);
        if (!resolved.ok || typeof resolved.value !== "string") return { ok: false };
        const path = statePath(resolved.value);
        if (!path) return { ok: false };
        remove.push(path);
      }
      continue;
    }
    patch[key] = item;
  }

  const resolved = resolveStatePatch(patch, context);
  return resolved.ok ? { ok: true, patch: resolved.value, remove } : resolved;
}

function applyStatePatch(root, patch, prefix = []) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
  for (const [rawKey, value] of Object.entries(patch)) {
    const key = statePatchPath(rawKey);
    if (!key) return false;
    const path = [...prefix, ...key.path];

    if (key.push) {
      if (!value || typeof value !== "object" || !own(value, STATE_PUSH)) return false;
      const parent = stateParent(root, path, true);
      const leaf = path.at(-1);
      if (!own(parent, leaf)) parent[leaf] = [];
      if (!Array.isArray(parent[leaf])) return false;
      parent[leaf].push(structuredClone(value[STATE_PUSH]));
      continue;
    }

    if (value && typeof value === "object" && own(value, STATE_VALUE)) {
      const parent = stateParent(root, path, true);
      parent[path.at(-1)] = structuredClone(value[STATE_VALUE]);
      continue;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const parent = stateParent(root, path, true);
      const leaf = path.at(-1);
      if (!own(parent, leaf) || !parent[leaf] || typeof parent[leaf] !== "object" || Array.isArray(parent[leaf])) {
        parent[leaf] = Object.create(null);
      }
      if (!applyStatePatch(root, value, path)) return false;
      continue;
    }

    const parent = stateParent(root, path, true);
    parent[path.at(-1)] = structuredClone(value);
  }
  return true;
}

export async function run(actions = []) {
  const results = [];
  const context = { prev: null, state: Object.create(null) };
  const resources = new Map();

  try {
    for (const action of actions) {
      const entries = Object.entries(action);
      if (entries.length !== 1) throw new Error(`Each action must contain exactly one command: ${JSON.stringify(action)}`);
      const [name, params] = entries[0];

      if (name === "state") {
        const resolved = resolveStateAction(params, context);
        if (!resolved.ok) {
          results.push(null);
          continue;
        }
        const next = structuredClone(context.state);
        if (!applyStatePatch(next, resolved.patch)) {
          results.push(null);
          continue;
        }
        for (const path of resolved.remove) {
          const parent = stateParent(next, path, false);
          if (parent) delete parent[path.at(-1)];
        }
        context.state = next;
        results.push(structuredClone(context.state));
        collectScenarioResources(resources, context);
        continue;
      }

      let result = null;
      const resolved = resolveScenarioValue(params, context);
      if (resolved.ok) {
        try {
          if (name === "screenshot") {
            result = await scenarioScreenshot(resolved.value ?? {}, resources);
          } else if (name === "screenshot_save") {
            result = await scenarioScreenshotSave(resolved.value ?? {}, resources);
          } else {
            const fn = ACTIONS[name];
            if (fn) {
              const prepared = resolveActionResources(name, resolved.value ?? {}, resources);
              if (prepared.ok) result = await fn(prepared.value);
            }
          }
        } catch {
          result = null;
        }
      }
      results.push(result);
      context.prev = result;
      collectScenarioResources(resources, context);
    }
    return results;
  } finally {
    resources.clear();
  }
}
