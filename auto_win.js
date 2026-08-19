import sharp from "npm:sharp";

// auto.js — Windows desktop automation for Deno.
// Current target: Windows x64 + Deno. Native OS APIs + Sharp for image codecs.
if (Deno.build.os !== "windows" || Deno.build.arch !== "x86_64") {
  throw new Error("auto.js currently supports Windows x64 only");
}

const user32 = Deno.dlopen("user32.dll", {
  EnumWindows: { parameters: ["pointer", "pointer"], result: "i32" },
  EnumChildWindows: {
    parameters: ["pointer", "pointer", "pointer"],
    result: "i32",
  },
  EnumDisplayMonitors: {
    parameters: ["pointer", "pointer", "pointer", "pointer"],
    result: "i32",
  },
  GetMonitorInfoW: { parameters: ["pointer", "buffer"], result: "i32" },
  GetWindowTextLengthW: { parameters: ["pointer"], result: "i32" },
  GetWindowTextW: { parameters: ["pointer", "buffer", "i32"], result: "i32" },
  GetClassNameW: { parameters: ["pointer", "buffer", "i32"], result: "i32" },
  GetWindowThreadProcessId: {
    parameters: ["pointer", "buffer"],
    result: "u32",
  },
  GetKeyboardLayout: { parameters: ["u32"], result: "pointer" },
  VkKeyScanExW: { parameters: ["u16", "pointer"], result: "i16" },
  MapVirtualKeyExW: { parameters: ["u32", "u32", "pointer"], result: "u32" },
  GetWindowRect: { parameters: ["pointer", "buffer"], result: "i32" },
  GetWindowLongW: { parameters: ["pointer", "i32"], result: "i32" },
  SetWindowLongW: { parameters: ["pointer", "i32", "i32"], result: "i32" },
  GetWindow: { parameters: ["pointer", "u32"], result: "pointer" },
  GetClientRect: { parameters: ["pointer", "buffer"], result: "i32" },
  ClientToScreen: { parameters: ["pointer", "buffer"], result: "i32" },
  IsWindowVisible: { parameters: ["pointer"], result: "i32" },
  IsWindowEnabled: { parameters: ["pointer"], result: "i32" },
  IsIconic: { parameters: ["pointer"], result: "i32" },
  IsZoomed: { parameters: ["pointer"], result: "i32" },
  MonitorFromWindow: { parameters: ["pointer", "u32"], result: "pointer" },
  ShowWindow: { parameters: ["pointer", "i32"], result: "i32" },
  SetWindowPos: {
    parameters: ["pointer", "pointer", "i32", "i32", "i32", "i32", "u32"],
    result: "i32",
  },
  SetForegroundWindow: { parameters: ["pointer"], result: "i32" },
  BringWindowToTop: { parameters: ["pointer"], result: "i32" },
  SetFocus: { parameters: ["pointer"], result: "pointer" },
  GetForegroundWindow: { parameters: [], result: "pointer" },
  GetGUIThreadInfo: { parameters: ["u32", "buffer"], result: "i32" },
  AttachThreadInput: { parameters: ["u32", "u32", "i32"], result: "i32" },
  PostMessageW: {
    parameters: ["pointer", "u32", "usize", "isize"],
    result: "i32",
  },
  SendMessageTimeoutW: {
    parameters: ["pointer", "u32", "usize", "pointer", "u32", "u32", "buffer"],
    result: "isize",
  },
  EnableWindow: { parameters: ["pointer", "i32"], result: "i32" },
  SetLayeredWindowAttributes: {
    parameters: ["pointer", "u32", "u8", "u32"],
    result: "i32",
  },
  GetDC: { parameters: ["pointer"], result: "pointer" },
  ReleaseDC: { parameters: ["pointer", "pointer"], result: "i32" },
  RegisterClassExW: { parameters: ["buffer"], result: "u16" },
  CreateWindowExW: {
    parameters: [
      "u32",
      "buffer",
      "buffer",
      "u32",
      "i32",
      "i32",
      "i32",
      "i32",
      "pointer",
      "pointer",
      "pointer",
      "pointer",
    ],
    result: "pointer",
  },
  DefWindowProcW: {
    parameters: ["pointer", "u32", "usize", "isize"],
    result: "isize",
  },
  DestroyWindow: { parameters: ["pointer"], result: "i32" },
  UpdateWindow: { parameters: ["pointer"], result: "i32" },
  FillRect: { parameters: ["pointer", "buffer", "pointer"], result: "i32" },
  PrintWindow: { parameters: ["pointer", "pointer", "u32"], result: "i32" },
  SetCursorPos: { parameters: ["i32", "i32"], result: "i32" },
  GetCursorPos: { parameters: ["buffer"], result: "i32" },
  SendInput: { parameters: ["u32", "buffer", "i32"], result: "u32" },
  WindowFromPoint: { parameters: ["u64"], result: "pointer" },
  GetAncestor: { parameters: ["pointer", "u32"], result: "pointer" },
  SetProcessDPIAware: { parameters: [], result: "i32" },
  OpenClipboard: { parameters: ["pointer"], result: "i32" },
  CloseClipboard: { parameters: [], result: "i32" },
  EmptyClipboard: { parameters: [], result: "i32" },
  GetClipboardData: { parameters: ["u32"], result: "pointer" },
  SetClipboardData: { parameters: ["u32", "pointer"], result: "pointer" },
  IsClipboardFormatAvailable: { parameters: ["u32"], result: "i32" },
});
const kernel32 = Deno.dlopen("kernel32.dll", {
  OpenProcess: { parameters: ["u32", "i32", "u32"], result: "pointer" },
  QueryFullProcessImageNameW: {
    parameters: ["pointer", "u32", "buffer", "buffer"],
    result: "i32",
  },
  CloseHandle: { parameters: ["pointer"], result: "i32" },
  GetCurrentThreadId: { parameters: [], result: "u32" },
  GlobalAlloc: { parameters: ["u32", "usize"], result: "pointer" },
  GlobalLock: { parameters: ["pointer"], result: "pointer" },
  GlobalUnlock: { parameters: ["pointer"], result: "i32" },
  GlobalFree: { parameters: ["pointer"], result: "pointer" },
  GetModuleHandleW: { parameters: ["pointer"], result: "pointer" },
  SetThreadExecutionState: { parameters: ["u32"], result: "u32" },
});
const gdi32 = Deno.dlopen("gdi32.dll", {
  CreateCompatibleDC: { parameters: ["pointer"], result: "pointer" },
  DeleteDC: { parameters: ["pointer"], result: "i32" },
  CreateDIBSection: {
    parameters: ["pointer", "buffer", "u32", "buffer", "pointer", "u32"],
    result: "pointer",
  },
  SelectObject: { parameters: ["pointer", "pointer"], result: "pointer" },
  DeleteObject: { parameters: ["pointer"], result: "i32" },
  CreateSolidBrush: { parameters: ["u32"], result: "pointer" },
  BitBlt: {
    parameters: [
      "pointer",
      "i32",
      "i32",
      "i32",
      "i32",
      "pointer",
      "i32",
      "i32",
      "u32",
    ],
    result: "i32",
  },
});
const ntdll = Deno.dlopen("ntdll.dll", {
  RtlMoveMemory: { parameters: ["pointer", "buffer", "usize"], result: "void" },
});
const wtsapi32 = Deno.dlopen("wtsapi32.dll", {
  WTSQuerySessionInformationW: {
    parameters: ["pointer", "u32", "u32", "buffer", "buffer"],
    result: "i32",
  },
  WTSFreeMemory: { parameters: ["pointer"], result: "void" },
});
const ole32 = Deno.dlopen("ole32.dll", {
  CoInitializeEx: { parameters: ["pointer", "u32"], result: "i32" },
  CoCreateInstance: {
    parameters: ["buffer", "pointer", "u32", "buffer", "buffer"],
    result: "i32",
  },
});
const oleaut32 = Deno.dlopen("oleaut32.dll", {
  SysAllocString: { parameters: ["buffer"], result: "pointer" },
  SysStringLen: { parameters: ["pointer"], result: "u32" },
  SysFreeString: { parameters: ["pointer"], result: "void" },
  SafeArrayGetLBound: {
    parameters: ["pointer", "u32", "buffer"],
    result: "i32",
  },
  SafeArrayGetUBound: {
    parameters: ["pointer", "u32", "buffer"],
    result: "i32",
  },
  SafeArrayAccessData: { parameters: ["pointer", "buffer"], result: "i32" },
  SafeArrayUnaccessData: { parameters: ["pointer"], result: "i32" },
  SafeArrayDestroy: { parameters: ["pointer"], result: "i32" },
  VariantClear: { parameters: ["buffer"], result: "i32" },
});
const combase = Deno.dlopen("combase.dll", {
  RoInitialize: { parameters: ["u32"], result: "i32" },
  RoGetActivationFactory: {
    parameters: ["pointer", "buffer", "buffer"],
    result: "i32",
  },
  WindowsCreateString: {
    parameters: ["buffer", "u32", "buffer"],
    result: "i32",
  },
  WindowsDeleteString: { parameters: ["pointer"], result: "i32" },
  WindowsGetStringRawBuffer: {
    parameters: ["pointer", "buffer"],
    result: "pointer",
  },
});
const shcore = Deno.dlopen("shcore.dll", {
  GetScaleFactorForMonitor: {
    parameters: ["pointer", "buffer"],
    result: "i32",
  },
});
try {
  user32.symbols.SetProcessDPIAware();
} catch { /* already configured is fine */ }
const textDecoder16 = new TextDecoder("utf-16le"),
  POINTER_SIZE = 8,
  CF_UNICODETEXT = 13,
  PROCESS_QUERY_LIMITED_INFORMATION = 0x1000,
  MONITOR_DEFAULTTONEAREST = 2,
  SRCCOPY = 0x00cc0020,
  PW_RENDERFULLCONTENT = 2;
const WM_CLOSE = 0x10,
  WM_SETTEXT = 0x0c,
  WM_GETTEXT = 0x0d,
  WM_GETTEXTLENGTH = 0x0e,
  EM_GETSEL = 0xb0,
  EM_SETSEL = 0xb1,
  EM_REPLACESEL = 0xc2,
  WM_LBUTTONDOWN = 0x201,
  WM_LBUTTONUP = 0x202,
  WM_RBUTTONDOWN = 0x204,
  WM_RBUTTONUP = 0x205,
  WM_MBUTTONDOWN = 0x207,
  WM_MBUTTONUP = 0x208,
  WM_MOUSEWHEEL = 0x20a,
  WM_MOUSEHWHEEL = 0x20e;
const GA_PARENT = 1,
  GA_ROOT = 2,
  GW_HWNDPREV = 3,
  GW_OWNER = 4,
  GWL_STYLE = -16,
  GWL_EXSTYLE = -20,
  WS_CHILD = 0x40000000,
  WS_BORDER = 0x00800000,
  WS_DLGFRAME = 0x00400000,
  WS_CAPTION = WS_BORDER | WS_DLGFRAME;
const WS_THICKFRAME = 0x00040000,
  WS_SYSMENU = 0x00080000,
  WS_MINIMIZEBOX = 0x00020000,
  WS_MAXIMIZEBOX = 0x00010000,
  WS_EX_LAYERED = 0x00080000,
  LWA_ALPHA = 2,
  FRAME_STYLE_MASK = WS_BORDER | WS_DLGFRAME | WS_THICKFRAME | WS_SYSMENU |
    WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
