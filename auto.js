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
const SWP_NOSIZE = 1, SWP_NOMOVE = 2, SWP_NOZORDER = 4, SWP_NOACTIVATE = 0x10, SWP_FRAMECHANGED = 0x20;
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

function viewRect(v, offset = 0) {
  const x = v.getInt32(offset, true), y = v.getInt32(offset + 4, true);
  return { x, y, width: v.getInt32(offset + 8, true) - x, height: v.getInt32(offset + 12, true) - y };
}
function rectFromBuffer(buffer) { return viewRect(new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)); }
function readWide(hwnd, size, fn) { const b = new Uint16Array(size), n = fn(hwnd, b, size); return n > 0 ? decodeWide(b, n) : ""; }
function windowText(hwnd) { const n = user32.symbols.GetWindowTextLengthW(hwnd); return n > 0 ? readWide(hwnd, n + 1, user32.symbols.GetWindowTextW) : ""; }
function windowClass(hwnd) { return readWide(hwnd, 512, user32.symbols.GetClassNameW); }

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

      const bounds = viewRect(v, 4), work = viewRect(v, 20);
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
function sameWindowId(a, b) { return a == null || b == null ? a == null && b == null : String(a).toLowerCase() === String(b).toLowerCase(); }
function anyFilter(value, match) { const values = Array.isArray(value) ? value : [value]; return values.length > 0 && values.some(match); }
function regexFilter(value, patterns) { return anyFilter(patterns, (pattern) => regexMatch(value, pattern)); }
const filterId = (a, b) => anyFilter(b, (v) => sameWindowId(a, v));
const filterNum = (a, b) => anyFilter(b, (v) => a === Number(v));
const filterBool = (a, b) => a === !!b;
const filterExact = (a, b) => anyFilter(b, (v) => a === String(v));
const filterString = (a, b) => anyFilter(b, (v) => a === String(v).toLowerCase());
function matchesFields(record, filter, rules) {
  for (const [key, [byOwn, test]] of Object.entries(rules)) if ((byOwn ? own(filter, key) : filter[key] != null) && !test(record[key], filter[key])) return false;
  return true;
}

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

const WINDOW_FIELDS = {
  wid: [false, filterId], wpid: [true, filterId], woid: [true, filterId],
  depth: [false, (a, b) => anyFilter(b, (v) => String(v).toLowerCase() === "all" || a === Number(v))],
  pid: [false, filterNum], title: [false, regexFilter], bin: [false, regexFilter], class: [false, regexFilter],
  display: [false, (a, b) => anyFilter(b, (v) => a === resolveDisplay(v).index)], status: [false, filterString],
  hidden: [false, filterBool], foreground: [false, filterBool],
};

function matchesWindowRelation(window, direction, spec, tree) {
  const relation = relationSpec(spec, "window");
  if (!relation) return false;
  if (relation.domain === "a11y") return matchesWindowUiaRelation(window, direction, relation);
  if (direction === "up") {
    let current = window;
    for (let depth = 1; depth <= relation.depth && current.wpid; depth++) {
      current = tree.byWid.get(current.wpid.toLowerCase());
      if (!current) break;
      if (matchesWindow(current, relation.filter, tree)) return true;
    }
    return false;
  }
  const queue = (tree.children.get(window.wid.toLowerCase()) ?? []).map((child) => [child, 1]);
  for (let i = 0; i < queue.length; i++) {
    const [child, depth] = queue[i];
    if (matchesWindow(child, relation.filter, tree)) return true;
    if (depth < relation.depth) for (const next of tree.children.get(child.wid.toLowerCase()) ?? []) queue.push([next, depth + 1]);
  }
  return false;
}

function matchesWindow(w, filter, tree) {
  return matchesFields(w, filter, WINDOW_FIELDS)
    && (filter.up == null || matchesWindowRelation(w, "up", filter.up, tree))
    && (filter.down == null || matchesWindowRelation(w, "down", filter.down, tree));
}

function deepWindowFilter(filter) { return filter.wid != null || own(filter, "wpid") || filter.depth != null || filter.up != null || filter.down != null; }

function enumWindowHandles(parents) {
  const found = [], seen = new Set(), top = parents == null;
  const callback = new Deno.UnsafeCallback({ parameters: ["pointer", "pointer"], result: "i32" }, (hwnd) => {
    if (top && isChildWindow(hwnd)) return 1;
    const id = ptrId(hwnd).toLowerCase();
    if (!seen.has(id)) { seen.add(id); found.push(hwnd); }
    return 1;
  });
  try {
    if (top) { if (!user32.symbols.EnumWindows(callback.pointer, null)) throw new Error("EnumWindows failed"); }
    else for (const hwnd of parents) user32.symbols.EnumChildWindows(hwnd, callback.pointer, null);
  } finally { callback.close(); }
  return found;
}

function windowRecords(filter = {}) {
  filter = normalizeWindowFilter(filter);
  const top = enumWindowHandles(), handles = deepWindowFilter(filter) ? [...top, ...enumWindowHandles(top)] : top, monitors = displayMap();
  const records = handles.map((hwnd) => getWindowInfo(hwnd, monitors)).filter(Boolean), tree = windowTree(records);
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

function sendMessage(hwnd, message, wParam = 0n, lParam = null) {
  const out = new BigUint64Array(1);
  return user32.symbols.SendMessageTimeoutW(hwnd, message, wParam, lParam, 3, 250, out) ? out[0] : null;
}
function windowMessageText(hwnd) {
  const rawLength = sendMessage(hwnd, WM_GETTEXTLENGTH);
  if (rawLength == null) return null;
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length < 0 || length > 1048576) return null;
  const buffer = new Uint16Array(length + 1), written = sendMessage(hwnd, WM_GETTEXT, BigInt(buffer.length), Deno.UnsafePointer.of(buffer));
  return written == null ? null : decodeWide(buffer, Math.min(Number(written), length));
}

export function window_get({ window = {}, text = false } = {}) {
  const found = windowRecords(window)[0];
  if (!found) return null;
  const out = publicWindow(found);
  if (text) out.text = windowMessageText(asPointer(found.wid));
  return out;
}
export function window_wait({ window = {}, timeout = 5000, interval = 50 } = {}) { return wait({ window, timeout, interval }); }

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
  if ((wake != null && awake != null) || (wake != null && wake !== true) || (awake != null && typeof awake !== "boolean")) return null;
  const flags = wake != null ? 3 : awake != null ? (awake ? 0x80000003 : 0x80000000) : null;
  if (flags != null && !kernel32.symbols.SetThreadExecutionState(flags)) return null;
  return { locked: sessionLocked(), ...(wake ? { wake: true } : {}), ...(awake != null ? { awake } : {}) };
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
      for (const tid of new Set([foregroundTid, targetTid])) if (tid && tid !== currentTid && user32.symbols.AttachThreadInput(currentTid, tid, 1)) attached.push(tid);
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
  const hwnd = asPointer(info.wid), show = { restore: 9, minimize: 6, maximize: 3 }[action];
  if (show) user32.symbols.ShowWindow(hwnd, show);
  else if (action === "focus") { try { focusWindow(info); } catch { /* best effort */ } }
  else if (action === "move" || action === "size") {
    const geometry = geometryContext(info, display), next = positionRect(resolveRect(rect, info.rect, geometry), pos, geometry);
    if (next.width > 0 && next.height > 0) user32.symbols.SetWindowPos(hwnd, null, next.x, next.y, next.width, next.height, SWP_NOZORDER | SWP_NOACTIVATE);
  } else if (action === "close") user32.symbols.PostMessageW(hwnd, WM_CLOSE, 0n, 0n);
  return window_get({ window: { wid: info.wid } });
}

