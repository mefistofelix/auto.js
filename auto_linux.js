if (Deno.build.os !== "linux") {
  throw new Error("auto_linux.js requires Linux");
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function env(name) {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

const sessionType = String(env("XDG_SESSION_TYPE") ?? "").toLowerCase();
const wayland = sessionType === "wayland" || !!env("WAYLAND_DISPLAY");
const x11Session = !wayland && (sessionType === "x11" || !!env("DISPLAY"));

function openLibrary(name, symbols) {
  try {
    return Deno.dlopen(name, symbols);
  } catch {
    return null;
  }
}

function cString(text) {
  const data = textEncoder.encode(String(text));
  const out = new Uint8Array(data.length + 1);
  out.set(data);
  return out;
}

function pointer(value) {
  return value ? Deno.UnsafePointer.create(BigInt(value)) : null;
}

function pointerValue(value) {
  return value ? Deno.UnsafePointer.value(value) : 0n;
}

function pointerId(value) {
  return `0x${pointerValue(value).toString(16)}`;
}

function windowId(value) {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function timeAtom(value, action) {
  const text = String(value).trim();
  const ref = text.match(/^\$\.curr((?:\.[A-Za-z_][A-Za-z0-9_-]*)+)$/);
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

function userTime(value) {
  return typeof value === "string" && /^user\(\)$/i.test(value.trim());
}

function userInterval() {
  return 45 + Math.random() * 105;
}

function timeMs(value, fallback = 0, action) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value !== "string") return fallback;
  if (userTime(value)) return userInterval();
  const text = value.trim();
  const random = text.match(/^rand\((.+)\)$/i);
  const resolved = timeExpr(random ? random[1] : text, action);
  if (resolved == null) return fallback;
  return Math.max(0, random ? Math.random() * resolved : resolved);
}

function delay(value, action) {
  return new Promise((resolve) =>
    setTimeout(resolve, timeMs(value, 0, action))
  );
}

const xlib = x11Session
  ? openLibrary("libX11.so.6", {
    XOpenDisplay: { parameters: ["pointer"], result: "pointer" },
    XDefaultRootWindow: { parameters: ["pointer"], result: "u64" },
    XDefaultScreen: { parameters: ["pointer"], result: "i32" },
    XDisplayWidth: { parameters: ["pointer", "i32"], result: "i32" },
    XDisplayHeight: { parameters: ["pointer", "i32"], result: "i32" },
    XQueryTree: {
      parameters: [
        "pointer",
        "u64",
        "buffer",
        "buffer",
        "buffer",
        "buffer",
      ],
      result: "i32",
    },
    XFree: { parameters: ["pointer"], result: "i32" },
    XInternAtom: { parameters: ["pointer", "buffer", "i32"], result: "u64" },
    XGetWindowProperty: {
      parameters: [
        "pointer",
        "u64",
        "u64",
        "i64",
        "i64",
        "i32",
        "u64",
        "buffer",
        "buffer",
        "buffer",
        "buffer",
        "buffer",
      ],
      result: "i32",
    },
    XFetchName: {
      parameters: ["pointer", "u64", "buffer"],
      result: "i32",
    },
    XGetClassHint: {
      parameters: ["pointer", "u64", "buffer"],
      result: "i32",
    },
    XGetTransientForHint: {
      parameters: ["pointer", "u64", "buffer"],
      result: "i32",
    },
    XGetGeometry: {
      parameters: [
        "pointer",
        "u64",
        "buffer",
        "buffer",
        "buffer",
        "buffer",
        "buffer",
        "buffer",
        "buffer",
      ],
      result: "i32",
    },
    XTranslateCoordinates: {
      parameters: [
        "pointer",
        "u64",
        "u64",
        "i32",
        "i32",
        "buffer",
        "buffer",
        "buffer",
      ],
      result: "i32",
    },
    XMoveResizeWindow: {
      parameters: ["pointer", "u64", "i32", "i32", "u32", "u32"],
      result: "i32",
    },
    XRaiseWindow: { parameters: ["pointer", "u64"], result: "i32" },
    XSetInputFocus: {
      parameters: ["pointer", "u64", "i32", "u64"],
      result: "i32",
    },
    XIconifyWindow: {
      parameters: ["pointer", "u64", "i32"],
      result: "i32",
    },
    XMapRaised: { parameters: ["pointer", "u64"], result: "i32" },
    XStoreName: {
      parameters: ["pointer", "u64", "buffer"],
      result: "i32",
    },
    XChangeProperty: {
      parameters: [
        "pointer",
        "u64",
        "u64",
        "u64",
        "i32",
        "i32",
        "buffer",
        "i32",
      ],
      result: "i32",
    },
    XSendEvent: {
      parameters: ["pointer", "u64", "i32", "i64", "buffer"],
      result: "i32",
    },
    XFlush: { parameters: ["pointer"], result: "i32" },
    XSync: { parameters: ["pointer", "i32"], result: "i32" },
    XWarpPointer: {
      parameters: [
        "pointer",
        "u64",
        "u64",
        "i32",
        "i32",
        "u32",
        "u32",
        "i32",
        "i32",
      ],
      result: "i32",
    },
    XQueryPointer: {
      parameters: [
        "pointer",
        "u64",
        "buffer",
        "buffer",
        "buffer",
        "buffer",
        "buffer",
        "buffer",
        "buffer",
      ],
      result: "i32",
    },
    XStringToKeysym: { parameters: ["buffer"], result: "u64" },
    XKeysymToKeycode: { parameters: ["pointer", "u64"], result: "u8" },
    XKeycodeToKeysym: {
      parameters: ["pointer", "u8", "i32"],
      result: "u64",
    },
    XGetImage: {
      parameters: [
        "pointer",
        "u64",
        "i32",
        "i32",
        "u32",
        "u32",
        "u64",
        "i32",
      ],
      result: "pointer",
    },
    XResetScreenSaver: { parameters: ["pointer"], result: "i32" },
  })
  : null;

const xtst = xlib
  ? openLibrary("libXtst.so.6", {
    XTestFakeButtonEvent: {
      parameters: ["pointer", "u32", "i32", "u64"],
      result: "i32",
    },
    XTestFakeKeyEvent: {
      parameters: ["pointer", "u32", "i32", "u64"],
      result: "i32",
    },
  })
  : null;

const xrandr = xlib
  ? openLibrary("libXrandr.so.2", {
    XRRGetMonitors: {
      parameters: ["pointer", "u64", "i32", "buffer"],
      result: "pointer",
    },
    XRRFreeMonitors: { parameters: ["pointer"], result: "void" },
  })
  : null;

const xDisplay = xlib?.symbols.XOpenDisplay(null) ?? null;
const xRoot = xDisplay ? xlib.symbols.XDefaultRootWindow(xDisplay) : 0n;
const xScreen = xDisplay ? xlib.symbols.XDefaultScreen(xDisplay) : 0;
const atoms = new Map();

function atom(name) {
  if (!xDisplay) return 0n;
  if (!atoms.has(name)) {
    atoms.set(name, xlib.symbols.XInternAtom(xDisplay, cString(name), 0));
  }
  return atoms.get(name);
}

function xQueryChildren(window) {
  if (!xDisplay || !window) return [];
  const root = new BigUint64Array(1);
  const parent = new BigUint64Array(1);
  const children = new BigUint64Array(1);
  const count = new Uint32Array(1);
  if (
    !xlib.symbols.XQueryTree(
      xDisplay,
      window,
      root,
      parent,
      children,
      count,
    ) || !children[0] || !count[0]
  ) return [];
  const value = pointer(children[0]);
  try {
    return [
      ...new BigUint64Array(
        new Deno.UnsafePointerView(value).getArrayBuffer(count[0] * 8),
      ),
    ];
  } finally {
    xlib.symbols.XFree(value);
  }
}

function xProperty(window, name) {
  if (!xDisplay || !window) return null;
  const actualType = new BigUint64Array(1);
  const format = new Int32Array(1);
  const count = new BigUint64Array(1);
  const remaining = new BigUint64Array(1);
  const out = new BigUint64Array(1);
  if (
    xlib.symbols.XGetWindowProperty(
        xDisplay,
        window,
        atom(name),
        0n,
        65536n,
        0,
        0n,
        actualType,
        format,
        count,
        remaining,
        out,
      ) !== 0 || !out[0]
  ) return null;
  const value = pointer(out[0]);
  try {
    const stride = format[0] === 32 ? 8 : format[0] / 8;
    if (!stride || count[0] > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    const size = Number(count[0]) * stride;
    return {
      type: actualType[0],
      format: format[0],
      count: Number(count[0]),
      data: new Uint8Array(
        new Deno.UnsafePointerView(value).getArrayBuffer(size),
      ).slice(),
    };
  } finally {
    xlib.symbols.XFree(value);
  }
}

function xPropertyLongs(window, name) {
  const property = xProperty(window, name);
  if (!property || property.format !== 32) return [];
  const view = new DataView(property.data.buffer);
  return Array.from(
    { length: property.count },
    (_, i) => view.getBigUint64(i * 8, true),
  );
}

function xPropertyText(window, name) {
  const property = xProperty(window, name);
  return property?.format === 8
    ? textDecoder.decode(property.data).replace(/\0.*$/s, "")
    : "";
}

function xTitle(window) {
  const modern = xPropertyText(window, "_NET_WM_NAME");
  if (modern) return modern;
  if (!xDisplay) return "";
  const out = new BigUint64Array(1);
  if (!xlib.symbols.XFetchName(xDisplay, window, out) || !out[0]) return "";
  const value = pointer(out[0]);
  try {
    return new Deno.UnsafePointerView(value).getCString();
  } finally {
    xlib.symbols.XFree(value);
  }
}

function xClass(window) {
  if (!xDisplay) return "";
  const hint = new BigUint64Array(2);
  if (!xlib.symbols.XGetClassHint(xDisplay, window, hint)) return "";
  const name = hint[0] ? pointer(hint[0]) : null;
  const className = hint[1] ? pointer(hint[1]) : null;
  try {
    return className
      ? new Deno.UnsafePointerView(className).getCString()
      : name
      ? new Deno.UnsafePointerView(name).getCString()
      : "";
  } finally {
    if (name) xlib.symbols.XFree(name);
    if (className) xlib.symbols.XFree(className);
  }
}

function xOwner(window) {
  if (!xDisplay) return 0n;
  const owner = new BigUint64Array(1);
  return xlib.symbols.XGetTransientForHint(xDisplay, window, owner)
    ? owner[0]
    : 0n;
}

function xClientRect(window) {
  if (!xDisplay || !window) return null;
  const root = new BigUint64Array(1);
  const x = new Int32Array(1);
  const y = new Int32Array(1);
  const width = new Uint32Array(1);
  const height = new Uint32Array(1);
  const border = new Uint32Array(1);
  const depth = new Uint32Array(1);
  if (
    !xlib.symbols.XGetGeometry(
      xDisplay,
      window,
      root,
      x,
      y,
      width,
      height,
      border,
      depth,
    )
  ) return null;
  const screenX = new Int32Array(1);
  const screenY = new Int32Array(1);
  const child = new BigUint64Array(1);
  if (
    !xlib.symbols.XTranslateCoordinates(
      xDisplay,
      window,
      xRoot,
      0,
      0,
      screenX,
      screenY,
      child,
    )
  ) return null;
  return {
    x: screenX[0],
    y: screenY[0],
    width: width[0],
    height: height[0],
  };
}

function xWindowRect(window) {
  const client = xClientRect(window);
  if (!client) return null;
  const extents = xPropertyLongs(window, "_NET_FRAME_EXTENTS");
  if (extents.length < 4) return client;
  const [left, right, top, bottom] = extents.map(Number);
  return {
    x: client.x - left,
    y: client.y - top,
    width: client.width + left + right,
    height: client.height + top + bottom,
  };
}

function processPath(pid) {
  if (!pid) return "";
  try {
    return Deno.readLinkSync(`/proc/${pid}/exe`);
  } catch {
    return "";
  }
}

function displayRecords() {
  if (!xDisplay) return [];
  const found = [];
  if (xrandr) {
    const count = new Int32Array(1);
    const monitors = xrandr.symbols.XRRGetMonitors(
      xDisplay,
      xRoot,
      1,
      count,
    );
    if (monitors && count[0] > 0) {
      try {
        const view = new DataView(
          new Deno.UnsafePointerView(monitors).getArrayBuffer(count[0] * 56),
        );
        for (let i = 0; i < count[0]; i++) {
          const offset = i * 56;
          found.push({
            primary: !!view.getInt32(offset + 8, true),
            scale: 1,
            x: view.getInt32(offset + 20, true),
            y: view.getInt32(offset + 24, true),
            width: view.getInt32(offset + 28, true),
            height: view.getInt32(offset + 32, true),
          });
        }
      } finally {
        xrandr.symbols.XRRFreeMonitors(monitors);
      }
    }
  }
  if (!found.length) {
    found.push({
      primary: true,
      scale: 1,
      x: 0,
      y: 0,
      width: xlib.symbols.XDisplayWidth(xDisplay, xScreen),
      height: xlib.symbols.XDisplayHeight(xDisplay, xScreen),
    });
  }
  found.sort((a, b) =>
    Number(b.primary) - Number(a.primary) || a.x - b.x || a.y - b.y
  );
  return found.map((display, index) => ({
    index,
    ...display,
    work: {
      x: display.x,
      y: display.y,
      width: display.width,
      height: display.height,
    },
  }));
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

function xClientWindows() {
  if (!xDisplay) return [];
  const stacking = xPropertyLongs(xRoot, "_NET_CLIENT_LIST_STACKING");
  return stacking.length ? stacking : xQueryChildren(xRoot);
}

function xActiveWindow() {
  return xPropertyLongs(xRoot, "_NET_ACTIVE_WINDOW")[0] ?? 0n;
}

function xState(window) {
  return new Set(xPropertyLongs(window, "_NET_WM_STATE"));
}

function displayIndexForRect(rect, displays) {
  if (!rect) return null;
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  const found = displays.find((display) =>
    x >= display.x && x < display.x + display.width &&
    y >= display.y && y < display.y + display.height
  );
  return found?.index ?? displays[0]?.index ?? null;
}

function getWindowInfo(window, zorder = 0, displays = displayRecords()) {
  if (!window) return null;
  const client = xClientRect(window);
  const rect = xWindowRect(window);
  if (!client || !rect || rect.width <= 0 || rect.height <= 0) return null;
  const pid = Number(xPropertyLongs(window, "_NET_WM_PID")[0] ?? 0n);
  const owner = xOwner(window);
  const states = xState(window);
  const hiddenAtom = atom("_NET_WM_STATE_HIDDEN");
  const maxH = atom("_NET_WM_STATE_MAXIMIZED_HORZ");
  const maxV = atom("_NET_WM_STATE_MAXIMIZED_VERT");
  const hidden = hiddenAtom ? states.has(hiddenAtom) : false;
  const maximized = maxH && maxV && states.has(maxH) && states.has(maxV);
  return {
    wid: `0x${window.toString(16)}`,
    wpid: null,
    woid: owner ? `0x${owner.toString(16)}` : null,
    depth: 0,
    zorder,
    title: xTitle(window),
    class: xClass(window),
    pid,
    bin: processPath(pid),
    display: displayIndexForRect(rect, displays),
    rect,
    client,
    status: hidden ? "minimized" : maximized ? "maximized" : "normal",
    hidden,
    foreground: xActiveWindow() === window,
  };
}

function regexMatch(value, pattern) {
  try {
    return new RegExp(String(pattern), "i").test(String(value ?? ""));
  } catch {
    return false;
  }
}

function anyFilter(value, match) {
  const values = Array.isArray(value) ? value : [value];
  return values.length > 0 && values.some(match);
}

function sameId(a, b) {
  return a == null || b == null
    ? a == null && b == null
    : String(a).toLowerCase() === String(b).toLowerCase();
}

function normalizeWindowFilter(filter) {
  if (filter == null) return {};
  if (typeof filter === "string") {
    return filter.startsWith("0x") ? { wid: filter } : { title: filter };
  }
  return typeof filter === "number" || typeof filter === "bigint"
    ? { wid: `0x${BigInt(filter).toString(16)}` }
    : filter;
}

function matchesWindow(record, filter) {
  if (filter.up != null || filter.down != null) return false;
  const rules = [
    ["wid", false, (a, b) => anyFilter(b, (v) => sameId(a, v))],
    ["wpid", true, (a, b) => anyFilter(b, (v) => sameId(a, v))],
    ["woid", true, (a, b) => anyFilter(b, (v) => sameId(a, v))],
    [
      "depth",
      false,
      (a, b) =>
        anyFilter(
          b,
          (v) => String(v).toLowerCase() === "all" || a === Number(v),
        ),
    ],
    ["zorder", false, (a, b) => anyFilter(b, (v) => a === Number(v))],
    ["pid", false, (a, b) => anyFilter(b, (v) => a === Number(v))],
    ["title", false, (a, b) => anyFilter(b, (v) => regexMatch(a, v))],
    ["bin", false, (a, b) => anyFilter(b, (v) => regexMatch(a, v))],
    ["class", false, (a, b) => anyFilter(b, (v) => regexMatch(a, v))],
    [
      "display",
      false,
      (a, b) =>
        anyFilter(b, (v) => a === Number(typeof v === "object" ? v.index : v)),
    ],
    [
      "status",
      false,
      (a, b) => anyFilter(b, (v) => a === String(v).toLowerCase()),
    ],
    ["hidden", false, (a, b) => a === !!b],
    ["foreground", false, (a, b) => a === !!b],
  ];
  for (const [key, byOwn, test] of rules) {
    if (
      (byOwn ? own(filter, key) : filter[key] != null) &&
      !test(record[key], filter[key])
    ) {
      return false;
    }
  }
  return true;
}

function windowRecords(filter = {}) {
  filter = normalizeWindowFilter(filter);
  if (!xDisplay) return [];
  const windows = xClientWindows();
  const displays = displayRecords();
  const records = windows.map((window, index) =>
    getWindowInfo(window, windows.length - 1 - index, displays)
  ).filter(Boolean);
  return records.filter((record) => matchesWindow(record, filter));
}

function findLimit(limit) {
  return limit == null || limit === 0
    ? Infinity
    : Number.isInteger(limit) && limit > 0
    ? limit
    : null;
}

export function window_find({ window = {}, limit = 0 } = {}) {
  const max = findLimit(limit);
  if (max == null) return [];
  const found = windowRecords(window);
  return max === Infinity ? found : found.slice(0, max);
}

export function window_get_prop({ window = {}, text = false } = {}) {
  const found = windowRecords(window)[0];
  if (!found) return null;
  return text ? { ...found, text: null } : found;
}

function xClientMessage(window, message, values = []) {
  if (!xDisplay || !window) return false;
  const event = new Uint8Array(192);
  const view = new DataView(event.buffer);
  view.setInt32(0, 33, true);
  view.setBigUint64(32, window, true);
  view.setBigUint64(40, atom(message), true);
  view.setInt32(48, 32, true);
  for (let i = 0; i < Math.min(5, values.length); i++) {
    view.setBigInt64(56 + i * 8, BigInt(values[i]), true);
  }
  const sent = xlib.symbols.XSendEvent(
    xDisplay,
    xRoot,
    0,
    0x180000n,
    event,
  );
  xlib.symbols.XFlush(xDisplay);
  return !!sent;
}

function xWindowState(window, action, first, second = 0n) {
  return xClientMessage(window, "_NET_WM_STATE", [
    action,
    first,
    second,
    2,
    0,
  ]);
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
    WC: info?.client ?? null,
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
  const [, sign, amount, percent, suffix] = match;
  const n = Number(amount);
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
    const ref = context[suffix.toUpperCase()];
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
  const { factors: [fx, fy], suffix } = anchorSpec(at);
  const rect = (suffix && context[suffix]) || fallback;
  if (!rect) return null;
  return { x: rect.x + rect.width * fx, y: rect.y + rect.height * fy };
}

function resolveRectAxis(rect, base, context, axis) {
  const horizontal = axis === "x";
  const startKey = horizontal ? "left" : "top";
  const endKey = horizontal ? "right" : "bottom";
  const sizeKey = horizontal ? "width" : "height";
  const start = base[axis];
  const size = base[sizeKey];
  const end = start + size;
  const factor = anchorSpec(rect.at).factors[horizontal ? 0 : 1];
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
  const anchor = geometryAnchor(context, rect.at, base)?.[axis] ?? start;
  const nextAnchor = rect[axis] == null
    ? anchor
    : geometryValue(rect[axis], axis, anchor, context);
  const next = nextAnchor - nextSize * factor;
  return [next, next + nextSize];
}

function resolveRect(rect = {}, base, context) {
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
  const from = geometryAnchor(context, pos.at, rect);
  if (!from) return rect;
  const to = resolvePos(pos, from, context, from);
  return {
    ...rect,
    x: Math.round(rect.x + to.x - from.x),
    y: Math.round(rect.y + to.y - from.y),
  };
}

export function window_control(
  { window = {}, display, action, pos, rect } = {},
) {
  const info = windowRecords(window)[0];
  if (!info || !xDisplay) return null;
  const wid = windowId(info.wid);
  if (action === "focus") {
    xClientMessage(wid, "_NET_ACTIVE_WINDOW", [2, 0, 0, 0, 0]);
    xlib.symbols.XRaiseWindow(xDisplay, wid);
    xlib.symbols.XSetInputFocus(xDisplay, wid, 1, 0n);
  } else if (action === "minimize") {
    xlib.symbols.XIconifyWindow(xDisplay, wid, xScreen);
  } else if (action === "restore") {
    xlib.symbols.XMapRaised(xDisplay, wid);
    xWindowState(wid, 0, atom("_NET_WM_STATE_HIDDEN"));
  } else if (action === "maximize") {
    xWindowState(
      wid,
      1,
      atom("_NET_WM_STATE_MAXIMIZED_HORZ"),
      atom("_NET_WM_STATE_MAXIMIZED_VERT"),
    );
  } else if (action === "move" || action === "size") {
    const geometry = geometryContext(info, display);
    const next = positionRect(
      resolveRect(rect, info.rect, geometry),
      pos,
      geometry,
    );
    if (next.width > 0 && next.height > 0) {
      if (
        !xClientMessage(wid, "_NET_MOVERESIZE_WINDOW", [
          0x2f00,
          next.x,
          next.y,
          next.width,
          next.height,
        ])
      ) {
        xlib.symbols.XMoveResizeWindow(
          xDisplay,
          wid,
          next.x,
          next.y,
          next.width,
          next.height,
        );
      }
    }
  } else if (action === "close") {
    xClientMessage(wid, "_NET_CLOSE_WINDOW", [0, 2, 0, 0, 0]);
  }
  xlib.symbols.XFlush(xDisplay);
  return window_get_prop({ window: { wid: info.wid } });
}

export function window_set_prop(
  { window = {}, title, frame, topmost, opacity, enabled, highlight } = {},
) {
  const info = windowRecords(window)[0];
  if (!info || !xDisplay) return null;
  const wid = windowId(info.wid);
  if (title != null) {
    const text = cString(title);
    xlib.symbols.XStoreName(xDisplay, wid, text);
    const utf8 = textEncoder.encode(String(title));
    xlib.symbols.XChangeProperty(
      xDisplay,
      wid,
      atom("_NET_WM_NAME"),
      atom("UTF8_STRING"),
      8,
      0,
      utf8,
      utf8.length,
    );
  }
  if (topmost != null) {
    xWindowState(
      wid,
      topmost ? 1 : 0,
      atom("_NET_WM_STATE_ABOVE"),
    );
  }
  if (opacity != null) {
    const value = Number(opacity);
    if (Number.isFinite(value) && value >= 0 && value <= 1) {
      const data = new BigUint64Array([
        BigInt(Math.round(value * 0xffffffff) >>> 0),
      ]);
      xlib.symbols.XChangeProperty(
        xDisplay,
        wid,
        atom("_NET_WM_WINDOW_OPACITY"),
        atom("CARDINAL"),
        32,
        0,
        new Uint8Array(data.buffer),
        1,
      );
    }
  }
  void frame;
  void enabled;
  void highlight;
  xlib.symbols.XFlush(xDisplay);
  return window_get_prop({ window: { wid: info.wid } });
}

function cursorPoint() {
  if (!xDisplay) return null;
  const root = new BigUint64Array(1);
  const child = new BigUint64Array(1);
  const rootX = new Int32Array(1);
  const rootY = new Int32Array(1);
  const winX = new Int32Array(1);
  const winY = new Int32Array(1);
  const mask = new Uint32Array(1);
  return xlib.symbols.XQueryPointer(
      xDisplay,
      xRoot,
      root,
      child,
      rootX,
      rootY,
      winX,
      winY,
      mask,
    )
    ? { x: rootX[0], y: rootY[0] }
    : null;
}

function mouseTarget(info, display, pos, defaultAt) {
  const from = cursorPoint();
  if (!from) return null;
  const target = defaultAt ? { at: defaultAt, ...(pos ?? {}) } : pos;
  const geometry = geometryContext(info, display);
  const rect = info?.rect ??
    (display != null || target?.at != null ? geometry.D : null);
  const relative = rect ? geometryAnchor(geometry, target?.at, rect) : from;
  if (!relative) return null;
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

export function window_hit({ pos, display, child = false } = {}) {
  if (child || !xDisplay) return null;
  const point = mouseTarget(null, display, pos)?.to;
  if (!point) return null;
  return windowRecords({ hidden: false })
    .sort((a, b) => a.zorder - b.zorder)
    .find((window) =>
      point.x >= window.rect.x &&
      point.x < window.rect.x + window.rect.width &&
      point.y >= window.rect.y &&
      point.y < window.rect.y + window.rect.height
    ) ?? null;
}

const glib = openLibrary("libglib-2.0.so.0", {
  g_free: { parameters: ["pointer"], result: "void" },
});

const gobject = openLibrary("libgobject-2.0.so.0", {
  g_object_ref: { parameters: ["pointer"], result: "pointer" },
  g_object_unref: { parameters: ["pointer"], result: "void" },
});

const atspi = openLibrary("libatspi.so.0", {
  atspi_init: { parameters: [], result: "i32" },
  atspi_get_desktop_count: { parameters: [], result: "i32" },
  atspi_get_desktop: { parameters: ["i32"], result: "pointer" },
  atspi_accessible_get_child_count: {
    parameters: ["pointer", "pointer"],
    result: "i32",
  },
  atspi_accessible_get_child_at_index: {
    parameters: ["pointer", "i32", "pointer"],
    result: "pointer",
  },
  atspi_accessible_get_name: {
    parameters: ["pointer", "pointer"],
    result: "pointer",
  },
  atspi_accessible_get_role_name: {
    parameters: ["pointer", "pointer"],
    result: "pointer",
  },
  atspi_accessible_get_accessible_id: {
    parameters: ["pointer", "pointer"],
    result: "pointer",
    optional: true,
  },
  atspi_accessible_get_process_id: {
    parameters: ["pointer", "pointer"],
    result: "i32",
  },
  atspi_accessible_get_application: {
    parameters: ["pointer", "pointer"],
    result: "pointer",
  },
  atspi_accessible_get_toolkit_name: {
    parameters: ["pointer", "pointer"],
    result: "pointer",
  },
  atspi_accessible_get_state_set: {
    parameters: ["pointer"],
    result: "pointer",
  },
  atspi_state_set_contains: {
    parameters: ["pointer", "u32"],
    result: "i32",
  },
  atspi_accessible_get_component_iface: {
    parameters: ["pointer"],
    result: "pointer",
  },
  atspi_component_get_extents: {
    parameters: ["pointer", "u32", "pointer"],
    result: "pointer",
  },
  atspi_component_grab_focus: {
    parameters: ["pointer", "pointer"],
    result: "i32",
  },
  atspi_component_scroll_to: {
    parameters: ["pointer", "u32", "pointer"],
    result: "i32",
  },
  atspi_accessible_get_action_iface: {
    parameters: ["pointer"],
    result: "pointer",
  },
  atspi_action_get_n_actions: {
    parameters: ["pointer", "pointer"],
    result: "i32",
  },
  atspi_action_get_action_name: {
    parameters: ["pointer", "i32", "pointer"],
    result: "pointer",
  },
  atspi_action_do_action: {
    parameters: ["pointer", "i32", "pointer"],
    result: "i32",
  },
  atspi_accessible_get_text_iface: {
    parameters: ["pointer"],
    result: "pointer",
  },
  atspi_text_get_character_count: {
    parameters: ["pointer", "pointer"],
    result: "i32",
  },
  atspi_text_get_text: {
    parameters: ["pointer", "i32", "i32", "pointer"],
    result: "pointer",
  },
  atspi_text_get_n_selections: {
    parameters: ["pointer", "pointer"],
    result: "i32",
  },
  atspi_text_get_selection: {
    parameters: ["pointer", "i32", "pointer"],
    result: "pointer",
  },
  atspi_text_add_selection: {
    parameters: ["pointer", "i32", "i32", "pointer"],
    result: "i32",
  },
  atspi_text_set_selection: {
    parameters: ["pointer", "i32", "i32", "i32", "pointer"],
    result: "i32",
  },
  atspi_text_get_caret_offset: {
    parameters: ["pointer", "pointer"],
    result: "i32",
  },
  atspi_accessible_get_editable_text_iface: {
    parameters: ["pointer"],
    result: "pointer",
  },
  atspi_editable_text_set_text_contents: {
    parameters: ["pointer", "buffer", "pointer"],
    result: "i32",
  },
  atspi_editable_text_delete_text: {
    parameters: ["pointer", "i32", "i32", "pointer"],
    result: "i32",
  },
  atspi_editable_text_insert_text: {
    parameters: ["pointer", "i32", "buffer", "i32", "pointer"],
    result: "i32",
  },
});

if (atspi) atspi.symbols.atspi_init();

function objectRelease(value) {
  if (value && gobject) gobject.symbols.g_object_unref(value);
}

function objectUse(value, fn) {
  if (!value) return null;
  try {
    return fn(value);
  } finally {
    objectRelease(value);
  }
}

function ownedText(value) {
  if (!value) return "";
  try {
    return new Deno.UnsafePointerView(value).getCString();
  } finally {
    glib?.symbols.g_free(value);
  }
}

function atspiText(fn, element) {
  return atspi && fn ? ownedText(fn(element, null)) : "";
}

function atspiState(element, state) {
  if (!atspi) return null;
  const states = atspi.symbols.atspi_accessible_get_state_set(element);
  return objectUse(
    states,
    (set) => !!atspi.symbols.atspi_state_set_contains(set, state),
  );
}

const ROLE_TYPES = {
  "push-button": "button",
  "check-box": "check-box",
  "radio-button": "radio-button",
  "combo-box": "combo-box",
  entry: "edit",
  "password-text": "edit",
  frame: "window",
  dialog: "window",
  "page-tab": "tab-item",
  "page-tab-list": "tab",
  "menu-item": "menu-item",
  "check-menu-item": "menu-item",
  "radio-menu-item": "menu-item",
  "scroll-bar": "scroll-bar",
  "progress-bar": "progress-bar",
};

function atspiType(role) {
  const normalized = String(role ?? "").trim().toLowerCase().replace(
    /[_\s]+/g,
    "-",
  );
  return (ROLE_TYPES[normalized] ?? normalized) || null;
}

function atspiRect(element) {
  if (!atspi) return null;
  const component = atspi.symbols.atspi_accessible_get_component_iface(element);
  return objectUse(component, (value) => {
    const rect = atspi.symbols.atspi_component_get_extents(value, 0, null);
    if (!rect) return null;
    try {
      const view = new DataView(
        new Deno.UnsafePointerView(rect).getArrayBuffer(16),
      );
      const result = {
        x: view.getInt32(0, true),
        y: view.getInt32(4, true),
        width: view.getInt32(8, true),
        height: view.getInt32(12, true),
      };
      return result.width >= 0 && result.height >= 0 ? result : null;
    } finally {
      glib?.symbols.g_free(rect);
    }
  });
}

function atspiFramework(element) {
  if (!atspi) return "";
  const application = atspi.symbols.atspi_accessible_get_application(
    element,
    null,
  );
  return objectUse(
    application,
    (app) => atspiText(atspi.symbols.atspi_accessible_get_toolkit_name, app),
  ) ?? "";
}

function canonicalAction(name) {
  const value = String(name ?? "").toLowerCase();
  if (/expand|show/.test(value)) return "expand";
  if (/collapse|hide/.test(value)) return "collapse";
  if (/toggle|check/.test(value)) return "toggle";
  if (/select/.test(value)) return "select";
  if (/click|press|activate|invoke/.test(value)) return "invoke";
  return null;
}

function atspiActions(element, focusable) {
  if (!atspi) return [];
  const actions = new Set();
  const action = atspi.symbols.atspi_accessible_get_action_iface(element);
  objectUse(action, (value) => {
    const count = atspi.symbols.atspi_action_get_n_actions(value, null);
    for (let i = 0; i < count; i++) {
      const name = ownedText(
        atspi.symbols.atspi_action_get_action_name(value, i, null),
      );
      const canonical = canonicalAction(name);
      if (canonical) actions.add(canonical);
    }
  });
  if (focusable) actions.add("focus");
  const editable = atspi.symbols.atspi_accessible_get_editable_text_iface(
    element,
  );
  if (editable) {
    actions.add("set");
    objectRelease(editable);
  }
  const component = atspi.symbols.atspi_accessible_get_component_iface(element);
  if (component) {
    actions.add("scroll");
    objectRelease(component);
  }
  return [...actions];
}

function atspiValue(element) {
  if (!atspi) return null;
  const text = atspi.symbols.atspi_accessible_get_text_iface(element);
  return objectUse(text, (value) => {
    const count = atspi.symbols.atspi_text_get_character_count(value, null);
    if (count < 0 || count > 4096) return null;
    return ownedText(atspi.symbols.atspi_text_get_text(value, 0, -1, null));
  });
}

function atspiRecord(element) {
  if (!atspi || !element) return null;
  const pid = atspi.symbols.atspi_accessible_get_process_id(element, null);
  const aid = atspiText(
    atspi.symbols.atspi_accessible_get_accessible_id,
    element,
  );
  const role = atspiText(atspi.symbols.atspi_accessible_get_role_name, element);
  const focus = atspiState(element, 12);
  const focusable = atspiState(element, 11);
  const enabled = atspiState(element, 8);
  const showing = atspiState(element, 25);
  const visible = atspiState(element, 30);
  return {
    uid: aid ? `atspi:${pid}:${aid}` : `atspi:${pid}:${pointerId(element)}`,
    wid: null,
    pid,
    aid,
    name: atspiText(atspi.symbols.atspi_accessible_get_name, element),
    type: atspiType(role),
    class: null,
    framework: atspiFramework(element),
    rect: atspiRect(element),
    value: atspiValue(element),
    enabled,
    focus,
    focusable,
    offscreen: showing == null || visible == null
      ? null
      : !(showing && visible),
    actions: atspiActions(element, focusable),
  };
}

function normalizeA11yFilter(filter) {
  return filter == null
    ? {}
    : typeof filter === "string"
    ? { name: filter }
    : filter;
}

function matchesA11y(record, filter) {
  filter = normalizeA11yFilter(filter);
  if (filter.up != null || filter.down != null) return false;
  const exact = (a, b) => anyFilter(b, (v) => a === String(v));
  const number = (a, b) => anyFilter(b, (v) => a === Number(v));
  const regex = (a, b) => anyFilter(b, (v) => regexMatch(a, v));
  const boolean = (a, b) => a === !!b;
  const fields = [
    ["uid", false, exact],
    ["wid", true, (a, b) => anyFilter(b, (v) => sameId(a, v))],
    ["pid", false, number],
    ["aid", false, regex],
    ["name", false, regex],
    ["type", false, (a, b) => anyFilter(b, (v) => a === atspiType(v))],
    ["class", false, regex],
    ["framework", false, regex],
    ["value", false, regex],
    ["enabled", false, boolean],
    ["focus", false, boolean],
    ["focusable", false, boolean],
    ["offscreen", false, boolean],
  ];
  for (const [key, byOwn, test] of fields) {
    if (
      (byOwn ? own(filter, key) : filter[key] != null) &&
      !test(record[key], filter[key])
    ) {
      return false;
    }
  }
  return true;
}

function walkAccessible(root, visitor) {
  if (!atspi || !root) return false;
  const count = atspi.symbols.atspi_accessible_get_child_count(root, null);
  for (let i = 0; i < count; i++) {
    const child = atspi.symbols.atspi_accessible_get_child_at_index(
      root,
      i,
      null,
    );
    if (!child) continue;
    try {
      if (visitor(child) || walkAccessible(child, visitor)) return true;
    } finally {
      objectRelease(child);
    }
  }
  return false;
}

function eachAccessible(visitor) {
  if (!atspi || !gobject) return;
  const desktops = Math.max(0, atspi.symbols.atspi_get_desktop_count());
  for (let i = 0; i < desktops; i++) {
    const desktop = atspi.symbols.atspi_get_desktop(i);
    if (!desktop) continue;
    try {
      if (walkAccessible(desktop, visitor)) return;
    } finally {
      objectRelease(desktop);
    }
  }
}

export function a11y_find({ a11y = {}, limit = 0 } = {}) {
  const max = findLimit(limit);
  if (max == null || !atspi) return [];
  const filter = normalizeA11yFilter(a11y);
  const found = [];
  eachAccessible((element) => {
    const record = atspiRecord(element);
    if (record && matchesA11y(record, filter)) found.push(record);
    return found.length >= max;
  });
  return found;
}

function a11yResolve(filter = {}) {
  if (!atspi || !gobject) return null;
  filter = normalizeA11yFilter(filter);
  let found = null;
  eachAccessible((element) => {
    const record = atspiRecord(element);
    if (!record || !matchesA11y(record, filter)) return false;
    found = gobject.symbols.g_object_ref(element);
    return true;
  });
  return found;
}

function performNativeAction(element, action) {
  const iface = atspi.symbols.atspi_accessible_get_action_iface(element);
  return objectUse(iface, (value) => {
    const count = atspi.symbols.atspi_action_get_n_actions(value, null);
    for (let i = 0; i < count; i++) {
      const name = ownedText(
        atspi.symbols.atspi_action_get_action_name(value, i, null),
      );
      if (canonicalAction(name) === action) {
        return !!atspi.symbols.atspi_action_do_action(value, i, null);
      }
    }
    return false;
  }) ?? false;
}

export function a11y_action({ a11y = {}, action, value } = {}) {
  action = String(action ?? "").toLowerCase();
  if (
    !atspi ||
    ![
      "invoke",
      "select",
      "toggle",
      "expand",
      "collapse",
      "focus",
      "set",
      "scroll",
    ].includes(action)
  ) {
    return null;
  }
  return objectUse(a11yResolve(a11y), (element) => {
    let ok = false;
    if (action === "focus" || action === "scroll") {
      const component = atspi.symbols.atspi_accessible_get_component_iface(
        element,
      );
      ok = objectUse(component, (target) =>
        action === "focus"
          ? !!atspi.symbols.atspi_component_grab_focus(target, null)
          : !!atspi.symbols.atspi_component_scroll_to(target, 6, null)) ??
        false;
    } else if (action === "set") {
      if (value == null) return null;
      const editable = atspi.symbols.atspi_accessible_get_editable_text_iface(
        element,
      );
      ok = objectUse(editable, (target) =>
        !!atspi.symbols.atspi_editable_text_set_text_contents(
          target,
          cString(String(value)),
          null,
        )) ?? false;
    } else {
      ok = performNativeAction(element, action);
    }
    return ok ? { action, ...atspiRecord(element) } : null;
  });
}

function textRange(text, selection) {
  let start;
  let end;
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
    ) {
      return null;
    }
    start = Math.min(start, text.length);
    end = Math.min(end, text.length);
  } else {
    return null;
  }
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  return { start: from, end: to, text: text.slice(from, to) };
}

function utf16ToCharacters(text, offset) {
  return [...text.slice(0, offset)].length;
}

function charactersToUtf16(text, offset) {
  return [...text].slice(0, Math.max(0, offset)).join("").length;
}

function focusedAccessible(window) {
  let filter = { focus: true };
  if (window != null) {
    const info = windowRecords(window)[0];
    if (!info) return null;
    filter = { ...filter, pid: info.pid };
  }
  return a11yResolve(filter);
}

function textSelection(textIface, text) {
  const count = atspi.symbols.atspi_text_get_n_selections(textIface, null);
  if (count > 0) {
    const range = atspi.symbols.atspi_text_get_selection(textIface, 0, null);
    if (range) {
      try {
        const view = new DataView(
          new Deno.UnsafePointerView(range).getArrayBuffer(8),
        );
        const startChars = view.getInt32(0, true);
        const endChars = view.getInt32(4, true);
        return {
          start: charactersToUtf16(text, startChars),
          end: charactersToUtf16(text, endChars),
          startChars,
          endChars,
        };
      } finally {
        glib?.symbols.g_free(range);
      }
    }
  }
  const caret = Math.max(
    0,
    atspi.symbols.atspi_text_get_caret_offset(textIface, null),
  );
  const offset = charactersToUtf16(text, caret);
  return { start: offset, end: offset, startChars: caret, endChars: caret };
}

export function input_sel(options = {}) {
  if (
    !options || typeof options !== "object" || Array.isArray(options) || !atspi
  ) {
    return null;
  }
  const read = own(options, "read");
  const write = own(options, "write");
  const select = own(options, "select");
  if (Number(read) + Number(write) + Number(select) !== 1) return null;
  return objectUse(focusedAccessible(options.window), (element) => {
    const textIface = atspi.symbols.atspi_accessible_get_text_iface(element);
    return objectUse(textIface, (textObject) => {
      const text = ownedText(
        atspi.symbols.atspi_text_get_text(textObject, 0, -1, null),
      );
      if (read) {
        if (options.read !== true) return null;
        const range = textSelection(textObject, text);
        return text.slice(range.start, range.end);
      }
      if (select) {
        const range = textRange(text, options.select);
        if (!range) return null;
        const start = utf16ToCharacters(text, range.start);
        const end = utf16ToCharacters(text, range.end);
        const count = atspi.symbols.atspi_text_get_n_selections(
          textObject,
          null,
        );
        const ok = count > 0
          ? atspi.symbols.atspi_text_set_selection(
            textObject,
            0,
            start,
            end,
            null,
          )
          : atspi.symbols.atspi_text_add_selection(
            textObject,
            start,
            end,
            null,
          );
        return ok ? range : null;
      }
      const editable = atspi.symbols.atspi_accessible_get_editable_text_iface(
        element,
      );
      return objectUse(editable, (edit) => {
        const selection = textSelection(textObject, text);
        if (selection.endChars > selection.startChars) {
          if (
            !atspi.symbols.atspi_editable_text_delete_text(
              edit,
              selection.startChars,
              selection.endChars,
              null,
            )
          ) return null;
        }
        const replacement = String(options.write ?? "");
        const bytes = textEncoder.encode(replacement);
        return atspi.symbols.atspi_editable_text_insert_text(
            edit,
            selection.startChars,
            cString(replacement),
            bytes.length,
            null,
          )
          ? { length: replacement.length }
          : null;
      });
    });
  });
}

function userPath(value) {
  return typeof value === "string" && /^user$/i.test(value.trim());
}

function userMousePath(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const length = distance || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const bend = (Math.random() - .5) * Math.min(140, distance * .35);
  const c1 = {
    x: from.x + dx * .3 + nx * bend,
    y: from.y + dy * .3 + ny * bend,
  };
  const c2 = {
    x: from.x + dx * .72 - nx * bend * .35,
    y: from.y + dy * .72 - ny * bend * .35,
  };
  return (t) => {
    if (t >= 1) return to;
    const u = 1 - t;
    const jitter = Math.min(2.5, distance / 120) * u;
    return {
      x: u * u * u * from.x + 3 * u * u * t * c1.x +
        3 * u * t * t * c2.x + t * t * t * to.x +
        (Math.random() - .5) * 2 * jitter,
      y: u * u * u * from.y + 3 * u * u * t * c1.y +
        3 * u * t * t * c2.y + t * t * t * to.y +
        (Math.random() - .5) * 2 * jitter,
    };
  };
}

function userMouseDuration(from, to) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.max(120, Math.min(900, 80 + Math.sqrt(distance) * 22)) *
    (.8 + Math.random() * .4);
}

function setCursor(point) {
  if (!xDisplay) return false;
  xlib.symbols.XWarpPointer(
    xDisplay,
    0n,
    xRoot,
    0,
    0,
    0,
    0,
    point.x,
    point.y,
  );
  xlib.symbols.XFlush(xDisplay);
  return true;
}

export async function mouse_move(options = {}) {
  const {
    pos,
    display,
    duration: durationSpec = 0,
    path,
    steps: requestedSteps,
    window,
  } = options;
  const info = window == null ? null : windowRecords(window)[0];
  if (window != null && !info) return null;
  const target = mouseTarget(info, display, pos);
  if (!target) return null;
  const { from, to } = target;
  const route = userPath(path) ? userMousePath(from, to) : null;
  const duration = userTime(durationSpec)
    ? userMouseDuration(from, to)
    : timeMs(durationSpec, 0, options);
  if (duration <= 0) return { pos: setCursor(to) ? to : from };
  const steps = requestedSteps ?? Math.max(2, Math.round(duration / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const point = route ? route(t) : {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
    setCursor({ x: Math.round(point.x), y: Math.round(point.y) });
    if (i < steps) await delay(duration / steps);
  }
  return { pos: to };
}

const heldMouse = new Map();
const heldKeys = new Set();
const mouseButtons = { left: 1, middle: 2, right: 3 };

function fakeButton(button, down) {
  if (!xDisplay || !xtst) return false;
  const ok = xtst.symbols.XTestFakeButtonEvent(
    xDisplay,
    button,
    down ? 1 : 0,
    0n,
  );
  xlib.symbols.XFlush(xDisplay);
  return !!ok;
}

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
  } = options;
  const actions = Object.entries({ click, down, up, wheel, hwheel }).filter((
    [, value],
  ) => value != null);
  if (actions.length !== 1 || window != null || !xtst) return null;
  const [action, value] = actions[0];
  const target = mouseTarget(null, display, pos);
  const point = target?.to;
  if (!point || (pos != null && !setCursor(point))) return null;
  if (action === "wheel" || action === "hwheel") {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount === 0) return null;
    const horizontal = action === "hwheel";
    const button = horizontal ? amount > 0 ? 7 : 6 : amount > 0 ? 4 : 5;
    for (let i = 0; i < Math.abs(Math.round(amount)); i++) {
      if (!fakeButton(button, true) || !fakeButton(button, false)) return null;
    }
    return { [action]: amount, pos: point };
  }
  const name = String(value).toLowerCase();
  const button = mouseButtons[name];
  if (!button) return null;
  const count = Number.isInteger(repeat) && repeat > 0 ? repeat : 1;
  if (action === "click") {
    for (let i = 0; i < count; i++) {
      if (!fakeButton(button, true) || !fakeButton(button, false)) return null;
      const pause = timeMs(interval, 0, options);
      if (pause && i + 1 < count) sleepSync(pause);
    }
  } else {
    const isDown = action === "down";
    if (!fakeButton(button, isDown)) return null;
    if (isDown) heldMouse.set(name, button);
    else heldMouse.delete(name);
  }
  return {
    [action]: name,
    ...(action === "click" && count !== 1 && { repeat: count }),
    pos: point,
  };
}

const KEY_SYMBOLS = {
  backspace: "BackSpace",
  back: "BackSpace",
  tab: "Tab",
  enter: "Return",
  return: "Return",
  escape: "Escape",
  esc: "Escape",
  space: "space",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  ins: "Insert",
  home: "Home",
  end: "End",
  pageup: "Page_Up",
  pgup: "Page_Up",
  pagedown: "Page_Down",
  pgdn: "Page_Down",
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
  shift: "Shift_L",
  lshift: "Shift_L",
  rshift: "Shift_R",
  ctrl: "Control_L",
  control: "Control_L",
  lctrl: "Control_L",
  rctrl: "Control_R",
  alt: "Alt_L",
  lalt: "Alt_L",
  ralt: "Alt_R",
  altgr: "ISO_Level3_Shift",
  win: "Super_L",
  lwin: "Super_L",
  rwin: "Super_R",
  meta: "Super_L",
  menu: "Menu",
  apps: "Menu",
  capslock: "Caps_Lock",
  numlock: "Num_Lock",
  scrolllock: "Scroll_Lock",
  printscreen: "Print",
};

function keySym(name) {
  if (!xlib || typeof name !== "string") return 0n;
  const lower = name.toLowerCase();
  const f = lower.match(/^f(\d{1,2})$/);
  const symbol = f && +f[1] >= 1 && +f[1] <= 35
    ? `F${+f[1]}`
    : KEY_SYMBOLS[lower] ?? (name.length === 1 ? name : name);
  let value = xlib.symbols.XStringToKeysym(cString(symbol));
  if (!value && [...name].length === 1) {
    value = 0x01000000n + BigInt(name.codePointAt(0));
  }
  return value;
}

function keyPlan(name) {
  if (!xDisplay || !xtst) return null;
  if (
    typeof name === "number" && Number.isInteger(name) && name > 0 && name < 256
  ) {
    return [name];
  }
  const sym = keySym(String(name));
  if (!sym) return null;
  const code = xlib.symbols.XKeysymToKeycode(xDisplay, sym);
  if (!code) return null;
  const base = xlib.symbols.XKeycodeToKeysym(xDisplay, code, 0);
  const shifted = xlib.symbols.XKeycodeToKeysym(xDisplay, code, 1);
  if (sym !== base && sym === shifted) {
    const shift = xlib.symbols.XKeysymToKeycode(xDisplay, keySym("shift"));
    return shift ? [shift, code] : [code];
  }
  return [code];
}

function fakeKey(code, down) {
  if (!xDisplay || !xtst) return false;
  const ok = xtst.symbols.XTestFakeKeyEvent(xDisplay, code, down ? 1 : 0, 0n);
  xlib.symbols.XFlush(xDisplay);
  return !!ok;
}

function keyNames(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function pressKeys(value) {
  const active = new Set();
  const sequence = [];
  const accepted = [];
  for (const name of keyNames(value)) {
    const keys = keyPlan(name);
    if (!keys) continue;
    let ok = true;
    for (const code of keys) {
      if (active.has(code)) continue;
      if (!fakeKey(code, true)) {
        ok = false;
        break;
      }
      active.add(code);
      sequence.push(code);
    }
    if (ok) accepted.push(name);
  }
  for (const code of sequence.reverse()) fakeKey(code, false);
  return accepted;
}

function keyState(name, down) {
  const keys = keyPlan(name);
  if (!keys || keys.length !== 1 || !fakeKey(keys[0], down)) return false;
  down ? heldKeys.add(keys[0]) : heldKeys.delete(keys[0]);
  return true;
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
  const units = [...String(text)];
  const hasDuration = duration != null;
  const human = hasDuration ? userTime(duration) : userTime(interval);
  const total = hasDuration && !human ? timeMs(duration, 0, action) : null;
  const fixed = total != null && units.length > 1
    ? total / (units.length - 1)
    : 0;
  let typed = 0;
  for (let i = 0; i < units.length; i++) {
    const char = units[i];
    const accepted = char === "\r" || char === "\n"
      ? pressKeys("enter").length > 0
      : pressKeys(char).length > 0;
    if (accepted) typed++;
    if (i + 1 < units.length) {
      const pause = human
        ? userKeyDelay(char)
        : hasDuration
        ? fixed
        : timeMs(interval, 0, action);
      if (pause > 0) await delay(pause);
    }
  }
  return typed;
}

export async function keyb(options = {}) {
  if (!xtst) return null;
  const { press, down, up, type, repeat = 1, interval = 0, duration } = options;
  const count = Number.isInteger(repeat) && repeat > 0 ? repeat : 1;
  const result = {};
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
  return { keys: new Set(heldKeys), mouse: new Set(heldMouse.keys()) };
}

export function releaseInput(keep = { keys: new Set(), mouse: new Set() }) {
  let released = 0;
  for (const code of [...heldKeys]) {
    if (!keep.keys.has(code)) {
      if (fakeKey(code, false)) released++;
      heldKeys.delete(code);
    }
  }
  for (const [name, button] of [...heldMouse]) {
    if (!keep.mouse.has(name)) {
      if (fakeButton(button, false)) released++;
      heldMouse.delete(name);
    }
  }
  return { released };
}

export function input_reset() {
  return releaseInput();
}

export function clipboard(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return null;
  }
  const read = own(options, "read");
  const write = own(options, "write");
  const clear = own(options, "clear");
  if (Number(read) + Number(write) + Number(clear) !== 1) return null;
  return null;
}

function captureArea(options = {}) {
  const info = options.window == null ? null : windowRecords(options.window)[0];
  if (options.window != null && !info) return null;
  if (options.rect) {
    const geometry = geometryContext(info, options.display);
    const base = info?.rect ?? geometry.D;
    const rect = base && resolveRect(options.rect, base, geometry);
    return rect && rect.width > 0 && rect.height > 0 ? rect : null;
  }
  if (info) return info.rect;
  if (options.all) {
    const displays = displayRecords();
    if (!displays.length) return null;
    const x = Math.min(...displays.map((display) => display.x));
    const y = Math.min(...displays.map((display) => display.y));
    const right = Math.max(
      ...displays.map((display) => display.x + display.width),
    );
    const bottom = Math.max(
      ...displays.map((display) => display.y + display.height),
    );
    return { x, y, width: right - x, height: bottom - y };
  }
  const display = resolveDisplay(options.display);
  return display && {
    x: display.x,
    y: display.y,
    width: display.width,
    height: display.height,
  };
}

function destroyXImage(image) {
  if (!image) return;
  const destroy = new Deno.UnsafePointerView(image).getPointer(96);
  if (!destroy) return;
  new Deno.UnsafeFnPointer(destroy, {
    parameters: ["pointer"],
    result: "i32",
  }).call(image);
}

function maskShift(mask) {
  let shift = 0;
  while (mask && !(mask & 1)) {
    mask >>>= 1;
    shift++;
  }
  return shift;
}

function maskChannel(pixel, mask) {
  mask >>>= 0;
  if (!mask) return 0;
  const shift = maskShift(mask);
  const valueMask = mask >>> shift;
  const value = (pixel & mask) >>> shift;
  return Math.round(value * 255 / valueMask);
}

function xImageBGRA(image, width, height) {
  const view = new Deno.UnsafePointerView(image);
  const dataPointer = view.getPointer(16);
  if (!dataPointer) return null;
  const header = new DataView(view.getArrayBuffer(88));
  const byteOrder = header.getInt32(24, true);
  const bytesPerLine = header.getInt32(44, true);
  const bitsPerPixel = header.getInt32(48, true);
  const redMask = Number(header.getBigUint64(56, true) & 0xffffffffn) >>> 0;
  const greenMask = Number(header.getBigUint64(64, true) & 0xffffffffn) >>> 0;
  const blueMask = Number(header.getBigUint64(72, true) & 0xffffffffn) >>> 0;
  if (bytesPerLine <= 0 || ![24, 32].includes(bitsPerPixel)) return null;
  const raw = new Uint8Array(
    new Deno.UnsafePointerView(dataPointer).getArrayBuffer(
      bytesPerLine * height,
    ),
  );
  const out = new Uint8Array(width * height * 4);
  const bytes = bitsPerPixel / 8;
  const little = byteOrder === 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = y * bytesPerLine + x * bytes;
      let pixel;
      if (bytes === 4) {
        pixel = little
          ? (raw[source] | raw[source + 1] << 8 | raw[source + 2] << 16 |
            raw[source + 3] << 24) >>> 0
          : (raw[source + 3] | raw[source + 2] << 8 | raw[source + 1] << 16 |
            raw[source] << 24) >>> 0;
      } else {
        pixel = little
          ? raw[source] | raw[source + 1] << 8 | raw[source + 2] << 16
          : raw[source + 2] | raw[source + 1] << 8 | raw[source] << 16;
      }
      const target = (y * width + x) * 4;
      out[target] = maskChannel(pixel, blueMask);
      out[target + 1] = maskChannel(pixel, greenMask);
      out[target + 2] = maskChannel(pixel, redMask);
      out[target + 3] = 255;
    }
  }
  return out;
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
  if (!xDisplay) return null;
  const rect = captureArea(options);
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const image = xlib.symbols.XGetImage(
    xDisplay,
    xRoot,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0xffffffffffffffffn,
    2,
  );
  if (!image) return null;
  try {
    let data = xImageBGRA(image, rect.width, rect.height);
    if (!data) return null;
    if (options.grayscale) data = grayscaleBGRA(data);
    return {
      rect,
      format: "bgra8",
      grayscale: !!options.grayscale,
      data,
    };
  } finally {
    destroyXImage(image);
  }
}