const SWP_NOSIZE = 1,
  SWP_NOMOVE = 2,
  SWP_NOZORDER = 4,
  SWP_NOACTIVATE = 0x10,
  SWP_FRAMECHANGED = 0x20,
  INPUT_MOUSE = 0,
  INPUT_KEYBOARD = 1,
  KEYEVENTF_EXTENDEDKEY = 1,
  KEYEVENTF_KEYUP = 2,
  KEYEVENTF_UNICODE = 4,
  MOUSEEVENTF_WHEEL = 0x0800,
  MOUSEEVENTF_HWHEEL = 0x1000,
  WHEEL_DELTA = 120;
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function timeAtom(value, action) {
  const text = String(value).trim(),
    ref = text.match(/^\$\.curr((?:\.[A-Za-z_][A-Za-z0-9_-]*)+)$/);
  if (ref) {
    let current = action;
    for (const key of ref[1].slice(1).split(".")) {
      if (key === "len") {
        current = current != null && typeof current.length === "number"
          ? current.length
          : null;
        continue;
      }
      if (
        current == null ||
        !Object.prototype.hasOwnProperty.call(Object(current), key)
      ) return null;
      current = current[key];
    }
    const number = Number(current);
    return Number.isFinite(number) ? number : null;
  }
  const match = text.match(/^(\d+(?:\.\d*)?|\.\d+)\s*(ms|s|m)?$/i);
  return match
    ? +match[1] * ({ ms: 1, s: 1000, m: 60000 }[match[2]?.toLowerCase()] ?? 1)
    : null;
}

function timeExpr(text, action) {
  let result = 1;
  for (const part of String(text).split("*")) {
    const value = timeAtom(part, action);
    if (value == null) return null;
    result *= value;
  }
  return Number.isFinite(result) ? result : null;
}

function timeMs(value, fallback = 0, action) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value !== "string") return fallback;
  if (userTime(value)) return userInterval();
  const text = value.trim(),
    random = text.match(/^rand\((.+)\)$/i),
    resolved = timeExpr(random ? random[1] : text, action);
  if (resolved == null) return fallback;
  return Math.max(0, random ? Math.random() * resolved : resolved);
}

function userTime(value) {
  return typeof value === "string" && /^user\(\)$/i.test(value.trim());
}

function userInterval() {
  return 45 + Math.random() * 105;
}

function delay(value, action) {
  return new Promise((resolve) =>
    setTimeout(resolve, timeMs(value, 0, action))
  );
}

export async function wait(options = 0) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    await delay(options);
    return true;
  }
  const kinds = ["window", "ocr", "image", "change"].filter((key) =>
    options[key] != null
  );
  if (kinds.length !== 1) return null;
  const kind = kinds[0],
    prepared = await prepareWaitCondition(kind, options[kind]);
  if (!prepared) return null;
  const until = performance.now() + timeMs(options.timeout, 10000, options);
  for (;;) {
    const state = await testWaitCondition(kind, prepared);
    if (
      state.ready !== false && (options.not ? !state.matched : state.matched)
    ) return options.not ? true : state.value;
    const remaining = until - performance.now();
    if (remaining <= 0) return null;
    const interval = Math.max(1, timeMs(options.interval, 100, options));
    await delay(Math.min(interval, remaining));
  }
}

function ptrValue(pointer) {
  return pointer ? Deno.UnsafePointer.value(pointer) : 0n;
}

function ptrId(pointer) {
  return `0x${ptrValue(pointer).toString(16)}`;
}

function asPointer(value) {
  return value ? Deno.UnsafePointer.create(BigInt(value)) : null;
}

function wide(text, nul = false) {
  return Uint16Array.from(
    { length: text.length + (nul ? 1 : 0) },
    (_, i) => text.charCodeAt(i) || 0,
  );
}

function decodeWide(buffer, length = buffer.length) {
  return textDecoder16.decode(
    new Uint8Array(buffer.buffer, buffer.byteOffset, length * 2),
  );
}

function viewRect(v, offset = 0) {
  const x = v.getInt32(offset, true), y = v.getInt32(offset + 4, true);
  return {
    x,
    y,
    width: v.getInt32(offset + 8, true) - x,
    height: v.getInt32(offset + 12, true) - y,
  };
}

function rectFromBuffer(buffer) {
  return viewRect(
    new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength),
  );
}

function readWide(hwnd, size, fn) {
  const b = new Uint16Array(size), n = fn(hwnd, b, size);
  return n > 0 ? decodeWide(b, n) : "";
}

function windowText(hwnd) {
  const n = user32.symbols.GetWindowTextLengthW(hwnd);
  return n > 0 ? readWide(hwnd, n + 1, user32.symbols.GetWindowTextW) : "";
}

function windowClass(hwnd) {
  return readWide(hwnd, 512, user32.symbols.GetClassNameW);
}
// Windows, displays, and window automation
function processPath(pid) {
  const handle = kernel32.symbols.OpenProcess(
    PROCESS_QUERY_LIMITED_INFORMATION,
    0,
    pid,
  );
  if (!handle) return "";
  try {
    const buffer = new Uint16Array(32768),
      size = new Uint32Array([buffer.length]);
    return kernel32.symbols.QueryFullProcessImageNameW(handle, 0, buffer, size)
      ? decodeWide(buffer, size[0])
      : "";
  } finally {
    kernel32.symbols.CloseHandle(handle);
  }
}

function monitorScale(monitor) {
  const scale = new Int32Array([100]);
  return shcore.symbols.GetScaleFactorForMonitor(monitor, scale) >= 0
    ? scale[0] / 100
    : 1;
}

function displayRecords() {
  const found = [],
    callback = new Deno.UnsafeCallback({
      parameters: ["pointer", "pointer", "pointer", "pointer"],
      result: "i32",
    }, (monitor) => {
      const info = new Uint8Array(104), view = new DataView(info.buffer);
      view.setUint32(0, 104, true);
      if (!user32.symbols.GetMonitorInfoW(monitor, info)) return 1;
      found.push({
        id: decodeWide(new Uint16Array(info.buffer, 40, 32)).split("\0", 1)[0],
        handle: ptrId(monitor),
        primary: !!(view.getUint32(36, true) & 1),
        scale: monitorScale(monitor),
        ...viewRect(view, 4),
        work: viewRect(view, 20),
      });
      return 1;
    });
  try {
    if (
      !user32.symbols.EnumDisplayMonitors(null, null, callback.pointer, null)
    ) throw new Error("EnumDisplayMonitors failed");
  } finally {
    callback.close();
  }
  found.sort((a, b) =>
    Number(b.primary) - Number(a.primary) || a.x - b.x || a.y - b.y
  );
  return found.map((display, index) => ({ index, ...display }));
}

export function display_find({ display } = {}) {
  const found = displayRecords().map((
    { index, primary, scale, width, height, work },
  ) => ({
    index,
    primary,
    scale,
    width,
    height,
    work: { width: work.width, height: work.height },
  }));
  if (display == null) return found;
  const index = Number(typeof display === "object" ? display.index : display);
  return Number.isInteger(index) ? found.filter((x) => x.index === index) : [];
}

function resolveDisplay(display) {
  const list = displayRecords();
  if (!list.length) return null;
  if (display == null) return list[0];
  const index = Number(typeof display === "object" ? display.index : display);
  return Number.isInteger(index) ? list[index] ?? null : null;
}

function displayMap() {
  return new Map(displayRecords().map((x) => [x.handle.toLowerCase(), x]));
}

function clientRect(hwnd) {
  if (!hwnd) return null;
  const rect = new Int32Array(4);
  if (!user32.symbols.GetClientRect(hwnd, rect)) return null;
  const origin = new Int32Array(2);
  if (!user32.symbols.ClientToScreen(hwnd, origin)) return null;
  return {
    x: origin[0],
    y: origin[1],
    width: rect[2] - rect[0],
    height: rect[3] - rect[1],
  };
}

function isChildWindow(hwnd) {
  return !!(user32.symbols.GetWindowLongW(hwnd, GWL_STYLE) & WS_CHILD);
}

function windowParent(hwnd) {
  return isChildWindow(hwnd)
    ? user32.symbols.GetAncestor(hwnd, GA_PARENT)
    : null;
}

function windowOwner(hwnd) {
  return isChildWindow(hwnd) ? null : user32.symbols.GetWindow(hwnd, GW_OWNER);
}

function windowZOrder(hwnd) {
  let zorder = 0;
  while ((hwnd = user32.symbols.GetWindow(hwnd, GW_HWNDPREV))) zorder++;
  return zorder;
}

function windowDepth(hwnd) {
  let depth = 0;
  while (hwnd && isChildWindow(hwnd)) {
    hwnd = user32.symbols.GetAncestor(hwnd, GA_PARENT);
    if (hwnd) depth++;
  }
  return depth;
}

function getWindowInfo(hwnd, monitors = displayMap()) {
  if (!hwnd) return null;
  const pidOut = new Uint32Array(1),
    tid = user32.symbols.GetWindowThreadProcessId(hwnd, pidOut),
    pid = pidOut[0],
    buffer = new Uint8Array(16);
  const parent = windowParent(hwnd),
    owner = windowOwner(hwnd),
    monitor = user32.symbols.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  const minimized = !!user32.symbols.IsIconic(hwnd),
    maximized = !!user32.symbols.IsZoomed(hwnd);
  return {
    wid: ptrId(hwnd),
    wpid: parent ? ptrId(parent) : null,
    woid: owner ? ptrId(owner) : null,
    depth: windowDepth(hwnd),
    zorder: windowZOrder(hwnd),
    title: windowText(hwnd),
    class: windowClass(hwnd),
    pid,
    bin: processPath(pid),
    display: monitors.get(monitor ? ptrId(monitor).toLowerCase() : "")?.index ??
      null,
    rect: user32.symbols.GetWindowRect(hwnd, buffer)
      ? rectFromBuffer(buffer)
      : { x: 0, y: 0, width: 0, height: 0 },
    client: clientRect(hwnd),
    status: minimized ? "minimized" : maximized ? "maximized" : "normal",
    hidden: !user32.symbols.IsWindowVisible(hwnd),
    foreground:
      ptrValue(user32.symbols.GetForegroundWindow()) === ptrValue(hwnd),
    _tid: tid,
  };
}

function publicWindow({ _tid, ...window }) {
  return window;
}

function regexMatch(value, pattern) {
  try {
    return new RegExp(String(pattern), "i").test(String(value ?? ""));
  } catch {
    return false;
  }
}