const WINDOW_FRAMES = { none: 0, border: WS_BORDER, caption: WS_CAPTION | WS_SYSMENU, resizable: WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX };
function setWindowTitle(hwnd, title) { const text = wide(String(title), true); return sendMessage(hwnd, WM_SETTEXT, 0n, Deno.UnsafePointer.of(text)) != null; }
function setWindowFrame(hwnd, frame) {
  const bits = WINDOW_FRAMES[String(frame).toLowerCase()];
  if (bits == null) return false;
  const style = user32.symbols.GetWindowLongW(hwnd, GWL_STYLE) >>> 0;
  user32.symbols.SetWindowLongW(hwnd, GWL_STYLE, ((style & ~FRAME_STYLE_MASK) | bits) | 0);
  return !!user32.symbols.SetWindowPos(hwnd, null, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
}
function setWindowTopmost(hwnd, value) {
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

  if (mark) await highlight({ window: { wid: info.wid }, duration: mark === true ? 800 : mark });
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
    const geometry = geometryContext(info, options.display), base = info?.rect ?? geometry.display;
    const rect = base && resolveRect(options.rect, base, geometry);
    return rect && rect.width > 0 && rect.height > 0 ? { kind: "screen", ...rect } : null;
  }
  if (info) return { kind: "window", hwnd: asPointer(info.wid), ...info.rect };
  if (options.all || options.desktop === "all") {
    const displays = displayRecords();
    if (!displays.length) return null;
    const x = Math.min(...displays.map((d) => d.x)), y = Math.min(...displays.map((d) => d.y));
    const right = Math.max(...displays.map((d) => d.x + d.width)), bottom = Math.max(...displays.map((d) => d.y + d.height));
    return { kind: "screen", x, y, width: right - x, height: bottom - y };
  }
  const display = tryDisplay(options.display);
  return display ? { kind: "screen", x: display.x, y: display.y, width: display.width, height: display.height, display } : null;
}

function grayscaleBGRA(data) {
  const out = data.slice();
  for (let i = 0; i < out.length; i += 4) out[i] = out[i + 1] = out[i + 2] = (29 * out[i] + 150 * out[i + 1] + 77 * out[i + 2]) >> 8;
  return out;
}

function captureScreenshot(options = {}) {
  const area = captureArea(options);
  if (!area || area.width <= 0 || area.height <= 0) return null;
  const { width, height } = area, screen = user32.symbols.GetDC(null);
  if (!screen) throw new Error("GetDC failed");
  const memory = gdi32.symbols.CreateCompatibleDC(screen);
  if (!memory) { user32.symbols.ReleaseDC(null, screen); throw new Error("CreateCompatibleDC failed"); }

  const bmi = new Uint8Array(40), view = new DataView(bmi.buffer), bits = new BigUint64Array(1);
  view.setUint32(0, 40, true); view.setInt32(4, width, true); view.setInt32(8, -height, true); view.setUint16(12, 1, true); view.setUint16(14, 32, true);
  const bitmap = gdi32.symbols.CreateDIBSection(screen, bmi, 0, bits, null, 0);
  if (!bitmap || !bits[0]) { gdi32.symbols.DeleteDC(memory); user32.symbols.ReleaseDC(null, screen); throw new Error("CreateDIBSection failed"); }
  const old = gdi32.symbols.SelectObject(memory, bitmap);
  try {
    let ok = area.kind === "window" && user32.symbols.PrintWindow(area.hwnd, memory, PW_RENDERFULLCONTENT);
    if (!ok) ok = gdi32.symbols.BitBlt(memory, 0, 0, width, height, screen, area.x, area.y, SRCCOPY);
    if (!ok) throw new Error("Screenshot capture failed");
    let data = new Uint8Array(new Deno.UnsafePointerView(asPointer(bits[0])).getArrayBuffer(width * height * 4)).slice();
    if (options.grayscale) data = grayscaleBGRA(data);
    return { rect: { x: area.x, y: area.y, width, height }, format: "bgra8", grayscale: !!options.grayscale, data };
  } finally {
    if (old) gdi32.symbols.SelectObject(memory, old);
    gdi32.symbols.DeleteObject(bitmap); gdi32.symbols.DeleteDC(memory); user32.symbols.ReleaseDC(null, screen);
  }
}

let crcTable;
function crc32(data) {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xffffffff; for (const byte of data) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out;
}
function pngChunk(type, data) {
  const name = new TextEncoder().encode(type), head = new Uint8Array(4), tail = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, data.length, false); new DataView(tail.buffer).setUint32(0, crc32(concat(name, data)), false);
  return concat(head, name, data, tail);
}
async function png({ rect: { width, height }, data, grayscale }) {
  const channels = grayscale ? 1 : 4, stride = width * channels + 1, raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    let dst = y * stride + 1, src = y * width * 4;
    for (let x = 0; x < width; x++, src += 4) {
      if (grayscale) raw[dst++] = data[src];
      else { raw[dst++] = data[src + 2]; raw[dst++] = data[src + 1]; raw[dst++] = data[src]; raw[dst++] = data[src + 3]; }
    }
  }
  const compressed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const ihdr = new Uint8Array(13), view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false); view.setUint32(4, height, false); ihdr[8] = 8; ihdr[9] = grayscale ? 0 : 6;
  return concat(Uint8Array.of(137,80,78,71,13,10,26,10), pngChunk("IHDR", ihdr), pngChunk("IDAT", compressed), pngChunk("IEND", new Uint8Array()));
}

async function saveImage(image, path, format = "png") {
  if (!path) return {};
  if (String(format).toLowerCase() !== "png") throw new Error(`Unsupported image format: ${format}`);
  const bytes = await png(image);
  await Deno.writeFile(path, bytes);
  return { path, bytes: bytes.length };
}

function sendInput(type, fill, label) {
  const input = new Uint8Array(40), view = new DataView(input.buffer);
  view.setUint32(0, type, true); fill(view);
  if (user32.symbols.SendInput(1, input, 40) !== 1) throw new Error(`SendInput(${label}) failed`);
}
function mouseInput(flags, data = 0) { sendInput(INPUT_MOUSE, (v) => { v.setUint32(16, data >>> 0, true); v.setUint32(20, flags >>> 0, true); }, "mouse"); }