export function ocr() {
  return null;
}

export async function wait(options = 0) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    await delay(options);
    return true;
  }
  const kinds = ["window", "ocr", "image", "change"].filter((key) =>
    options[key] != null
  );
  if (kinds.length !== 1 || kinds[0] !== "window") return null;
  const until = performance.now() + timeMs(options.timeout, 10000, options);
  for (;;) {
    const value = window_get_prop({ window: options.window });
    if (options.not ? !value : value) return options.not ? true : value;
    const remaining = until - performance.now();
    if (remaining <= 0) return null;
    const interval = Math.max(1, timeMs(options.interval, 100, options));
    await delay(Math.min(interval, remaining));
  }
}

export function window_wait(
  { window = {}, timeout = 5000, interval = 50 } = {},
) {
  return wait({ window, timeout, interval });
}

export function system({ wake, awake } = {}) {
  if (
    (wake != null && awake != null) || (wake != null && wake !== true) ||
    (awake != null && typeof awake !== "boolean")
  ) return null;
  if (awake != null) return null;
  if (wake) {
    if (!xDisplay) return null;
    xlib.symbols.XResetScreenSaver(xDisplay);
    xlib.symbols.XFlush(xDisplay);
    return { locked: null, wake: true };
  }
  return { locked: null };
}