function normalizeWindowFilter(filter) {
  if (filter == null) return {};
  if (typeof filter === "string") {
    return filter.startsWith("0x") ? { wid: filter } : { title: filter };
  }
  return typeof filter === "number" || typeof filter === "bigint"
    ? { wid: ptrId(asPointer(filter)) }
    : filter;
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function sameWindowId(a, b) {
  return a == null || b == null
    ? a == null && b == null
    : String(a).toLowerCase() === String(b).toLowerCase();
}

function anyFilter(value, match) {
  const values = Array.isArray(value) ? value : [value];
  return values.length > 0 && values.some(match);
}

function regexFilter(value, patterns) {
  return anyFilter(patterns, (pattern) => regexMatch(value, pattern));
}
const filterId = (a, b) => anyFilter(b, (v) => sameWindowId(a, v)),
  filterNum = (a, b) => anyFilter(b, (v) => a === Number(v)),
  filterBool = (a, b) => a === !!b;
const filterExact = (a, b) => anyFilter(b, (v) => a === String(v)),
  filterString = (a, b) => anyFilter(b, (v) => a === String(v).toLowerCase());
function matchesFields(record, filter, rules) {
  for (const [key, [byOwn, test]] of Object.entries(rules)) {
    if (
      (byOwn ? own(filter, key) : filter[key] != null) &&
      !test(record[key], filter[key])
    ) return false;
  }
  return true;
}

function relationSpec(spec, defaultDomain) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return null;
  const depth = spec.depth == null
      ? 1
      : String(spec.depth).toLowerCase() === "all"
      ? Infinity
      : Number(spec.depth),
    window = own(spec, "window"),
    a11y = own(spec, "a11y");
  if (
    (depth !== Infinity && (!Number.isInteger(depth) || depth < 1)) ||
    (window && a11y)
  ) return null;
  if (window || a11y) {
    const domain = window ? "window" : "a11y";
    return { depth, domain, filter: spec[domain] ?? {} };
  }
  const filter = { ...spec };
  delete filter.depth;
  return { depth, domain: defaultDomain, filter };
}

function windowTree(records) {
  const byWid = new Map(), children = new Map();
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
  wid: [false, filterId],
  wpid: [true, filterId],
  woid: [true, filterId],
  depth: [
    false,
    (a, b) =>
      anyFilter(b, (v) => String(v).toLowerCase() === "all" || a === Number(v)),
  ],
  zorder: [false, filterNum],
  pid: [false, filterNum],
  title: [false, regexFilter],
  bin: [false, regexFilter],
  class: [false, regexFilter],
  display: [
    false,
    (a, b) => anyFilter(b, (v) => a === resolveDisplay(v)?.index),
  ],
  status: [false, filterString],
  hidden: [false, filterBool],
  foreground: [false, filterBool],
};
function matchesWindowRelation(window, direction, spec, tree) {
  const relation = relationSpec(spec, "window");
  if (!relation) return false;
  if (relation.domain === "a11y") {
    return matchesWindowUiaRelation(window, direction, relation);
  }
  if (direction === "up") {
    let current = window;
    for (let depth = 1; depth <= relation.depth && current.wpid; depth++) {
      current = tree.byWid.get(current.wpid.toLowerCase());
      if (!current) break;
      if (matchesWindow(current, relation.filter, tree)) return true;
    }
    return false;
  }
  const queue = (tree.children.get(window.wid.toLowerCase()) ?? []).map(
    (child) => [child, 1],
  );
  for (let i = 0; i < queue.length; i++) {
    const [child, depth] = queue[i];
    if (matchesWindow(child, relation.filter, tree)) return true;
    if (depth < relation.depth) {
      for (const next of tree.children.get(child.wid.toLowerCase()) ?? []) {
        queue.push([next, depth + 1]);
      }
    }
  }
  return false;
}

function matchesWindow(w, filter, tree) {
  return matchesFields(w, filter, WINDOW_FIELDS) &&
    (filter.up == null || matchesWindowRelation(w, "up", filter.up, tree)) &&
    (filter.down == null ||
      matchesWindowRelation(w, "down", filter.down, tree));
}

function deepWindowFilter(filter) {
  return filter.wid != null || own(filter, "wpid") || filter.depth != null ||
    filter.up != null || filter.down != null;
}

function enumWindowHandles(parents) {
  const found = [], top = parents == null;
  const callback = new Deno.UnsafeCallback({
    parameters: ["pointer", "pointer"],
    result: "i32",
  }, (hwnd) => {
    if (!top || !isChildWindow(hwnd)) found.push(hwnd);
    return 1;
  });
  try {
    if (top) {
      if (!user32.symbols.EnumWindows(callback.pointer, null)) {
        throw new Error("EnumWindows failed");
      }
    } else {
      for (const hwnd of parents) {
        user32.symbols.EnumChildWindows(hwnd, callback.pointer, null);
      }
    }
  } finally {
    callback.close();
  }
  return found;
}

function windowRecords(filter = {}) {
  filter = normalizeWindowFilter(filter);
  const top = enumWindowHandles(),
    handles = deepWindowFilter(filter)
      ? [...top, ...enumWindowHandles(top)]
      : top,
    monitors = displayMap();
  const records = handles.map((hwnd) => getWindowInfo(hwnd, monitors)).filter(
      Boolean,
    ),
    tree = windowTree(records);
  return records.filter((window) => matchesWindow(window, filter, tree));
}

function findLimit(limit) {
  return limit == null || limit === 0
    ? Infinity
    : Number.isInteger(limit) && limit > 0
    ? limit
    : null;
}

export function window_find({ window = {}, limit = 0 } = {}) {
  const max = findLimit(limit),
    found = max == null ? [] : windowRecords(window).map(publicWindow);
  return max === Infinity ? found : found.slice(0, max);
}

function sendMessage(hwnd, message, wParam = 0n, lParam = null) {
  const out = new BigUint64Array(1);
  return user32.symbols.SendMessageTimeoutW(
      hwnd,
      message,
      wParam,
      lParam,
      3,
      250,
      out,
    )
    ? out[0]
    : null;
}

function windowMessageText(hwnd) {
  const raw = sendMessage(hwnd, WM_GETTEXTLENGTH);
  if (raw == null) return null;
  const length = Number(raw);
  if (!Number.isSafeInteger(length) || length < 0 || length > 1048576) {
    return null;
  }
  const buffer = new Uint16Array(length + 1),
    written = sendMessage(
      hwnd,
      WM_GETTEXT,
      BigInt(buffer.length),
      Deno.UnsafePointer.of(buffer),
    );
  return written == null
    ? null
    : decodeWide(buffer, Math.min(Number(written), length));
}

function textControl(hwnd) {
  return /^(?:edit|richedit)/i.test(windowClass(hwnd));
}

function textRange(text, selection) {
  let start, end;
  if (selection === true) {
    start = 0;
    end = text.length;
  } else if (typeof selection === "string") {
    let match;
    try {
      match = new RegExp(selection, "i").exec(text);
    } catch {
      return null;
    }
    if (!match) return null;
    start = match.index;
    end = start + match[0].length;
  } else if (
    selection && typeof selection === "object" && !Array.isArray(selection)
  ) {
    start = Number(selection.start);
    end = Number(selection.end);
    if (
      !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0
    ) return null;
    start = Math.min(start, text.length);
    end = Math.min(end, text.length);
  } else {
    return null;
  }
  const from = Math.min(start, end), to = Math.max(start, end);
  return { start: from, end: to, text: text.slice(from, to) };
}

function focusedControl() {
  const active = user32.symbols.GetForegroundWindow();
  if (!active) return null;
  const tid = user32.symbols.GetWindowThreadProcessId(
      active,
      new Uint32Array(1),
    ),
    info = new Uint8Array(72),
    view = new DataView(info.buffer);
  view.setUint32(0, info.byteLength, true);
  if (!user32.symbols.GetGUIThreadInfo(tid, info)) return null;
  const value = view.getBigUint64(16, true);
  return value ? asPointer(value) : null;
}

export function input_sel(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return null;
  }
  const read = own(options, "read"),
    write = own(options, "write"),
    select = own(options, "select");
  if (Number(read) + Number(write) + Number(select) !== 1) return null;
  const found = options.window == null
    ? null
    : windowRecords(options.window)[0];
  const hwnd = options.window == null
    ? focusedControl()
    : found
    ? asPointer(found.wid)
    : null;
  if (!hwnd || !textControl(hwnd)) return null;
  if (write) {
    const text = String(options.write ?? ""), data = wide(text, true);
    return sendMessage(hwnd, EM_REPLACESEL, 1n, Deno.UnsafePointer.of(data)) ==
        null
      ? null
      : { length: text.length };
  }
  const text = windowMessageText(hwnd);
  if (text == null) return null;
  if (select) {
    const range = textRange(text, options.select);
    if (
      !range ||
      sendMessage(hwnd, EM_SETSEL, BigInt(range.start), asPointer(range.end)) ==
        null
    ) return null;
    return range;
  }
  if (options.read !== true) return null;
  const start = new Uint32Array(1),
    end = new Uint32Array(1),
    out = new BigUint64Array(1);
  if (
    !user32.symbols.SendMessageTimeoutW(
      hwnd,
      EM_GETSEL,
      ptrValue(Deno.UnsafePointer.of(start)),
      Deno.UnsafePointer.of(end),
      3,
      250,
      out,
    )
  ) return null;
  return textRange(text, { start: start[0], end: end[0] })?.text ?? null;
}

export function window_get({ window = {}, text = false } = {}) {
  const found = windowRecords(window)[0];
  if (!found) return null;
  const out = publicWindow(found);
  if (text) out.text = windowMessageText(asPointer(found.wid));
  return out;
}

export function window_wait(
  { window = {}, timeout = 5000, interval = 50 } = {},
) {
  return wait({ window, timeout, interval });
}

function sessionLocked() {
  const out = new BigUint64Array(1), bytes = new Uint32Array(1);
  if (
    !wtsapi32.symbols.WTSQuerySessionInformationW(
      null,
      0xffffffff,
      25,
      out,
      bytes,
    ) || !out[0]
  ) return null;
  const pointer = asPointer(out[0]);
  try {
    const data = bytes[0] >= 20 &&
      new DataView(
        new Deno.UnsafePointerView(pointer).getArrayBuffer(bytes[0]),
      );
    if (!data || data.getUint32(0, true) !== 1) return null;
    const state = data.getInt32(16, true);
    return state === 0 ? true : state === 1 ? false : null;
  } finally {
    wtsapi32.symbols.WTSFreeMemory(pointer);
  }
}

export function system({ wake, awake } = {}) {
  if (
    (wake != null && awake != null) || (wake != null && wake !== true) ||
    (awake != null && typeof awake !== "boolean")
  ) return null;
  const flags = wake != null
    ? 3
    : awake != null
    ? (awake ? 0x80000003 : 0x80000000)
    : null;
  if (flags != null && !kernel32.symbols.SetThreadExecutionState(flags)) {
    return null;
  }
  return {
    locked: sessionLocked(),
    ...(wake ? { wake: true } : {}),
    ...(awake != null ? { awake } : {}),
  };
}

function focusWindow(info) {
  const hwnd = asPointer(info.wid),
    current = kernel32.symbols.GetCurrentThreadId();
  for (let attempt = 0; attempt < 3; attempt++) {
    const foreground = user32.symbols.GetForegroundWindow(),
      foregroundTid = foreground
        ? user32.symbols.GetWindowThreadProcessId(
          foreground,
          new Uint32Array(1),
        )
        : 0,
      attached = [];
    try {
      for (const tid of new Set([foregroundTid, info._tid])) {
        if (
          tid && tid !== current &&
          user32.symbols.AttachThreadInput(current, tid, 1)
        ) attached.push(tid);
      }
      user32.symbols.ShowWindow(hwnd, 9);
      user32.symbols.BringWindowToTop(hwnd);
      user32.symbols.SetForegroundWindow(hwnd);
      user32.symbols.SetFocus(hwnd);
    } finally {
      for (const tid of attached.reverse()) {
        user32.symbols.AttachThreadInput(current, tid, 0);
      }
    }
    sleepSync(30);
    if (ptrValue(user32.symbols.GetForegroundWindow()) === ptrValue(hwnd)) {
      return;
    }
  }
  return false;
}