function tryDisplay(value) { try { return resolveDisplay(value); } catch { return null; } }
function geometryContext(info, display) {
  const explicitDisplay = display == null ? null : tryDisplay(display);
  return {
    window: info?.rect ?? null,
    client: info ? clientRect(asPointer(info.wid)) : null,
    display: explicitDisplay ?? (info?.display != null ? tryDisplay(info.display) : null) ?? tryDisplay(),
    explicitDisplay,
  };
}
function geometryReference(context, suffix) { return ({ W: context.window, WC: context.client, D: context.display })[(suffix || (context.window ? "W" : "D")).toUpperCase()] ?? null; }

const GEOMETRY_VALUE = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(%?)(WC|W|D)?$/i;
function geometryValue(value, axis, current, context, size = false) {
  const round = (x) => Math.round(x);
  if (value == null) return round(current);
  if (typeof value === "number" && Number.isFinite(value)) return round(size ? value : (context.explicitDisplay?.[axis] ?? 0) + value);
  const match = typeof value === "string" && value.match(GEOMETRY_VALUE);
  if (!match) return round(current);
  const [, sign, amount, percent, suffix] = match, n = Number(amount);
  if (percent) {
    const ref = geometryReference(context, suffix);
    if (!ref) return round(current);
    const delta = n / 100 * (axis === "x" ? ref.width : ref.height);
    return round(sign ? current + (sign === "-" ? -delta : delta) : size ? delta : ref[axis] + delta);
  }
  if (suffix && !sign) {
    const ref = geometryReference(context, suffix);
    return ref ? round(size ? n : ref[axis] + n) : round(current);
  }
  return sign && !suffix ? round(current + (sign === "-" ? -n : n)) : round(current);
}
function resolvePos(pos, relative, context, fallback = relative) {
  return Object.fromEntries(["x", "y"].map((axis) => [axis, pos?.[axis] == null ? Math.round(fallback[axis]) : geometryValue(pos[axis], axis, relative[axis], context)]));
}

const ANCHORS = { "top-left": [0, 0], top: [.5, 0], "top-right": [1, 0], left: [0, .5], center: [.5, .5], right: [1, .5], "bottom-left": [0, 1], bottom: [.5, 1], "bottom-right": [1, 1] };
function anchorSpec(at) {
  const match = String(at ?? "top-left").toLowerCase().match(/^(top-left|top|top-right|left|center|right|bottom-left|bottom|bottom-right)(wc|w|d)?$/);
  return { factors: ANCHORS[match?.[1] ?? "top-left"], suffix: match?.[2]?.toUpperCase() ?? null };
}
function geometryAnchor(context, at, fallback) {
  const { factors: [fx, fy], suffix } = anchorSpec(at), rect = (suffix && geometryReference(context, suffix)) || fallback;
  return { x: rect.x + rect.width * fx, y: rect.y + rect.height * fy };
}

function resolveRectAxis(rect, base, context, axis) {
  const horizontal = axis === "x", startKey = horizontal ? "left" : "top", endKey = horizontal ? "right" : "bottom", sizeKey = horizontal ? "width" : "height";
  const start = base[axis], size = base[sizeKey], end = start + size, factor = anchorSpec(rect.at).factors[horizontal ? 0 : 1];
  if (rect[startKey] != null || rect[endKey] != null) {
    const a = rect[startKey] == null ? start : geometryValue(rect[startKey], axis, start, context);
    const b = rect[endKey] != null ? geometryValue(rect[endKey], axis, end, context) : rect[sizeKey] != null ? a + geometryValue(rect[sizeKey], axis, size, context, true) : end;
    return [a, b];
  }
  const nextSize = rect[sizeKey] == null ? size : geometryValue(rect[sizeKey], axis, size, context, true);
  const anchor = geometryAnchor(context, rect.at, base)[axis];
  const nextAnchor = rect[axis] == null ? anchor : geometryValue(rect[axis], axis, anchor, context);
  const next = nextAnchor - nextSize * factor;
  return [next, next + nextSize];
}
function resolveRect(rect = {}, base, context) {
  const [left, right] = resolveRectAxis(rect, base, context, "x"), [top, bottom] = resolveRectAxis(rect, base, context, "y");
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
}
function positionRect(rect, pos, context) {
  if (!pos || (pos.x == null && pos.y == null)) return rect;
  const from = geometryAnchor(context, pos.at, rect), to = resolvePos(pos, from, context, from);
  return { ...rect, x: Math.round(rect.x + to.x - from.x), y: Math.round(rect.y + to.y - from.y) };
}

function cursorPoint() {
  const cursor = new Int32Array(2);
  return user32.symbols.GetCursorPos(cursor) ? { x: cursor[0], y: cursor[1] } : null;
}
function mouseTarget(info, display, pos, defaultAt) {
  const from = cursorPoint();
  if (!from) return null;
  const target = defaultAt ? { at: defaultAt, ...(pos ?? {}) } : pos, geometry = geometryContext(info, display);
  const rect = info?.rect ?? (display != null || target?.at != null ? geometry.display : null);
  const relative = rect ? geometryAnchor(geometry, target?.at, rect) : from;
  return { from, to: resolvePos(target, relative, geometry, target?.at == null ? from : relative) };
}

export async function mouse_move({ pos, display, duration = 0, steps, window } = {}) {
  const info = window == null ? null : windowRecords(window)[0], target = mouseTarget(info, display, pos);
  if (!target) return null;
  if (window != null && !info) return { pos: target.from };
  const { from, to } = target;
  duration = timeMs(duration);
  if (duration <= 0) return { pos: user32.symbols.SetCursorPos(to.x, to.y) ? to : from };
  steps ??= Math.max(2, Math.round(duration / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    user32.symbols.SetCursorPos(Math.round(from.x + (to.x - from.x) * t), Math.round(from.y + (to.y - from.y) * t));
    if (i < steps) await wait(duration / steps);
  }
  return { pos: to };
}

const mouseButtons = {
  left: { input: [2, 4], message: [WM_LBUTTONDOWN, WM_LBUTTONUP], state: 1 },
  right: { input: [8, 16], message: [WM_RBUTTONDOWN, WM_RBUTTONUP], state: 2 },
  middle: { input: [32, 64], message: [WM_MBUTTONDOWN, WM_MBUTTONUP], state: 16 },
};
function packMousePoint({ x, y }) { return BigInt(((x & 0xffff) | ((y & 0xffff) << 16)) >>> 0); }
function postMouseButton(hwnd, spec, down, point) {
  const client = clientRect(hwnd);
  if (!client) throw new Error("GetClientRect failed");
  const pos = { x: point.x - client.x, y: point.y - client.y };
  if (!user32.symbols.PostMessageW(hwnd, spec.message[down ? 0 : 1], BigInt(down ? spec.state : 0), packMousePoint(pos))) throw new Error("PostMessage(mouse button) failed");
}
function postMouseWheel(hwnd, amount, point) {
  const wParam = BigInt(((Math.round(amount * WHEEL_DELTA) & 0xffff) << 16) >>> 0);
  if (!user32.symbols.PostMessageW(hwnd, WM_MOUSEWHEEL, wParam, packMousePoint(point))) throw new Error("PostMessage(mouse wheel) failed");
}

export function mouse_button({ click, down, up, wheel, window, display, pos, repeat = 1, interval = 0 } = {}) {
  const actions = Object.entries({ click, down, up, wheel }).filter(([, value]) => value != null);
  if (actions.length !== 1) throw new Error("mouse_button requires exactly one of click, down, up, wheel");
  const [action, value] = actions[0];
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error(`Invalid repeat: ${repeat}`);
  if (repeat !== 1 && action !== "click") throw new Error("mouse_button repeat is only valid with click");
  const info = window == null ? null : windowRecords(window)[0];
  if (window != null && !info) return null;
  const target = mouseTarget(info, display, pos, info ? "centerWC" : null), point = target?.to, direct = !!info;
  if (!point || (!direct && pos != null && !user32.symbols.SetCursorPos(point.x, point.y))) return null;
  if (action === "wheel") {
    const amount = Number(value);
    if (!Number.isFinite(amount)) throw new Error(`Invalid wheel amount: ${value}`);
    direct ? postMouseWheel(asPointer(info.wid), amount, point) : mouseInput(MOUSEEVENTF_WHEEL, Math.round(amount * WHEEL_DELTA));
    return { wheel: amount, ...(direct && { wid: info.wid }), pos: point };
  }
  const button = String(value).toLowerCase(), spec = mouseButtons[button];
  if (!spec) throw new Error(`Unknown mouse button: ${value}`);
  const send = (down) => direct ? postMouseButton(asPointer(info.wid), spec, down, point) : mouseInput(spec.input[down ? 0 : 1]);
  interval = timeMs(interval);
  if (action === "click") for (let i = 0; i < repeat; i++) { send(true); send(false); if (interval && i + 1 < repeat) sleepSync(interval); }
  else send(action === "down");
  return { [action]: button, ...(repeat !== 1 && { repeat }), ...(direct && { wid: info.wid }), pos: point };
}

const VK = Object.fromEntries([
  [8,"backspace back"],[9,"tab"],[12,"clear"],[13,"enter return"],[16,"shift"],[17,"ctrl control"],[18,"alt"],[19,"pause"],[20,"capslock"],
  [27,"escape esc"],[32,"space"],[33,"pageup pgup"],[34,"pagedown pgdn"],[35,"end"],[36,"home"],[37,"left"],[38,"up"],[39,"right"],[40,"down"],
  [41,"select"],[42,"print"],[43,"execute"],[44,"printscreen prtsc snapshot"],[45,"insert ins"],[46,"delete del"],[47,"help"],
  [91,"lwin win"],[92,"rwin"],[93,"apps contextmenu"],[95,"sleep"],[106,"multiply"],[107,"add"],[108,"separator"],[109,"subtract"],[110,"decimal"],[111,"divide"],
  [144,"numlock"],[145,"scrolllock"],[160,"lshift"],[161,"rshift"],[162,"lctrl"],[163,"rctrl"],[164,"lalt"],[165,"ralt altgr"],
  [166,"browserback"],[167,"browserforward"],[168,"browserrefresh"],[169,"browserstop"],[170,"browsersearch"],[171,"browserfavorites"],[172,"browserhome"],
  [173,"volumemute"],[174,"volumedown"],[175,"volumeup"],[176,"medianext"],[177,"mediaprev"],[178,"mediastop"],[179,"mediaplaypause"],
  [180,"launchmail"],[181,"launchmedia"],[182,"launchapp1"],[183,"launchapp2"],[186,"oem1"],[187,"oemplus"],[188,"oemcomma"],[189,"oemminus"],[190,"oemperiod"],
  [191,"oem2"],[192,"oem3"],[219,"oem4"],[220,"oem5"],[221,"oem6"],[222,"oem7"],[223,"oem8"],[226,"oem102"],
].flatMap(([code, names]) => names.split(" ").map((name) => [name, code])));

function keyboardInput(vk, scan, flags) { sendInput(INPUT_KEYBOARD, (v) => { v.setUint16(8, vk, true); v.setUint16(10, scan, true); v.setUint32(12, flags, true); }, "keyboard"); }

function foregroundKeyboardLayout() {
  const window = user32.symbols.GetForegroundWindow(), tid = window ? user32.symbols.GetWindowThreadProcessId(window, new Uint32Array(1)) : 0;
  return user32.symbols.GetKeyboardLayout(tid);
}
function virtualKey(name) {
  if (typeof name === "number") return name;
  const key = String(name).toLowerCase();
  if (/^[a-z]$/.test(key)) return key.charCodeAt(0) - 32;
  if (/^\d$/.test(key)) return key.charCodeAt(0);
  const f = key.match(/^f(\d{1,2})$/), n = key.match(/^numpad(\d)$/);
  if (f && +f[1] >= 1 && +f[1] <= 24) return 0x6f + +f[1];
  if (n) return 0x60 + +n[1];
  return VK[key] ?? null;
}
function keyFlags(vk, layout, up = false) {
  const prefix = (user32.symbols.MapVirtualKeyExW(vk, 4, layout) >>> 8) & 0xff;
  return ((prefix === 0xe0 || prefix === 0xe1) ? KEYEVENTF_EXTENDEDKEY : 0) | (up ? KEYEVENTF_KEYUP : 0);
}
function sendVirtualKey(vk, down, layout = foregroundKeyboardLayout()) { keyboardInput(vk, 0, keyFlags(vk, layout, !down)); }

function keySequence(name, layout) {
  const vk = virtualKey(name);
  if (vk != null) return [vk];
  if (typeof name !== "string" || name.length !== 1) return null;
  const mapped = user32.symbols.VkKeyScanExW(name.charCodeAt(0), layout);
  if (mapped === -1) return null;
  const key = mapped & 0xff, state = (mapped >>> 8) & 0xff, keys = [];
  if ((state & 6) === 6) keys.push(0xa5); else { if (state & 2) keys.push(0x11); if (state & 4) keys.push(0x12); }
  if (state & 1) keys.push(0x10);
  return [...keys, key];
}

function keyState(name, down) {
  const layout = foregroundKeyboardLayout(), keys = keySequence(name, layout);
  if (!keys || keys.length !== 1) return false;
  try { sendVirtualKey(keys[0], down, layout); return true; } catch { return false; }
}
function keyNames(value) { return Array.isArray(value) ? value : value == null ? [] : [value]; }

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
  try { keyboardInput(0, code, KEYEVENTF_UNICODE); keyboardInput(0, code, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP); return true; } catch { return false; }
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
  const bytes = Uint8Array.from(text.replace(/[{}-]/g, "").match(/../g), (x) => parseInt(x, 16));
  return Uint8Array.of(bytes[3], bytes[2], bytes[1], bytes[0], bytes[5], bytes[4], bytes[7], bytes[6], ...bytes.slice(8));
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

function comPtr(object, index, args = [], parameters = args.map(() => "pointer"), label) {
  const { hr, out } = comOut(object, index, BigUint64Array, 1, args, parameters);
  if (label) checkHR(hr, label); else if (hr < 0) return null;
  return asPointer(out[0]);
}
function comRelease(...objects) { for (const object of objects) if (object) comCall(object, 2, "u32"); }
function comUse(object, fn) { if (!object) return null; try { return fn(object); } finally { comRelease(object); } }
function comQuery(object, iid) { return comPtr(object, 0, [guid(iid)], ["buffer"], "QueryInterface"); }

const CLSID_CUIAutomation = "ff48dba4-60ef-4201-aa87-54103eef594e";
const IID_IUIAutomation = "30cbe57d-d9d0-452a-ab13-7ac5ac4825ee";
const CLSCTX_INPROC_SERVER = 1;

const UIA_TYPES = "button calendar check-box combo-box edit hyperlink image list-item list menu menu-bar menu-item progress-bar radio-button scroll-bar slider spinner status-bar tab tab-item text tool-bar tool-tip tree tree-item custom group thumb data-grid data-item document split-button window pane header header-item table title-bar separator semantic-zoom app-bar".split(" ");

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

  uiaWalker = comPtr(uiaAutomation, 14, [], [], "IUIAutomation.ControlViewWalker");
  if (!uiaWalker) { comRelease(uiaAutomation); uiaAutomation = null; throw new Error("UI Automation ControlViewWalker unavailable"); }
}