export function window_control(
  { window = {}, display, action, pos, rect } = {},
) {
  const info = windowRecords(window)[0];
  if (!info) return null;
  const hwnd = asPointer(info.wid),
    show = { restore: 9, minimize: 6, maximize: 3 }[action];
  if (show) user32.symbols.ShowWindow(hwnd, show);
  else if (action === "focus") focusWindow(info);
  else if (action === "move" || action === "size") {
    const geometry = geometryContext(info, display),
      next = positionRect(
        resolveRect(rect, info.rect, geometry),
        pos,
        geometry,
      );
    if (next.width > 0 && next.height > 0) {
      user32.symbols.SetWindowPos(
        hwnd,
        null,
        next.x,
        next.y,
        next.width,
        next.height,
        SWP_NOZORDER | SWP_NOACTIVATE,
      );
    }
  } else if (action === "close") {
    user32.symbols.PostMessageW(hwnd, WM_CLOSE, 0n, 0n);
  }
  return window_get({ window: { wid: info.wid } });
}
const WINDOW_FRAMES = {
  none: 0,
  border: WS_BORDER,
  caption: WS_CAPTION | WS_SYSMENU,
  resizable: WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX |
    WS_MAXIMIZEBOX,
};
function setWindowTitle(hwnd, title) {
  const text = wide(String(title), true);
  sendMessage(hwnd, WM_SETTEXT, 0n, Deno.UnsafePointer.of(text));
}

function setWindowFrame(hwnd, frame) {
  const bits = WINDOW_FRAMES[String(frame).toLowerCase()];
  if (bits == null) return;
  const style = user32.symbols.GetWindowLongW(hwnd, GWL_STYLE) >>> 0;
  user32.symbols.SetWindowLongW(
    hwnd,
    GWL_STYLE,
    ((style & ~FRAME_STYLE_MASK) | bits) | 0,
  );
  user32.symbols.SetWindowPos(
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
  user32.symbols.SetWindowPos(
    hwnd,
    Deno.UnsafePointer.create(
      value ? 0xffffffffffffffffn : 0xfffffffffffffffen,
    ),
    0,
    0,
    0,
    0,
    SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE,
  );
}

function setWindowOpacity(hwnd, opacity) {
  opacity = Number(opacity);
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return;
  const ex = user32.symbols.GetWindowLongW(hwnd, GWL_EXSTYLE) >>> 0;
  if (!(ex & WS_EX_LAYERED)) {
    user32.symbols.SetWindowLongW(hwnd, GWL_EXSTYLE, (ex | WS_EX_LAYERED) | 0);
  }
  user32.symbols.SetLayeredWindowAttributes(
    hwnd,
    0,
    Math.round(opacity * 255),
    LWA_ALPHA,
  );
}

export async function window_set(
  { window = {}, title, frame, topmost, opacity, enabled, highlight } = {},
) {
  const info = windowRecords(window)[0];
  if (!info) return null;
  const hwnd = asPointer(info.wid);
  if (title != null) setWindowTitle(hwnd, title);
  if (frame != null) setWindowFrame(hwnd, frame);
  if (topmost != null) setWindowTopmost(hwnd, !!topmost);
  if (opacity != null) setWindowOpacity(hwnd, opacity);
  if (enabled != null) user32.symbols.EnableWindow(hwnd, enabled ? 1 : 0);
  const result = window_get({ window: { wid: info.wid } });
  if (highlight && result?.rect) {
    await highlightRect(result.rect, highlight === true ? 800 : highlight, {
      highlight,
    });
  }
  return result;
}

export function window_hit({ pos, display, child = false } = {}) {
  const point = mouseTarget(null, display, pos)?.to;
  if (!point) return null;
  let hwnd = user32.symbols.WindowFromPoint(
    (BigInt(point.y >>> 0) << 32n) | BigInt(point.x >>> 0),
  );
  if (!hwnd) return null;
  if (!child) hwnd = user32.symbols.GetAncestor(hwnd, GA_ROOT) || hwnd;
  return publicWindow(getWindowInfo(hwnd));
}
const HIGHLIGHT_CLASS = "AAF.Highlight", HIGHLIGHT_THICKNESS = 3;
let highlightClass = 0, highlightBrush = null, highlightWndProc = null;
function ensureHighlightClass() {
  if (highlightClass) return;
  const instance = kernel32.symbols.GetModuleHandleW(null);
  if (!instance) throw new Error("GetModuleHandleW failed");
  highlightBrush ??= gdi32.symbols.CreateSolidBrush(255);
  if (!highlightBrush) throw new Error("CreateSolidBrush failed");
  highlightWndProc ??= new Deno.UnsafeCallback(
    { parameters: ["pointer", "u32", "usize", "isize"], result: "isize" },
    (hwnd, message, wParam, lParam) =>
      message === 0x84
        ? -1n
        : user32.symbols.DefWindowProcW(hwnd, message, wParam, lParam),
  );
  const name = wide(HIGHLIGHT_CLASS, true),
    wc = new Uint8Array(80),
    view = new DataView(wc.buffer);
  view.setUint32(0, 80, true);
  view.setBigUint64(8, ptrValue(highlightWndProc.pointer), true);
  view.setBigUint64(24, ptrValue(instance), true);
  view.setBigUint64(48, ptrValue(highlightBrush), true);
  view.setBigUint64(64, ptrValue(Deno.UnsafePointer.of(name)), true);
  if (!(highlightClass = user32.symbols.RegisterClassExW(wc))) {
    throw new Error("RegisterClassExW(highlight) failed");
  }
}

function createHighlightRect(rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return [];
  ensureHighlightClass();
  const x = Math.round(rect.x),
    y = Math.round(rect.y),
    width = Math.max(1, Math.round(rect.width)),
    height = Math.max(1, Math.round(rect.height));
  const t = Math.min(HIGHLIGHT_THICKNESS, width, height),
    segments = [[x, y, width, t], [x, y + height - t, width, t], [
      x,
      y + t,
      t,
      Math.max(1, height - 2 * t),
    ], [x + width - t, y + t, t, Math.max(1, height - 2 * t)]];
  const instance = kernel32.symbols.GetModuleHandleW(null),
    name = wide(HIGHLIGHT_CLASS, true),
    title = wide("", true),
    windows = [];
  try {
    for (const [left, top, w, h] of segments) {
      const hwnd = user32.symbols.CreateWindowExW(
        0x080000a8,
        name,
        title,
        0x90000000,
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
        user32.symbols.FillRect(
          dc,
          new Int32Array([0, 0, w, h]),
          highlightBrush,
        );
        user32.symbols.ReleaseDC(hwnd, dc);
      }
    }
    return windows;
  } catch (error) {
    for (const hwnd of windows) user32.symbols.DestroyWindow(hwnd);
    throw error;
  }
}

async function highlightRect(rect, duration, action) {
  const overlays = createHighlightRect(rect);
  if (!overlays.length) return;
  try {
    await delay(timeMs(duration, 800, action));
  } finally {
    for (const hwnd of overlays) user32.symbols.DestroyWindow(hwnd);
  }
}
// Capture and PNG
function captureArea(options = {}) {
  const info = options.window == null ? null : windowRecords(options.window)[0];
  if (options.window != null && !info) return null;
  if (options.rect) {
    const geometry = geometryContext(info, options.display),
      base = info?.rect ?? geometry.D;
    const rect = base && resolveRect(options.rect, base, geometry);
    return rect && rect.width > 0 && rect.height > 0
      ? { kind: "screen", ...rect }
      : null;
  }
  if (info) return { kind: "window", hwnd: asPointer(info.wid), ...info.rect };
  if (options.all) {
    const displays = displayRecords();
    if (!displays.length) return null;
    const x = Math.min(...displays.map((d) => d.x)),
      y = Math.min(...displays.map((d) => d.y));
    const right = Math.max(...displays.map((d) => d.x + d.width)),
      bottom = Math.max(...displays.map((d) => d.y + d.height));
    return { kind: "screen", x, y, width: right - x, height: bottom - y };
  }
  const display = resolveDisplay(options.display);
  return display
    ? {
      kind: "screen",
      x: display.x,
      y: display.y,
      width: display.width,
      height: display.height,
      display,
    }
    : null;
}

function grayscaleBGRA(data) {
  const out = data.slice();
  for (let i = 0; i < out.length; i += 4) {
    out[i] =
      out[i + 1] =
      out[i + 2] =
        (29 * out[i] + 150 * out[i + 1] + 77 * out[i + 2]) >> 8;
  }
  return out;
}

export function captureScreenshot(options = {}) {
  const area = captureArea(options);
  if (!area || area.width <= 0 || area.height <= 0) return null;
  const { width, height } = area, screen = user32.symbols.GetDC(null);
  if (!screen) throw new Error("GetDC failed");
  const memory = gdi32.symbols.CreateCompatibleDC(screen);
  if (!memory) {
    user32.symbols.ReleaseDC(null, screen);
    throw new Error("CreateCompatibleDC failed");
  }
  const bmi = new Uint8Array(40),
    view = new DataView(bmi.buffer),
    bits = new BigUint64Array(1);
  view.setUint32(0, 40, true);
  view.setInt32(4, width, true);
  view.setInt32(8, -height, true);
  view.setUint16(12, 1, true);
  view.setUint16(14, 32, true);
  const bitmap = gdi32.symbols.CreateDIBSection(screen, bmi, 0, bits, null, 0);
  if (!bitmap || !bits[0]) {
    gdi32.symbols.DeleteDC(memory);
    user32.symbols.ReleaseDC(null, screen);
    throw new Error("CreateDIBSection failed");
  }
  const old = gdi32.symbols.SelectObject(memory, bitmap);
  try {
    let ok = area.kind === "window" &&
      user32.symbols.PrintWindow(area.hwnd, memory, PW_RENDERFULLCONTENT);
    if (!ok) {
      ok = gdi32.symbols.BitBlt(
        memory,
        0,
        0,
        width,
        height,
        screen,
        area.x,
        area.y,
        SRCCOPY,
      );
    }
    if (!ok) throw new Error("Screenshot capture failed");
    let data = new Uint8Array(
      new Deno.UnsafePointerView(asPointer(bits[0])).getArrayBuffer(
        width * height * 4,
      ),
    ).slice();
    if (options.grayscale) data = grayscaleBGRA(data);
    return {
      rect: { x: area.x, y: area.y, width, height },
      format: "bgra8",
      grayscale: !!options.grayscale,
      data,
    };
  } finally {
    if (old) gdi32.symbols.SelectObject(memory, old);
    gdi32.symbols.DeleteObject(bitmap);
    gdi32.symbols.DeleteDC(memory);
    user32.symbols.ReleaseDC(null, screen);
  }
}

function swapRedBlue(data) {
  const out = new Uint8Array(data).slice();
  for (let i = 0; i < out.length; i += 4) {
    const red = out[i];
    out[i] = out[i + 2];
    out[i + 2] = red;
  }
  return out;
}

// Geometry, input, and clipboard
function sendInput(type, fill) {
  const input = new Uint8Array(40), view = new DataView(input.buffer);
  view.setUint32(0, type, true);
  fill(view);
  return user32.symbols.SendInput(1, input, 40) === 1;
}

function mouseInput(flags, data = 0) {
  return sendInput(INPUT_MOUSE, (v) => {
    v.setUint32(16, data >>> 0, true);
    v.setUint32(20, flags >>> 0, true);
  });
}

function geometryContext(info, display) {
  const displays = displayRecords();
  const displayIndex = display == null
    ? null
    : Number(typeof display === "object" ? display.index : display);
  const explicitDisplay = Number.isInteger(displayIndex)
    ? displays[displayIndex] ?? null
    : null;
  return {
    W: info?.rect ?? null,
    WC: info ? clientRect(asPointer(info.wid)) : null,
    D: explicitDisplay ??
      (info?.display != null ? displays[info.display] : null) ??
      displays[0] ?? null,
    explicitDisplay,
  };
}
const GEOMETRY_VALUE = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(%?)(WC|W|D)?$/i;
function geometryValue(value, axis, current, context, size = false) {
  const round = (x) => Math.round(x);
  if (value == null) return round(current);
  if (typeof value === "number" && Number.isFinite(value)) {
    return round(size ? value : (context.explicitDisplay?.[axis] ?? 0) + value);
  }
  const match = typeof value === "string" && value.match(GEOMETRY_VALUE);
  if (!match) return round(current);
  const [, sign, amount, percent, suffix] = match, n = Number(amount);
  if (percent) {
    const ref = context[(suffix || (context.W ? "W" : "D")).toUpperCase()];
    if (!ref) return round(current);
    const delta = n / 100 * (axis === "x" ? ref.width : ref.height);
    return round(
      sign
        ? current + (sign === "-" ? -delta : delta)
        : size
        ? delta
        : ref[axis] + delta,
    );
  }
  if (suffix && !sign) {
    const ref = context[(suffix || (context.W ? "W" : "D")).toUpperCase()];
    return ref ? round(size ? n : ref[axis] + n) : round(current);
  }
  return sign && !suffix
    ? round(current + (sign === "-" ? -n : n))
    : round(current);
}

function resolvePos(pos, relative, context, fallback = relative) {
  return Object.fromEntries(
    ["x", "y"].map((axis) => [
      axis,
      pos?.[axis] == null
        ? Math.round(fallback[axis])
        : geometryValue(pos[axis], axis, relative[axis], context),
    ]),
  );
}
const ANCHORS = {
  "top-left": [0, 0],
  top: [.5, 0],
  "top-right": [1, 0],
  left: [0, .5],
  center: [.5, .5],
  right: [1, .5],
  "bottom-left": [0, 1],
  bottom: [.5, 1],
  "bottom-right": [1, 1],
};
function anchorSpec(at) {
  const match = String(at ?? "top-left").toLowerCase().match(
    /^(top-left|top|top-right|left|center|right|bottom-left|bottom|bottom-right)(wc|w|d)?$/,
  );
  return {
    factors: ANCHORS[match?.[1] ?? "top-left"],
    suffix: match?.[2]?.toUpperCase() ?? null,
  };
}

function geometryAnchor(context, at, fallback) {
  const { factors: [fx, fy], suffix } = anchorSpec(at),
    rect = (suffix && context[suffix]) || fallback;
  return { x: rect.x + rect.width * fx, y: rect.y + rect.height * fy };
}

function resolveRectAxis(rect, base, context, axis) {
  const horizontal = axis === "x",
    startKey = horizontal ? "left" : "top",
    endKey = horizontal ? "right" : "bottom",
    sizeKey = horizontal ? "width" : "height";
  const start = base[axis],
    size = base[sizeKey],
    end = start + size,
    factor = anchorSpec(rect.at).factors[horizontal ? 0 : 1];
  if (rect[startKey] != null || rect[endKey] != null) {
    const a = rect[startKey] == null
      ? start
      : geometryValue(rect[startKey], axis, start, context);
    const b = rect[endKey] != null
      ? geometryValue(rect[endKey], axis, end, context)
      : rect[sizeKey] != null
      ? a + geometryValue(rect[sizeKey], axis, size, context, true)
      : end;
    return [a, b];
  }
  const nextSize = rect[sizeKey] == null
    ? size
    : geometryValue(rect[sizeKey], axis, size, context, true);
  const anchor = geometryAnchor(context, rect.at, base)[axis];
  const nextAnchor = rect[axis] == null
    ? anchor
    : geometryValue(rect[axis], axis, anchor, context);
  const next = nextAnchor - nextSize * factor;
  return [next, next + nextSize];
}

function resolveRect(rect = {}, base, context) {
  const [left, right] = resolveRectAxis(rect, base, context, "x"),
    [top, bottom] = resolveRectAxis(rect, base, context, "y");
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

function positionRect(rect, pos, context) {
  if (!pos || (pos.x == null && pos.y == null)) return rect;
  const from = geometryAnchor(context, pos.at, rect),
    to = resolvePos(pos, from, context, from);
  return {
    ...rect,
    x: Math.round(rect.x + to.x - from.x),
    y: Math.round(rect.y + to.y - from.y),
  };
}

function cursorPoint() {
  const cursor = new Int32Array(2);
  return user32.symbols.GetCursorPos(cursor)
    ? { x: cursor[0], y: cursor[1] }
    : null;
}

function mouseTarget(info, display, pos, defaultAt) {
  const from = cursorPoint();
  if (!from) return null;
  const target = defaultAt ? { at: defaultAt, ...(pos ?? {}) } : pos,
    geometry = geometryContext(info, display);
  const rect = info?.rect ??
    (display != null || target?.at != null ? geometry.D : null);
  const relative = rect ? geometryAnchor(geometry, target?.at, rect) : from;
  return {
    from,
    to: resolvePos(
      target,
      relative,
      geometry,
      target?.at == null ? from : relative,
    ),
  };
}

function userPath(value) {
  return typeof value === "string" && /^user$/i.test(value.trim());
}

function userMousePath(from, to) {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    distance = Math.hypot(dx, dy),
    length = distance || 1,
    nx = -dy / length,
    ny = dx / length;
  const bend = (Math.random() - .5) * Math.min(140, distance * .35),
    c1 = { x: from.x + dx * .3 + nx * bend, y: from.y + dy * .3 + ny * bend },
    c2 = {
      x: from.x + dx * .72 - nx * bend * .35,
      y: from.y + dy * .72 - ny * bend * .35,
    };
  return (t) => {
    if (t >= 1) return to;
    const u = 1 - t, jitter = Math.min(2.5, distance / 120) * u;
    return {
      x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x +
        t * t * t * to.x + (Math.random() - .5) * 2 * jitter,
      y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y +
        t * t * t * to.y + (Math.random() - .5) * 2 * jitter,
    };
  };
}

function userMouseDuration(from, to) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.max(120, Math.min(900, 80 + Math.sqrt(distance) * 22)) *
    (.8 + Math.random() * .4);
}

export async function mouse_move(options = {}) {
  const {
      pos,
      display,
      duration: durationSpec = 0,
      path,
      steps: requestedSteps,
      window,
    } = options,
    info = window == null ? null : windowRecords(window)[0],
    target = mouseTarget(info, display, pos);
  if (!target) return null;
  if (window != null && !info) return { pos: target.from };
  const { from, to } = target,
    route = userPath(path) ? userMousePath(from, to) : null,
    duration = userTime(durationSpec)
      ? userMouseDuration(from, to)
      : timeMs(durationSpec, 0, options);
  if (duration <= 0) {
    return { pos: user32.symbols.SetCursorPos(to.x, to.y) ? to : from };
  }
  const steps = requestedSteps ?? Math.max(2, Math.round(duration / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps,
      point = route
        ? route(t)
        : { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    user32.symbols.SetCursorPos(Math.round(point.x), Math.round(point.y));
    if (i < steps) await delay(duration / steps);
  }
  return { pos: to };
}
const mouseButtons = {
  left: { input: [2, 4], message: [WM_LBUTTONDOWN, WM_LBUTTONUP], state: 1 },
  right: { input: [8, 16], message: [WM_RBUTTONDOWN, WM_RBUTTONUP], state: 2 },
  middle: {
    input: [32, 64],
    message: [WM_MBUTTONDOWN, WM_MBUTTONUP],
    state: 16,
  },
};
function packMousePoint({ x, y }) {
  return BigInt(((x & 0xffff) | ((y & 0xffff) << 16)) >>> 0);
}

function postMouseButton(hwnd, spec, down, point) {
  const client = clientRect(hwnd);
  if (!client) return false;
  const pos = { x: point.x - client.x, y: point.y - client.y };
  return !!user32.symbols.PostMessageW(
    hwnd,
    spec.message[down ? 0 : 1],
    BigInt(down ? spec.state : 0),
    packMousePoint(pos),
  );
}

function postMouseWheel(hwnd, amount, point, horizontal = false) {
  const wParam = BigInt(
      ((Math.round(amount * WHEEL_DELTA) & 0xffff) << 16) >>> 0,
    ),
    message = horizontal ? WM_MOUSEHWHEEL : WM_MOUSEWHEEL;
  return !!user32.symbols.PostMessageW(
    hwnd,
    message,
    wParam,
    packMousePoint(point),
  );
}
const heldMouse = new Map();
export function mouse_button(options = {}) {
  const {
      click,
      down,
      up,
      wheel,
      hwheel,
      window,
      display,
      pos,
      repeat = 1,
      interval = 0,
    } = options,
    actions = Object.entries({ click, down, up, wheel, hwheel }).filter((
      [, value],
    ) => value != null);
  if (actions.length !== 1) return null;
  const [action, value] = actions[0],
    count = Number.isInteger(repeat) && repeat > 0 ? repeat : 1;
  const info = window == null ? null : windowRecords(window)[0];
  if (window != null && !info) return null;
  const target = mouseTarget(info, display, pos, info ? "centerWC" : null),
    point = target?.to,
    direct = !!info;
  if (
    !point ||
    (!direct && pos != null && !user32.symbols.SetCursorPos(point.x, point.y))
  ) return null;
  if (action === "wheel" || action === "hwheel") {
    const amount = Number(value), horizontal = action === "hwheel";
    if (!Number.isFinite(amount)) return null;
    const sent = direct
      ? postMouseWheel(asPointer(info.wid), amount, point, horizontal)
      : mouseInput(
        horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL,
        Math.round(amount * WHEEL_DELTA),
      );
    if (!sent) return null;
    return { [action]: amount, ...(direct && { wid: info.wid }), pos: point };
  }
  const button = String(value).toLowerCase(), spec = mouseButtons[button];
  if (!spec) return null;
  const send = (down) =>
      direct
        ? postMouseButton(asPointer(info.wid), spec, down, point)
        : mouseInput(spec.input[down ? 0 : 1]),
    hold = `${direct ? info.wid.toLowerCase() : "physical"}:${button}`;
  if (action === "click") {
    for (let i = 0; i < count; i++) {
      if (!send(true)) return null;
      if (!send(false)) return null;
      const pause = timeMs(interval, 0, options);
      if (pause && i + 1 < count) sleepSync(pause);
    }
  } else {
    const isDown = action === "down";
    if (!send(isDown)) return null;
    if (isDown) heldMouse.set(hold, { direct, wid: info?.wid, button, point });
    else heldMouse.delete(hold);
  }
  return {
    [action]: button,
    ...(action === "click" && count !== 1 && { repeat: count }),
    ...(direct && { wid: info.wid }),
    pos: point,
  };
}
const VK = Object.fromEntries([
  [8, "backspace back"],
  [9, "tab"],
  [12, "clear"],
  [13, "enter return"],
  [16, "shift"],
  [17, "ctrl control"],
  [18, "alt"],
  [19, "pause"],
  [20, "capslock"],
  [27, "escape esc"],
  [32, "space"],
  [33, "pageup pgup"],
  [34, "pagedown pgdn"],
  [35, "end"],
  [36, "home"],
  [37, "left"],
  [38, "up"],
  [39, "right"],
  [40, "down"],
  [41, "select"],
  [42, "print"],
  [43, "execute"],
  [44, "printscreen prtsc snapshot"],
  [45, "insert ins"],
  [46, "delete del"],
  [47, "help"],
  [91, "lwin win"],
  [92, "rwin"],
  [93, "apps contextmenu"],
  [95, "sleep"],
  [106, "multiply"],
  [107, "add"],
  [108, "separator"],
  [109, "subtract"],
  [110, "decimal"],
  [111, "divide"],
  [144, "numlock"],
  [145, "scrolllock"],
  [160, "lshift"],
  [161, "rshift"],
  [162, "lctrl"],
  [163, "rctrl"],
  [164, "lalt"],
  [165, "ralt altgr"],
  [166, "browserback"],
  [167, "browserforward"],
  [168, "browserrefresh"],
  [169, "browserstop"],
  [170, "browsersearch"],
  [171, "browserfavorites"],
  [172, "browserhome"],
  [173, "volumemute"],
  [174, "volumedown"],
  [175, "volumeup"],
  [176, "medianext"],
  [177, "mediaprev"],
  [178, "mediastop"],
  [179, "mediaplaypause"],
  [180, "launchmail"],
  [181, "launchmedia"],
  [182, "launchapp1"],
  [183, "launchapp2"],
  [186, "oem1"],
  [187, "oemplus"],
  [188, "oemcomma"],
  [189, "oemminus"],
  [190, "oemperiod"],
  [191, "oem2"],
  [192, "oem3"],
  [219, "oem4"],
  [220, "oem5"],
  [221, "oem6"],
  [222, "oem7"],
  [223, "oem8"],
  [226, "oem102"],
].flatMap(([code, names]) => names.split(" ").map((name) => [name, code])));
function keyboardInput(vk, scan, flags) {
  return sendInput(INPUT_KEYBOARD, (v) => {
    v.setUint16(8, vk, true);
    v.setUint16(10, scan, true);
    v.setUint32(12, flags, true);
  });
}

function foregroundKeyboardLayout() {
  const window = user32.symbols.GetForegroundWindow(),
    tid = window
      ? user32.symbols.GetWindowThreadProcessId(window, new Uint32Array(1))
      : 0;
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
  return ((prefix === 0xe0 || prefix === 0xe1) ? KEYEVENTF_EXTENDEDKEY : 0) |
    (up ? KEYEVENTF_KEYUP : 0);
}

function sendVirtualKey(vk, down, layout = foregroundKeyboardLayout()) {
  return keyboardInput(vk, 0, keyFlags(vk, layout, !down));
}
const heldKeys = new Map();
function keySequence(name, layout) {
  const vk = virtualKey(name);
  if (vk != null) return [vk];
  if (typeof name !== "string" || name.length !== 1) return null;
  const mapped = user32.symbols.VkKeyScanExW(name.charCodeAt(0), layout);
  if (mapped === -1) return null;
  const key = mapped & 0xff, state = (mapped >>> 8) & 0xff, keys = [];
  if ((state & 6) === 6) keys.push(0xa5);
  else {
    if (state & 2) keys.push(0x11);
    if (state & 4) keys.push(0x12);
  }
  if (state & 1) keys.push(0x10);
  return [...keys, key];
}

function keyState(name, down) {
  const layout = foregroundKeyboardLayout(), keys = keySequence(name, layout);
  if (!keys || keys.length !== 1 || !sendVirtualKey(keys[0], down, layout)) {
    return false;
  }
  down ? heldKeys.set(keys[0], layout) : heldKeys.delete(keys[0]);
  return true;
}

function keyNames(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function pressKeys(value) {
  const layout = foregroundKeyboardLayout();
  const requested = keyNames(value);
  const sequence = [];
  const accepted = [];
  const active = new Set();
  for (const name of requested) {
    const keys = keySequence(name, layout);
    if (!keys) continue;
    let ok = true;
    for (const vk of keys) {
      if (active.has(vk)) continue;
      if (!sendVirtualKey(vk, true, layout)) {
        ok = false;
        break;
      }
      active.add(vk);
      sequence.push(vk);
    }
    if (ok) accepted.push(name);
  }
  for (const vk of sequence.reverse()) sendVirtualKey(vk, false, layout);
  return accepted;
}

function typeCodeUnit(code) {
  const down = keyboardInput(0, code, KEYEVENTF_UNICODE);
  const up = keyboardInput(0, code, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
  return down && up;
}

function typeUnits(text) {
  const units = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 13 || code === 10) {
      if (code === 13 && text.charCodeAt(i + 1) === 10) i++;
      units.push({ enter: true, char: "\n" });
    } else units.push({ code, char: text[i] });
  }
  return units;
}

function userKeyDelay(char) {
  return userInterval() +
    (/[.,!?;:]$/.test(char)
      ? 60 + Math.random() * 180
      : /\s/.test(char)
      ? Math.random() * 40
      : 0);
}

async function typeText(text, interval, duration, action) {
  const units = typeUnits(text),
    hasDuration = duration != null,
    human = hasDuration ? userTime(duration) : userTime(interval),
    total = hasDuration && !human ? timeMs(duration, 0, action) : null,
    fixed = total != null && units.length > 1 ? total / (units.length - 1) : 0;
  let typed = 0;
  for (let i = 0; i < units.length; i++) {
    const unit = units[i],
      ok = unit.enter ? pressKeys("enter").length : typeCodeUnit(unit.code);
    if (ok) typed++;
    if (i + 1 < units.length) {
      const pause = human
        ? userKeyDelay(unit.char)
        : hasDuration
        ? fixed
        : timeMs(interval, 0, action);
      if (pause > 0) await delay(pause);
    }
  }
  return typed;
}

export async function keyb(options = {}) {
  const { press, down, up, type, repeat = 1, interval = 0, duration } = options;
  const count = Number.isInteger(repeat) && repeat > 0 ? repeat : 1,
    result = {};
  if (press != null) {
    for (let i = 0; i < count; i++) {
      result.press = pressKeys(press);
      const pause = timeMs(interval, 0, options);
      if (pause > 0 && i + 1 < count) await delay(pause);
    }
    if (count !== 1) result.repeat = count;
  }
  if (down != null) {
    result.down = keyNames(down).filter((name) => keyState(name, true));
  }
  if (up != null) {
    result.up = keyNames(up).filter((name) => keyState(name, false));
  }
  if (type != null) {
    result.typed = await typeText(String(type), interval, duration, options);
  }
  return result;
}

export function inputState() {
  return { keys: new Set(heldKeys.keys()), mouse: new Set(heldMouse.keys()) };
}

export function releaseInput(keep = { keys: new Set(), mouse: new Set() }) {
  let released = 0;
  for (const [vk, layout] of [...heldKeys]) {
    if (!keep.keys.has(vk)) {
      if (sendVirtualKey(vk, false, layout)) released++;
      heldKeys.delete(vk);
    }
  }
  for (const [key, hold] of [...heldMouse]) {
    if (!keep.mouse.has(key)) {
      const spec = mouseButtons[hold.button];
      const sent = hold.direct
        ? postMouseButton(asPointer(hold.wid), spec, false, hold.point)
        : mouseInput(spec.input[1]);
      if (sent) released++;
      heldMouse.delete(key);
    }
  }
  return { released };
}

export function input_reset() {
  return releaseInput();
}

function openClipboard() {
  for (let i = 0; i < 20; i++) {
    if (user32.symbols.OpenClipboard(null)) return;
    sleepSync(5);
  }
  throw new Error("OpenClipboard failed");
}

function withClipboard(fn) {
  openClipboard();
  try {
    return fn();
  } finally {
    user32.symbols.CloseClipboard();
  }
}

function withGlobal(handle, fn) {
  const pointer = kernel32.symbols.GlobalLock(handle);
  if (!pointer) return null;
  try {
    return fn(pointer);
  } finally {
    kernel32.symbols.GlobalUnlock(handle);
  }
}

function clipboardRead() {
  if (!user32.symbols.IsClipboardFormatAvailable(CF_UNICODETEXT)) return "";
  return withClipboard(() => {
    const handle = user32.symbols.GetClipboardData(CF_UNICODETEXT);
    return handle
      ? withGlobal(handle, (pointer) => {
        const view = new Deno.UnsafePointerView(pointer);
        let length = 0;
        while (view.getUint16(length * 2)) length++;
        return textDecoder16.decode(
          new Uint8Array(view.getArrayBuffer(length * 2)),
        );
      }) ?? ""
      : "";
  });
}

function clipboardWrite(text) {
  text = String(text ?? "");
  const bytes = new Uint8Array(wide(text, true).buffer),
    handle = kernel32.symbols.GlobalAlloc(2, bytes.length);
  if (!handle) throw new Error("GlobalAlloc failed");
  if (
    withGlobal(handle, (pointer) => {
      ntdll.symbols.RtlMoveMemory(pointer, bytes, bytes.length);
      return true;
    }) !== true
  ) {
    kernel32.symbols.GlobalFree(handle);
    throw new Error("GlobalLock failed");
  }
  let transferred = false;
  try {
    withClipboard(() => {
      if (!user32.symbols.EmptyClipboard()) {
        throw new Error("EmptyClipboard failed");
      }
      if (!user32.symbols.SetClipboardData(CF_UNICODETEXT, handle)) {
        throw new Error("SetClipboardData failed");
      }
      transferred = true;
    });
  } finally {
    if (!transferred) kernel32.symbols.GlobalFree(handle);
  }
  return { length: text.length };
}

function clipboardClear() {
  return withClipboard(() => {
    if (!user32.symbols.EmptyClipboard()) {
      throw new Error("EmptyClipboard failed");
    }
    return true;
  });
}

export function clipboard(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return null;
  }
  const read = own(options, "read"),
    write = own(options, "write"),
    clear = own(options, "clear");
  if (Number(read) + Number(write) + Number(clear) !== 1) return null;
  if (read) return options.read === true ? clipboardRead() : null;
  if (clear) return options.clear === true ? clipboardClear() : null;
  return clipboardWrite(options.write);
}
// Accessibility, COM, WinRT, and OCR
function guid(text) {
  const bytes = Uint8Array.from(
    text.replace(/[{}-]/g, "").match(/../g),
    (x) => parseInt(x, 16),
  );
  return Uint8Array.of(
    bytes[3],
    bytes[2],
    bytes[1],
    bytes[0],
    bytes[5],
    bytes[4],
    bytes[7],
    bytes[6],
    ...bytes.slice(8),
  );
}

function checkHR(hr, label) {
  if (hr < 0) {
    throw new Error(`${label} failed: HRESULT 0x${(hr >>> 0).toString(16)}`);
  }
  return hr;
}

function comCall(object, index, result, parameters = [], args = []) {
  const vtable = new Deno.UnsafePointerView(object).getPointer(0);
  const pointer = new Deno.UnsafePointerView(vtable).getPointer(
    index * POINTER_SIZE,
  );
  const fn = new Deno.UnsafeFnPointer(pointer, {
    parameters: ["pointer", ...parameters],
    result,
  });
  return fn.call(object, ...args);
}

function comOut(
  object,
  index,
  Out = BigUint64Array,
  length = 1,
  args = [],
  parameters = args.map(() => "pointer"),
) {
  const out = new Out(length);
  const hr = comCall(object, index, "i32", [...parameters, "buffer"], [
    ...args,
    out,
  ]);
  return { hr, out };
}

function comPtr(
  object,
  index,
  args = [],
  parameters = args.map(() => "pointer"),
  label,
) {
  const { hr, out } = comOut(
    object,
    index,
    BigUint64Array,
    1,
    args,
    parameters,
  );
  if (label) checkHR(hr, label);
  else if (hr < 0) return null;
  return asPointer(out[0]);
}

function comRelease(...objects) {
  for (const object of objects) if (object) comCall(object, 2, "u32");
}

function comUse(object, fn) {
  if (!object) return null;
  try {
    return fn(object);
  } finally {
    comRelease(object);
  }
}

function comQuery(object, iid) {
  return comPtr(object, 0, [guid(iid)], ["buffer"], "QueryInterface");
}
const CLSID_CUIAutomation = "ff48dba4-60ef-4201-aa87-54103eef594e",
  IID_IUIAutomation = "30cbe57d-d9d0-452a-ab13-7ac5ac4825ee",
  CLSCTX_INPROC_SERVER = 1;
const UIA_TYPES =
  "button calendar check-box combo-box edit hyperlink image list-item list menu menu-bar menu-item progress-bar radio-button scroll-bar slider spinner status-bar tab tab-item text tool-bar tool-tip tree tree-item custom group thumb data-grid data-item document split-button window pane header header-item table title-bar separator semantic-zoom app-bar"
    .split(" ");
let comReady = false, uiaAutomation = null, uiaWalker = null;
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
  checkHR(
    ole32.symbols.CoCreateInstance(
      guid(CLSID_CUIAutomation),
      null,
      CLSCTX_INPROC_SERVER,
      guid(IID_IUIAutomation),
      out,
    ),
    "CoCreateInstance(CUIAutomation)",
  );
  if (!(uiaAutomation = asPointer(out[0]))) {
    throw new Error("CUIAutomation returned no interface");
  }
  if (
    !(uiaWalker = comPtr(
      uiaAutomation,
      14,
      [],
      [],
      "IUIAutomation.ControlViewWalker",
    ))
  ) {
    comRelease(uiaAutomation);
    uiaAutomation = null;
    throw new Error("UI Automation ControlViewWalker unavailable");
  }
}

function uiaRootElement() {
  ensureUia();
  return comPtr(uiaAutomation, 5);
}

function uiaElementFromHandle(hwnd) {
  if (!hwnd) return null;
  ensureUia();
  return comPtr(uiaAutomation, 6, [hwnd]);
}

function uiaParent(e) {
  ensureUia();
  return comPtr(uiaWalker, 3, [e]);
}

function uiaFirstChild(e) {
  ensureUia();
  return comPtr(uiaWalker, 4, [e]);
}

function uiaNextSibling(e) {
  ensureUia();
  return comPtr(uiaWalker, 6, [e]);
}

function uiaInt(e, i) {
  const r = comOut(e, i, Int32Array);
  return r.hr >= 0 ? r.out[0] : null;
}

function uiaBool(e, i) {
  const v = uiaInt(e, i);
  return v == null ? null : !!v;
}

function bstrText(p) {
  const n = p ? oleaut32.symbols.SysStringLen(p) : 0;
  return n
    ? textDecoder16.decode(
      new Uint8Array(new Deno.UnsafePointerView(p).getArrayBuffer(n * 2)),
    )
    : "";
}

function uiaBstr(e, i) {
  const p = comPtr(e, i);
  if (!p) return "";
  try {
    return bstrText(p);
  } finally {
    oleaut32.symbols.SysFreeString(p);
  }
}

function uiaNativeWid(e) {
  const p = comPtr(e, 36);
  return p ? ptrId(p) : null;
}

function uiaRect(e) {
  const { hr, out: r } = comOut(e, 43, Int32Array, 4);
  return hr < 0
    ? null
    : { x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1] };
}