function uiaRootElement() { ensureUia(); return comPtr(uiaAutomation, 5); }
function uiaElementFromHandle(hwnd) { if (!hwnd) return null; ensureUia(); return comPtr(uiaAutomation, 6, [hwnd]); }
function uiaParent(element) { ensureUia(); return comPtr(uiaWalker, 3, [element]); }
function uiaFirstChild(element) { ensureUia(); return comPtr(uiaWalker, 4, [element]); }
function uiaNextSibling(element) { ensureUia(); return comPtr(uiaWalker, 6, [element]); }

function uiaInt(element, index) { const r = comOut(element, index, Int32Array); return r.hr >= 0 ? r.out[0] : null; }
function uiaBool(element, index) { const value = uiaInt(element, index); return value == null ? null : !!value; }
function bstrText(pointer) { const n = pointer ? oleaut32.symbols.SysStringLen(pointer) : 0; return n ? textDecoder16.decode(new Uint8Array(new Deno.UnsafePointerView(pointer).getArrayBuffer(n * 2))) : ""; }
function uiaBstr(element, index) {
  const pointer = comPtr(element, index);
  if (!pointer) return "";
  try { return bstrText(pointer); } finally { oleaut32.symbols.SysFreeString(pointer); }
}
function uiaNativeWid(element) { const pointer = comPtr(element, 36); return pointer ? ptrId(pointer) : null; }

function uiaRect(element) {
  const { hr, out: rect } = comOut(element, 43, Int32Array, 4);
  return hr < 0 ? null : { x: rect[0], y: rect[1], width: rect[2] - rect[0], height: rect[3] - rect[1] };
}

function uiaRuntimeId(element) {
  const result = comOut(element, 4);
  if (result.hr < 0 || !result.out[0]) return null;
  const array = asPointer(result.out[0]), lower = new Int32Array(1), upper = new Int32Array(1), data = new BigUint64Array(1);
  let accessed = false;
  try {
    if (oleaut32.symbols.SafeArrayGetLBound(array, 1, lower) < 0 || oleaut32.symbols.SafeArrayGetUBound(array, 1, upper) < 0) return null;
    const count = upper[0] - lower[0] + 1;
    if (count <= 0) return [];
    if (oleaut32.symbols.SafeArrayAccessData(array, data) < 0 || !data[0]) return null;
    accessed = true;
    return [...new Int32Array(new Deno.UnsafePointerView(asPointer(data[0])).getArrayBuffer(count * 4))];
  } finally {
    if (accessed) oleaut32.symbols.SafeArrayUnaccessData(array);
    oleaut32.symbols.SafeArrayDestroy(array);
  }
}

function uiaVariant(element, propertyId) {
  const variant = new Uint8Array(24);
  if (comCall(element, 10, "i32", ["i32", "buffer"], [propertyId, variant]) < 0) return null;
  try {
    const view = new DataView(variant.buffer), type = view.getUint16(0, true);
    if (type === 3) return view.getInt32(8, true);
    if (type === 5) return view.getFloat64(8, true);
    if (type === 8) return bstrText(asPointer(view.getBigUint64(8, true)));
    if (type === 11) return view.getInt16(8, true) !== 0;
    if (type === 19) return view.getUint32(8, true);
    return null;
  } finally { oleaut32.symbols.VariantClear(variant); }
}

function uiaTypeName(id) { return id == null ? null : UIA_TYPES[Number(id) - 50000] ?? String(id); }
function normalizeUiaType(value) { return typeof value === "number" ? uiaTypeName(value) : String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-"); }

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
  };
}

function normalizeUiaFilter(filter) { return filter == null ? {} : typeof filter === "string" ? { name: filter } : filter; }

const A11Y_FIELDS = {
  uid: [false, filterExact], wid: [true, filterId], pid: [false, filterNum],
  aid: [false, regexFilter], name: [false, regexFilter], type: [false, (a, b) => anyFilter(b, (v) => a === normalizeUiaType(v))],
  class: [false, regexFilter], framework: [false, regexFilter], value: [false, regexFilter],
  enabled: [false, filterBool], focus: [false, filterBool], focusable: [false, filterBool], offscreen: [false, filterBool],
};
function matchesUiaOwn(record, filter) { return matchesFields(record, filter, A11Y_FIELDS); }

function uiaWalk(root, direction, maxDepth, visitor) {
  if (direction === "up") {
    let current = uiaParent(root);
    for (let depth = 1; current && depth <= maxDepth; depth++) {
      let next = null;
      try { if (visitor(current, depth)) return true; if (depth < maxDepth) next = uiaParent(current); }
      finally { comRelease(current); }
      current = next;
    }
    return false;
  }
  function down(parent, depth) {
    let child = uiaFirstChild(parent);
    while (child) {
      let next = null;
      try { if (visitor(child, depth) || (depth < maxDepth && down(child, depth + 1))) return true; next = uiaNextSibling(child); }
      finally { comRelease(child); }
      child = next;
    }
    return false;
  }
  return maxDepth >= 1 && down(root, 1);
}