function uiaRuntimeId(e) {
  const result = comOut(e, 4);
  if (result.hr < 0 || !result.out[0]) return null;
  const array = asPointer(result.out[0]),
    lo = new Int32Array(1),
    hi = new Int32Array(1),
    data = new BigUint64Array(1);
  let accessed = false;
  try {
    if (
      oleaut32.symbols.SafeArrayGetLBound(array, 1, lo) < 0 ||
      oleaut32.symbols.SafeArrayGetUBound(array, 1, hi) < 0
    ) return null;
    const count = hi[0] - lo[0] + 1;
    if (count <= 0) return [];
    if (oleaut32.symbols.SafeArrayAccessData(array, data) < 0 || !data[0]) {
      return null;
    }
    accessed = true;
    return [
      ...new Int32Array(
        new Deno.UnsafePointerView(asPointer(data[0])).getArrayBuffer(
          count * 4,
        ),
      ),
    ];
  } finally {
    if (accessed) oleaut32.symbols.SafeArrayUnaccessData(array);
    oleaut32.symbols.SafeArrayDestroy(array);
  }
}

function uiaVariant(e, id) {
  const v = new Uint8Array(24);
  if (comCall(e, 10, "i32", ["i32", "buffer"], [id, v]) < 0) return null;
  try {
    const d = new DataView(v.buffer), type = d.getUint16(0, true);
    return type === 3
      ? d.getInt32(8, true)
      : type === 5
      ? d.getFloat64(8, true)
      : type === 8
      ? bstrText(asPointer(d.getBigUint64(8, true)))
      : type === 11
      ? d.getInt16(8, true) !== 0
      : type === 19
      ? d.getUint32(8, true)
      : null;
  } finally {
    oleaut32.symbols.VariantClear(v);
  }
}