function uiaWindowTargetSet(filter) { return new Set(windowRecords(filter ?? {}).map((window) => window.wid.toLowerCase())); }
function matchesUiaRelation(element, direction, spec) {
  const relation = relationSpec(spec, "a11y");
  if (!relation) return false;
  if (relation.domain === "window") {
    const targets = uiaWindowTargetSet(relation.filter);
    return !!targets.size && uiaWalk(element, direction, relation.depth, (candidate) => {
      const wid = uiaNativeWid(candidate); return !!wid && targets.has(wid.toLowerCase());
    });
  }
  return uiaWalk(element, direction, relation.depth, (candidate) => {
    const record = uiaRecord(candidate); return matchesUia(candidate, record, relation.filter);
  });
}
function matchesUia(element, record, filter) {
  filter = normalizeUiaFilter(filter);
  return matchesUiaOwn(record, filter)
    && (filter.up == null || matchesUiaRelation(element, "up", filter.up))
    && (filter.down == null || matchesUiaRelation(element, "down", filter.down));
}
function matchesWindowUiaRelation(window, direction, relation) {
  return !!comUse(uiaElementFromHandle(asPointer(window.wid)), (root) => uiaWalk(root, direction, relation.depth, (candidate) => {
    const record = uiaRecord(candidate); return matchesUia(candidate, record, relation.filter);
  }));
}

function uiaCollectFromRoot(root, filter, maxDepth, found, seen, limit) {
  return uiaWalk(root, "down", maxDepth, (element) => {
    const record = uiaRecord(element);
    if (!matchesUia(element, record, filter)) return false;
    const key = record.uid ?? `${record.wid ?? ""}:${record.pid ?? ""}:${record.name}:${record.type}:${record.rect?.x ?? ""}:${record.rect?.y ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      found.push(record);
    }
    return found.length >= limit;
  });
}

export function a11y_find({ a11y = {}, limit = 0 } = {}) {
  const max = findLimit(limit), filter = normalizeUiaFilter(a11y), found = [], seen = new Set();
  if (max == null) return [];
  const collect = (root, depth) => comUse(root, (element) => uiaCollectFromRoot(element, filter, depth, found, seen, max));
  if (own(filter, "wid") && filter.wid != null && !Array.isArray(filter.wid)) {
    const record = comUse(uiaElementFromHandle(asPointer(filter.wid)), (element) => {
      const value = uiaRecord(element); return matchesUia(element, value, filter) ? value : null;
    });
    return record ? [record] : [];
  }
  const up = filter.up == null ? null : relationSpec(filter.up, "a11y");
  if (up?.domain === "window") {
    for (const window of windowRecords(up.filter)) {
      collect(uiaElementFromHandle(asPointer(window.wid)), up.depth);
      if (found.length >= max) break;
    }
  } else collect(uiaRootElement(), Infinity);
  return found;
}

let roReady = false;
function ensureRo() {
  if (roReady) return;
  const hr = combase.symbols.RoInitialize(1);
  if (hr < 0 && (hr >>> 0) !== 0x80010106) checkHR(hr, "RoInitialize");
  roReady = true;
}
function createHString(text) {
  const chars = wide(text), out = new BigUint64Array(1);
  checkHR(combase.symbols.WindowsCreateString(chars, chars.length, out), "WindowsCreateString");
  return asPointer(out[0]);
}
function hstringText(hstring, free = true) {
  if (!hstring) return "";
  try {
    const length = new Uint32Array(1), pointer = combase.symbols.WindowsGetStringRawBuffer(hstring, length);
    return pointer && length[0] ? textDecoder16.decode(new Uint8Array(new Deno.UnsafePointerView(pointer).getArrayBuffer(length[0] * 2))) : "";
  } finally { if (free) combase.symbols.WindowsDeleteString(hstring); }
}
function activationFactory(className, iid) {
  ensureRo();
  const name = createHString(className), out = new BigUint64Array(1);
  try { checkHR(combase.symbols.RoGetActivationFactory(name, guid(iid), out), `RoGetActivationFactory(${className})`); }
  finally { combase.symbols.WindowsDeleteString(name); }
  return asPointer(out[0]);
}

const IID_IBufferFactory = "71af914d-c10f-484b-bc50-14bc623b3a27", IID_IBufferByteAccess = "905a0fef-bc53-11df-8c49-001e4fc686da";
const IID_ISoftwareBitmapStatics = "df0385db-672f-4a9d-806e-c2442f343e86", IID_IOcrEngineStatics = "5bffa85a-3384-3540-9940-699120d428a8", IID_IAsyncInfo = "00000036-0000-0000-c000-000000000046";

function softwareBitmapFromBGRA(image) {
  const factory = activationFactory("Windows.Storage.Streams.Buffer", IID_IBufferFactory);
  let buffer, access, statics;
  try {
    buffer = comPtr(factory, 6, [image.data.length], ["u32"], "IBufferFactory.Create");
    checkHR(comCall(buffer, 8, "i32", ["u32"], [image.data.length]), "IBuffer.SetLength");
    access = comQuery(buffer, IID_IBufferByteAccess);
    const bytes = comPtr(access, 3, [], [], "IBufferByteAccess.Buffer");
    ntdll.symbols.RtlMoveMemory(bytes, image.data, image.data.length);
    statics = activationFactory("Windows.Graphics.Imaging.SoftwareBitmap", IID_ISoftwareBitmapStatics);
    return comPtr(statics, 9, [buffer, 87, image.rect.width, image.rect.height], ["pointer", "i32", "i32", "i32"], "SoftwareBitmap.CreateCopyFromBuffer");
  } finally { comRelease(statics, access, buffer, factory); }
}

async function asyncResult(operation) {
  const info = comQuery(operation, IID_IAsyncInfo);
  try {
    for (;;) {
      const status = comOut(info, 7, Int32Array);
      checkHR(status.hr, "IAsyncInfo.Status");
      if (status.out[0] === 1) break;
      if (status.out[0] === 2) throw new Error("WinRT operation canceled");
      if (status.out[0] === 3) {
        const error = comOut(info, 8, Int32Array).out[0];
        throw new Error(`WinRT operation failed: HRESULT 0x${(error >>> 0).toString(16)}`);
      }
      await wait(5);
    }
    return comPtr(operation, 8, [], [], "IAsyncOperation.GetResults");
  } finally { comRelease(info); }
}

export async function ocr(options = {}) {
  const image = options.image ?? captureScreenshot(options);
  if (!image) return null;
  const bitmap = softwareBitmapFromBGRA(image), statics = activationFactory("Windows.Media.Ocr.OcrEngine", IID_IOcrEngineStatics);
  let engine, operation, result;
  try {
    engine = comPtr(statics, 10, [], [], "OcrEngine.TryCreateFromUserProfileLanguages");
    if (!engine) throw new Error("Windows OCR engine unavailable for user languages");
    operation = comPtr(engine, 6, [bitmap], ["pointer"], "OcrEngine.RecognizeAsync");
    result = await asyncResult(operation);
    return { text: hstringText(comPtr(result, 8, [], [], "OcrResult.Text")), rect: image.rect };
  } finally { comRelease(result, operation, engine, statics, bitmap); }
}

function paeth(a, b, c) {
  const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}

async function readPng(path) {
  const bytes = await Deno.readFile(path), signature = [137,80,78,71,13,10,26,10];
  if (bytes.length < 8 || signature.some((byte, i) => bytes[i] !== byte)) return null;
  let width = 0, height = 0, depth = 0, color = -1, interlace = 0, offset = 8;
  const idat = [];
  while (offset + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
    if (offset + length + 12 > bytes.length) return null;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)), data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      if (length !== 13) return null;
      const view = new DataView(data.buffer, data.byteOffset, 13);
      width = view.getUint32(0, false); height = view.getUint32(4, false); depth = data[8]; color = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data.slice());
    else if (type === "IEND") break;
    offset += length + 12;
  }
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[color];
  if (!width || !height || depth !== 8 || !channels || interlace || !idat.length) return null;
  const raw = new Uint8Array(await new Response(new Blob([concat(...idat)]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  const rowBytes = width * channels, pixels = new Uint8Array(rowBytes * height);
  if (raw.length < (rowBytes + 1) * height) return null;
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++], row = y * rowBytes;
    if (filter > 4) return null;
    for (let x = 0; x < rowBytes; x++) {
      const left = x >= channels ? pixels[row + x - channels] : 0, up = y ? pixels[row - rowBytes + x] : 0, corner = y && x >= channels ? pixels[row - rowBytes + x - channels] : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, corner);
      pixels[row + x] = (raw[src++] + prediction) & 255;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    const out = i * 4, gray = color === 0 || color === 4;
    data[out] = gray ? pixels[p] : pixels[p + 2]; data[out + 1] = pixels[p + (gray ? 0 : 1)]; data[out + 2] = pixels[p];
    data[out + 3] = color === 4 ? pixels[p + 1] : color === 6 ? pixels[p + 3] : 255;
  }
  return { rect: { x: 0, y: 0, width, height }, format: "bgra8", data };
}

function rgbDiff(a, ai, b, bi) { return Math.abs(a[ai] - b[bi]) + Math.abs(a[ai + 1] - b[bi + 1]) + Math.abs(a[ai + 2] - b[bi + 2]); }
function imageScoreAt(source, template, ox, oy, threshold) {
  const sw = source.rect.width, tw = template.rect.width, th = template.rect.height, total = tw * th * 765, max = (1 - threshold) * total;
  let diff = 0;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    diff += rgbDiff(source.data, ((oy + y) * sw + ox + x) * 4, template.data, (y * tw + x) * 4);
    if (diff > max) return 0;
  }
  return 1 - diff / total;
}
function imageProbe(source, template, ox, oy, threshold) {
  const sw = source.rect.width, tw = template.rect.width, th = template.rect.height;
  const xs = [...new Set([0, tw >> 1, tw - 1])], ys = [...new Set([0, th >> 1, th - 1])];
  let diff = 0, count = 0;
  for (const y of ys) for (const x of xs) { diff += rgbDiff(source.data, ((oy + y) * sw + ox + x) * 4, template.data, (y * tw + x) * 4); count++; }
  return 1 - diff / (count * 765) >= Math.max(0, threshold - .03);
}
function findImage(source, template, similarity = .98) {
  if (!source || !template) return null;
  similarity = Math.max(0, Math.min(1, Number(similarity)));
  const { width: sw, height: sh } = source.rect, { width: tw, height: th } = template.rect;
  if (tw > sw || th > sh) return null;
  for (let y = 0; y <= sh - th; y++) for (let x = 0; x <= sw - tw; x++) {
    if (!imageProbe(source, template, x, y, similarity)) continue;
    const score = imageScoreAt(source, template, x, y, similarity);
    if (score >= similarity) return { rect: { x: source.rect.x + x, y: source.rect.y + y, width: tw, height: th }, similarity: score };
  }
  return null;
}

function imageChange(before, after) {
  if (!before || !after) return null;
  const { width, height } = after.rect, total = width * height;
  if (!total) return null;
  if (before.rect.width !== width || before.rect.height !== height) return { rect: after.rect, changed: total, percent: 100, bounds: after.rect };
  let changed = 0, minX = width, minY = height, maxX = -1, maxY = -1;
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (!rgbDiff(before.data, i, after.data, i)) continue;
    const x = p % width, y = Math.floor(p / width); changed++;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const bounds = changed ? { x: after.rect.x + minX, y: after.rect.y + minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null;
  return { rect: after.rect, changed, percent: changed * 100 / total, bounds };
}

async function prepareWaitCondition(kind, spec) {
  if (kind === "window") return { window: spec };
  if (kind === "ocr") return spec && typeof spec === "object" && spec.text != null ? spec : null;
  if (kind === "image") {
    if (typeof spec === "string") spec = { path: spec };
    if (!spec || typeof spec !== "object" || !spec.path) return null;
    const template = await readPng(spec.path); return template && { spec, template };
  }
  if (kind !== "change") return null;
  spec ??= {};
  if (typeof spec !== "object" || Array.isArray(spec)) return null;
  const percent = spec.percent == null ? 0 : Number(spec.percent);
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? { spec, baseline: null } : null;
}

async function testWaitCondition(kind, prepared) {
  const none = { matched: false, value: null };
  try {
    if (kind === "window") { const value = window_get(prepared); return { matched: !!value, value }; }
    if (kind === "ocr") { const { text, ...source } = prepared, value = await ocr(source); return { matched: !!value && regexMatch(value.text, text), value }; }
    if (kind === "image") {
      const { path, similarity = .98, ...source } = prepared.spec, match = findImage(captureScreenshot(source), prepared.template, similarity);
      return { matched: !!match, value: match ? { path, ...match } : null };
    }
    if (kind === "change") {
      const { percent, ...source } = prepared.spec, image = captureScreenshot(source);
      if (!image) return none;
      if (!prepared.baseline) { prepared.baseline = image; return { ready: false, ...none }; }
      const value = imageChange(prepared.baseline, image);
      return { matched: !!value?.changed && value.percent >= Number(percent ?? 0), value };
    }
  } catch { /* unavailable target = false sample */ }
  return none;
}

function resourceRefs(value, resources, found = new Set(), seen = new Set()) {
  if (typeof value === "string") { if (resources.has(value)) found.add(value); return found; }
  if (!value || typeof value !== "object" || seen.has(value)) return found;
  seen.add(value);
  for (const item of Object.values(value)) resourceRefs(item, resources, found, seen);
  return found;
}

function imageResource(resources, id) { const r = typeof id === "string" && resources.get(id); return r?.kind === "image" ? r.value : null; }
function imageResult(id, image, saved = {}) { return { image: id, rect: image.rect, grayscale: image.grayscale, ...saved }; }

function collectScenarioResources(resources, context) {
  const state = resourceRefs(context.state, resources), prev = resourceRefs(context.prev, resources);
  for (const [id, resource] of resources) {
    if (state.has(id)) resource.retained = true;
    else if (resource.retained || !prev.has(id)) resources.delete(id);
  }
}

async function scenarioScreenshot(options, resources) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return null;
  const { save, format = "png", ...capture } = options, image = captureScreenshot(capture);
  if (!image) return null;
  const id = crypto.randomUUID();
  resources.set(id, { kind: "image", value: image, retained: false });
  try { return imageResult(id, image, await saveImage(image, save, format)); }
  catch (error) { resources.delete(id); throw error; }
}

async function scenarioScreenshotSave(options, resources) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return null;
  const { image: id, save, format = "png" } = options, resource = resources.get(id);
  if (!save || !resource?.retained || resource.kind !== "image") return null;
  return imageResult(id, resource.value, await saveImage(resource.value, save, format));
}

function resolveActionResources(name, value, resources) {
  if (name !== "ocr" || !value || typeof value !== "object" || typeof value.image !== "string") return { ok: true, value };
  const image = imageResource(resources, value.image);
  return image ? { ok: true, value: { ...value, image } } : { ok: false };
}

const ACTIONS = { wait, window_control, window_set, mouse_move, mouse_button, keyb, clipboard, ocr, window_find, window_get, a11y_find, display_find, system, window_hit, highlight };

const SCENARIO_PATH = /^\$\.(prev|state)((?:\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\])*)$/;
const STATE_PATH = /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/;

function scenarioPath(path) {
  const match = typeof path === "string" ? path.match(SCENARIO_PATH) : null;
  if (!match) return null;
  const tail = [...match[2].matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)|\[(\d+)\]/g)];
  return [match[1], ...tail.map((x) => x[1] ?? Number(x[2]))];
}

function scenarioReference(path, context) {
  const parts = scenarioPath(path);
  if (!parts) return { ok: false };
  let value = context[parts[0]];
  for (const key of parts.slice(1)) {
    if (value == null || !own(Object(value), key)) return { ok: false };
    value = value[key];
  }
  return { ok: true, value: structuredClone(value) };
}

function scenarioText(value) { return typeof value === "string" ? value : value && typeof value === "object" ? JSON.stringify(value) : String(value); }
function regexEscape(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function resolveScenarioString(value, context) {
  if (value.startsWith("$.")) return scenarioReference(value, context);
  let ok = true;
  const text = value.replace(/<<([^<>]+)>>/g, (placeholder, expression) => {
    const match = expression.match(/^(\$\..*?)(?:\|(re))?$/);
    if (!match) return placeholder;
    const resolved = scenarioReference(match[1], context);
    if (!resolved.ok) { ok = false; return ""; }
    const text = scenarioText(resolved.value);
    return match[2] ? regexEscape(text) : text;
  });
  return ok ? { ok, value: text } : { ok };
}

function resolveScenarioValue(value, context) {
  if (typeof value === "string") return resolveScenarioString(value, context);
  if (!value || typeof value !== "object") return { ok: true, value };
  const out = Array.isArray(value) ? [] : {};
  for (const [key, item] of Object.entries(value)) {
    const resolved = resolveScenarioValue(item, context);
    if (!resolved.ok) return resolved;
    out[key] = resolved.value;
  }
  return { ok: true, value: out };
}

function statePath(value) { return typeof value === "string" && STATE_PATH.test(value) ? value.split(".") : null; }
function stateKey(value) {
  if (typeof value !== "string") return null;
  const push = value.startsWith("&");
  const path = statePath(push ? value.slice(1) : value);
  return path ? { push, path } : null;
}

function stateParent(root, path, create) {
  let target = root;
  for (const key of path.slice(0, -1)) {
    if (!own(target, key) || !target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) {
      if (!create) return null;
      target[key] = Object.create(null);
    }
    target = target[key];
  }
  return target;
}

function compileState(value, context, prefix = [], ops = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const [rawKey, item] of Object.entries(value)) {
    const key = stateKey(rawKey);
    if (!key) return null;
    const path = [...prefix, ...key.path];
    if (key.push) {
      const resolved = resolveScenarioValue(item, context);
      if (!resolved.ok) return null;
      ops.push(["push", path, resolved.value]);
    } else if (typeof item === "string" && item.startsWith("$.")) {
      const resolved = scenarioReference(item, context);
      if (!resolved.ok) return null;
      ops.push(["set", path, resolved.value]);
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      if (!Object.keys(item).length) ops.push(["object", path]);
      else if (!compileState(item, context, path, ops)) return null;
    } else {
      const resolved = resolveScenarioValue(item, context);
      if (!resolved.ok) return null;
      ops.push(["set", path, resolved.value]);
    }
  }
  return ops;
}

function resolveStateAction(value, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const patch = {}, remove = [];
  for (const [key, item] of Object.entries(value)) {
    if (key !== "-") { patch[key] = item; continue; }
    if (!Array.isArray(item)) return null;
    for (const name of item) {
      const resolved = resolveScenarioValue(name, context);
      const path = resolved.ok && statePath(resolved.value);
      if (!path) return null;
      remove.push(path);
    }
  }
  const ops = compileState(patch, context);
  return ops ? { ops, remove } : null;
}

function applyStateOps(root, ops) {
  for (const [op, path, value] of ops) {
    const parent = stateParent(root, path, true), leaf = path.at(-1);
    if (op === "push") {
      if (!own(parent, leaf)) parent[leaf] = [];
      if (!Array.isArray(parent[leaf])) return false;
      parent[leaf].push(structuredClone(value));
    } else if (op === "object") {
      if (!own(parent, leaf) || !parent[leaf] || typeof parent[leaf] !== "object" || Array.isArray(parent[leaf])) parent[leaf] = Object.create(null);
    } else parent[leaf] = structuredClone(value);
  }
  return true;
}

export async function run(actions = []) {
  const results = [], context = { prev: null, state: Object.create(null) }, resources = new Map();
  try {
    for (const action of actions) {
      const entries = Object.entries(action);
      if (entries.length !== 1) throw new Error(`Each action must contain exactly one command: ${JSON.stringify(action)}`);
      const [name, params] = entries[0];

      if (name === "state") {
        const resolved = resolveStateAction(params, context);
        let result = null;
        if (resolved) {
          const next = structuredClone(context.state);
          if (applyStateOps(next, resolved.ops)) {
            for (const path of resolved.remove) {
              const parent = stateParent(next, path, false);
              if (parent) delete parent[path.at(-1)];
            }
            context.state = next;
            result = structuredClone(next);
          }
        }
        results.push(result);
        collectScenarioResources(resources, context);
        continue;
      }

      let result = null;
      const resolved = resolveScenarioValue(params, context);
      if (resolved.ok) try {
        const value = resolved.value ?? {};
        if (name === "screenshot") result = await scenarioScreenshot(value, resources);
        else if (name === "screenshot_save") result = await scenarioScreenshotSave(value, resources);
        else if (ACTIONS[name]) {
          const prepared = resolveActionResources(name, value, resources);
          if (prepared.ok) result = await ACTIONS[name](prepared.value);
        }
      } catch { /* best effort */ }
      results.push(result);
      context.prev = result;
      collectScenarioResources(resources, context);
    }
    return results;
  } finally { resources.clear(); }
}