function uiaTypeName(id) {
  return id == null ? null : UIA_TYPES[Number(id) - 50000] ?? String(id);
}

function normalizeUiaType(value) {
  return typeof value === "number"
    ? uiaTypeName(value)
    : String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
}
const UIA_RECORD = [
  ["pid", 20, uiaInt],
  ["name", 23, uiaBstr],
  ["focus", 26, uiaBool],
  ["focusable", 27, uiaBool],
  ["enabled", 28, uiaBool],
  ["aid", 29, uiaBstr],
  ["class", 30, uiaBstr],
  ["offscreen", 38, uiaBool],
  ["framework", 40, uiaBstr],
];
const UIA_PATTERNS = [
  [10000, 30031, ["invoke"]],
  [10010, 30036, ["select"]],
  [10015, 30041, ["toggle"]],
  [10005, 30028, ["expand", "collapse"]],
  [10002, 30043, ["set"]],
  [10017, 30035, ["scroll"]],
];
function uiaActions(e, focusable) {
  const actions = [];
  for (const [, available, names] of UIA_PATTERNS) {
    if (uiaVariant(e, available) === true) actions.push(...names);
  }
  if (focusable) actions.push("focus");
  return actions;
}

function uiaRecord(e) {
  const runtime = uiaRuntimeId(e),
    record = {
      uid: runtime?.join(".") ?? null,
      wid: uiaNativeWid(e),
      type: uiaTypeName(uiaInt(e, 21)),
      rect: uiaRect(e),
      value: uiaVariant(e, 30045),
    };
  for (const [key, index, get] of UIA_RECORD) record[key] = get(e, index);
  record.actions = uiaActions(e, record.focusable);
  return record;
}

function normalizeUiaFilter(filter) {
  return filter == null
    ? {}
    : typeof filter === "string"
    ? { name: filter }
    : filter;
}

const A11Y_FIELDS = {
  uid: [false, filterExact],
  wid: [true, filterId],
  pid: [false, filterNum],
  aid: [false, regexFilter],
  name: [false, regexFilter],
  type: [false, (a, b) => anyFilter(b, (v) => a === normalizeUiaType(v))],
  class: [false, regexFilter],
  framework: [false, regexFilter],
  value: [false, regexFilter],
  enabled: [false, filterBool],
  focus: [false, filterBool],
  focusable: [false, filterBool],
  offscreen: [false, filterBool],
};

function uiaWalk(root, direction, maxDepth, visitor) {
  if (direction === "up") {
    let current = uiaParent(root);
    for (let depth = 1; current && depth <= maxDepth; depth++) {
      let next;
      try {
        if (visitor(current, depth)) return true;
        next = depth < maxDepth && uiaParent(current);
      } finally {
        comRelease(current);
      }
      current = next;
    }
    return false;
  }
  const down = (parent, depth) => {
    let child = uiaFirstChild(parent);
    while (child) {
      let next;
      try {
        if (
          visitor(child, depth) || (depth < maxDepth && down(child, depth + 1))
        ) return true;
        next = uiaNextSibling(child);
      } finally {
        comRelease(child);
      }
      child = next;
    }
    return false;
  };
  return maxDepth >= 1 && down(root, 1);
}

function matchesUiaRelation(element, direction, spec) {
  const relation = relationSpec(spec, "a11y");
  if (!relation) return false;
  if (relation.domain === "window") {
    const targets = new Set(
      windowRecords(relation.filter ?? {}).map((window) =>
        window.wid.toLowerCase()
      ),
    );
    return !!targets.size &&
      uiaWalk(element, direction, relation.depth, (e) => {
        const wid = uiaNativeWid(e);
        return !!wid && targets.has(wid.toLowerCase());
      });
  }
  return uiaWalk(element, direction, relation.depth, (e) => {
    const record = uiaRecord(e);
    return matchesUia(e, record, relation.filter);
  });
}

function matchesUia(element, record, filter) {
  filter = normalizeUiaFilter(filter);
  return matchesFields(record, filter, A11Y_FIELDS) &&
    (filter.up == null || matchesUiaRelation(element, "up", filter.up)) &&
    (filter.down == null || matchesUiaRelation(element, "down", filter.down));
}

function matchesWindowUiaRelation(window, direction, relation) {
  return !!comUse(
    uiaElementFromHandle(asPointer(window.wid)),
    (root) =>
      uiaWalk(root, direction, relation.depth, (e) => {
        const record = uiaRecord(e);
        return matchesUia(e, record, relation.filter);
      }),
  );
}

export function a11y_find({ a11y = {}, limit = 0 } = {}) {
  const max = findLimit(limit),
    filter = normalizeUiaFilter(a11y),
    found = [],
    seen = new Set();
  if (max == null) return [];

  const collect = (root, depth) =>
    comUse(root, (tree) =>
      uiaWalk(tree, "down", depth, (element) => {
        const record = uiaRecord(element);
        if (!matchesUia(element, record, filter)) return false;
        const key = record.uid ??
          `${record.wid ?? ""}:${
            record.pid ?? ""
          }:${record.name}:${record.type}:${record.rect?.x ?? ""}:${
            record.rect?.y ?? ""
          }`;
        if (!seen.has(key)) {
          seen.add(key);
          found.push(record);
        }
        return found.length >= max;
      }));
  if (own(filter, "wid") && filter.wid != null && !Array.isArray(filter.wid)) {
    const record = comUse(uiaElementFromHandle(asPointer(filter.wid)), (e) => {
      const value = uiaRecord(e);
      return matchesUia(e, value, filter) ? value : null;
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

function uiaResolve(filter = {}) {
  filter = normalizeUiaFilter(filter);
  const find = (root, depth = Infinity) =>
    comUse(root, (tree) => {
      let found = null;
      uiaWalk(tree, "down", depth, (element) => {
        const record = uiaRecord(element);
        if (!matchesUia(element, record, filter)) return false;
        comCall(element, 1, "u32");
        found = element;
        return true;
      });
      return found;
    });

  if (own(filter, "wid") && filter.wid != null && !Array.isArray(filter.wid)) {
    const element = uiaElementFromHandle(asPointer(filter.wid));
    if (!element) return null;
    const record = uiaRecord(element);
    if (matchesUia(element, record, filter)) return element;
    comRelease(element);
    return null;
  }
  const up = filter.up == null ? null : relationSpec(filter.up, "a11y");
  if (up?.domain === "window") {
    for (const window of windowRecords(up.filter)) {
      const found = find(uiaElementFromHandle(asPointer(window.wid)), up.depth);
      if (found) return found;
    }
  }
  return find(uiaRootElement());
}

function uiaPattern(element, id) {
  return comPtr(element, 16, [id], ["i32"]);
}
const UIA_ACTION = {
  invoke: [10000, 3],
  select: [10010, 3],
  toggle: [10015, 3],
  expand: [10005, 3],
  collapse: [10005, 4],
  set: [10002, 3],
  scroll: [10017, 3],
};
export function a11y_action({ a11y = {}, action, value } = {}) {
  action = String(action ?? "").toLowerCase();
  if (
    (action === "set" && value == null) ||
    (action !== "focus" && !UIA_ACTION[action])
  ) return null;
  return comUse(uiaResolve(a11y), (element) => {
    if (action === "focus") {
      if (comCall(element, 3, "i32") < 0) return null;
    } else {
      const spec = UIA_ACTION[action], pattern = uiaPattern(element, spec[0]);
      if (!pattern) return null;
      try {
        if (action === "set") {
          const text = oleaut32.symbols.SysAllocString(
            wide(String(value ?? ""), true),
          );
          if (!text) throw new Error("SysAllocString failed");
          try {
            if (comCall(pattern, spec[1], "i32", ["pointer"], [text]) < 0) {
              return null;
            }
          } finally {
            oleaut32.symbols.SysFreeString(text);
          }
        } else if (comCall(pattern, spec[1], "i32") < 0) {
          return null;
        }
      } finally {
        comRelease(pattern);
      }
    }
    return { action, ...uiaRecord(element) };
  });
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
  checkHR(
    combase.symbols.WindowsCreateString(chars, chars.length, out),
    "WindowsCreateString",
  );
  return asPointer(out[0]);
}

function hstringText(hstring, free = true) {
  if (!hstring) return "";
  try {
    const length = new Uint32Array(1),
      p = combase.symbols.WindowsGetStringRawBuffer(hstring, length);
    return p && length[0]
      ? textDecoder16.decode(
        new Uint8Array(
          new Deno.UnsafePointerView(p).getArrayBuffer(length[0] * 2),
        ),
      )
      : "";
  } finally {
    if (free) combase.symbols.WindowsDeleteString(hstring);
  }
}

function activationFactory(className, iid) {
  ensureRo();
  const name = createHString(className), out = new BigUint64Array(1);
  try {
    checkHR(
      combase.symbols.RoGetActivationFactory(name, guid(iid), out),
      `RoGetActivationFactory(${className})`,
    );
  } finally {
    combase.symbols.WindowsDeleteString(name);
  }
  return asPointer(out[0]);
}
const IID_IBufferFactory = "71af914d-c10f-484b-bc50-14bc623b3a27",
  IID_IBufferByteAccess = "905a0fef-bc53-11df-8c49-001e4fc686da";
const IID_ISoftwareBitmapStatics = "df0385db-672f-4a9d-806e-c2442f343e86",
  IID_IOcrEngineStatics = "5bffa85a-3384-3540-9940-699120d428a8",
  IID_IAsyncInfo = "00000036-0000-0000-c000-000000000046";
function softwareBitmapFromBGRA(image) {
  const factory = activationFactory(
    "Windows.Storage.Streams.Buffer",
    IID_IBufferFactory,
  );
  let buffer, access, statics;
  try {
    buffer = comPtr(
      factory,
      6,
      [image.data.length],
      ["u32"],
      "IBufferFactory.Create",
    );
    checkHR(
      comCall(buffer, 8, "i32", ["u32"], [image.data.length]),
      "IBuffer.SetLength",
    );
    access = comQuery(buffer, IID_IBufferByteAccess);
    ntdll.symbols.RtlMoveMemory(
      comPtr(access, 3, [], [], "IBufferByteAccess.Buffer"),
      image.data,
      image.data.length,
    );
    statics = activationFactory(
      "Windows.Graphics.Imaging.SoftwareBitmap",
      IID_ISoftwareBitmapStatics,
    );
    return comPtr(
      statics,
      9,
      [buffer, 87, image.rect.width, image.rect.height],
      ["pointer", "i32", "i32", "i32"],
      "SoftwareBitmap.CreateCopyFromBuffer",
    );
  } finally {
    comRelease(statics, access, buffer, factory);
  }
}

async function asyncResult(operation) {
  const info = comQuery(operation, IID_IAsyncInfo);
  try {
    for (;;) {
      const status = comOut(info, 7, Int32Array);
      if (status.hr < 0) return null;
      if (status.out[0] === 1) return comPtr(operation, 8);
      if (status.out[0] === 2 || status.out[0] === 3) return null;
      await wait(5);
    }
  } finally {
    comRelease(info);
  }
}

async function decodeImage(source, rect = {}, grayscale = false) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  return {
    rect: {
      x: rect.x ?? 0,
      y: rect.y ?? 0,
      width: info.width,
      height: info.height,
    },
    format: "bgra8",
    grayscale: !!grayscale,
    data: swapRedBlue(data),
  };
}

async function imageBGRA(image) {
  if (!image) return null;
  if (image.format === "bgra8") return image;
  if (!(image.data instanceof Uint8Array)) return null;
  try {
    return await decodeImage(image.data, image.rect, image.grayscale);
  } catch {
    return null;
  }
}

export async function ocr(options = {}) {
  const image = options.image
    ? await imageBGRA(options.image)
    : captureScreenshot(options);
  if (!image) return null;
  const bitmap = softwareBitmapFromBGRA(image),
    statics = activationFactory(
      "Windows.Media.Ocr.OcrEngine",
      IID_IOcrEngineStatics,
    );
  let engine, operation, result;
  try {
    engine = comPtr(statics, 10);
    if (!engine) return null;
    operation = comPtr(engine, 6, [bitmap]);
    if (!operation) return null;
    result = await asyncResult(operation);
    if (!result) return null;
    const text = comPtr(result, 8);
    if (!text) return null;
    return { text: hstringText(text), rect: image.rect };
  } finally {
    comRelease(result, operation, engine, statics, bitmap);
  }
}
// Image matching and synchronization
function rgbDiff(a, ai, b, bi) {
  return Math.abs(a[ai] - b[bi]) + Math.abs(a[ai + 1] - b[bi + 1]) +
    Math.abs(a[ai + 2] - b[bi + 2]);
}

function imageScoreAt(source, template, ox, oy, threshold) {
  const sw = source.rect.width,
    tw = template.rect.width,
    th = template.rect.height,
    total = tw * th * 765,
    max = (1 - threshold) * total;
  let diff = 0;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      diff += rgbDiff(
        source.data,
        ((oy + y) * sw + ox + x) * 4,
        template.data,
        (y * tw + x) * 4,
      );
      if (diff > max) return 0;
    }
  }
  return 1 - diff / total;
}

function imageProbe(source, template, ox, oy, threshold) {
  const sw = source.rect.width,
    tw = template.rect.width,
    th = template.rect.height;
  const xs = [...new Set([0, tw >> 1, tw - 1])],
    ys = [...new Set([0, th >> 1, th - 1])];
  let diff = 0, count = 0;
  for (const y of ys) {
    for (const x of xs) {
      diff += rgbDiff(
        source.data,
        ((oy + y) * sw + ox + x) * 4,
        template.data,
        (y * tw + x) * 4,
      );
      count++;
    }
  }
  return 1 - diff / (count * 765) >= Math.max(0, threshold - .03);
}

function findImage(source, template, similarity = .98) {
  if (!source || !template) return null;
  similarity = Math.max(0, Math.min(1, Number(similarity)));
  const { width: sw, height: sh } = source.rect,
    { width: tw, height: th } = template.rect;
  if (tw > sw || th > sh) return null;
  for (let y = 0; y <= sh - th; y++) {
    for (let x = 0; x <= sw - tw; x++) {
      if (!imageProbe(source, template, x, y, similarity)) continue;
      const score = imageScoreAt(source, template, x, y, similarity);
      if (score >= similarity) {
        return {
          rect: {
            x: source.rect.x + x,
            y: source.rect.y + y,
            width: tw,
            height: th,
          },
          similarity: score,
        };
      }
    }
  }
  return null;
}

function imageChange(before, after) {
  if (!before || !after) return null;
  const { width, height } = after.rect, total = width * height;
  if (!total) return null;
  if (before.rect.width !== width || before.rect.height !== height) {
    return {
      rect: after.rect,
      changed: total,
      percent: 100,
      bounds: after.rect,
    };
  }
  let changed = 0, minX = width, minY = height, maxX = -1, maxY = -1;
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (!rgbDiff(before.data, i, after.data, i)) continue;
    const x = p % width, y = Math.floor(p / width);
    changed++;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const bounds = changed
    ? {
      x: after.rect.x + minX,
      y: after.rect.y + minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    }
    : null;
  return { rect: after.rect, changed, percent: changed * 100 / total, bounds };
}

async function prepareWaitCondition(kind, spec) {
  if (kind === "window") return { window: spec };
  if (kind === "ocr") {
    return spec && typeof spec === "object" && spec.text != null ? spec : null;
  }
  if (kind === "image") {
    if (typeof spec === "string") spec = { path: spec };
    if (!spec || typeof spec !== "object" || !spec.path) return null;
    try {
      return { spec, template: await decodeImage(spec.path) };
    } catch {
      return null;
    }
  }
  spec ??= {};
  if (typeof spec !== "object" || Array.isArray(spec)) return null;
  const percent = spec.percent == null ? 0 : Number(spec.percent);
  return Number.isFinite(percent) && percent >= 0 && percent <= 100
    ? { spec, baseline: null }
    : null;
}

async function testWaitCondition(kind, prepared) {
  const none = { matched: false, value: null };
  try {
    if (kind === "window") {
      const value = window_get(prepared);
      return { matched: !!value, value };
    }
    if (kind === "ocr") {
      const { text, ...source } = prepared, value = await ocr(source);
      return { matched: !!value && regexMatch(value.text, text), value };
    }
    if (kind === "image") {
      const { path, similarity = .98, ...source } = prepared.spec,
        match = findImage(
          captureScreenshot(source),
          prepared.template,
          similarity,
        );
      return { matched: !!match, value: match ? { path, ...match } : null };
    }
    const { percent, ...source } = prepared.spec,
      image = captureScreenshot(source);
    if (!image) return none;
    if (!prepared.baseline) {
      prepared.baseline = image;
      return { ready: false, ...none };
    }
    const value = imageChange(prepared.baseline, image);
    return {
      matched: !!value?.changed && value.percent >= Number(percent ?? 0),
      value,
    };
  } catch { /* unavailable target = false sample */ }
  return none;
}
