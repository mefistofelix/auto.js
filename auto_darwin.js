if (Deno.build.os !== "darwin") {
  throw new Error("auto_darwin.js requires macOS");
}

const POINT = { struct: ["f64", "f64"] };
const RECT = { struct: ["f64", "f64", "f64", "f64"] };
const UTF8 = 0x08000100;
const CF_NUMBER_DOUBLE = 13n;
const CG_WINDOW_ONSCREEN = 1;
const CG_WINDOW_EXCLUDE_DESKTOP = 16;
const CG_IMAGE_NOMINAL = 16;
const CG_BITMAP_BGRA = 0x2002;
const CG_HID_EVENT_TAP = 0;
const CG_EVENT_MOUSE_MOVED = 5;
const CG_EVENT_SCROLL = 22;
const CG_SCROLL_DELTA_AXIS_1 = 11;
const CG_SCROLL_DELTA_AXIS_2 = 12;
const IOPM_ASSERTION_ON = 255;

const coreFoundation = Deno.dlopen(
  "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
  {
    CFRelease: { parameters: ["pointer"], result: "void" },
    CFRetain: { parameters: ["pointer"], result: "pointer" },
    CFHash: { parameters: ["pointer"], result: "usize" },
    CFGetTypeID: { parameters: ["pointer"], result: "usize" },
    CFStringCreateWithCString: {
      parameters: ["pointer", "buffer", "u32"],
      result: "pointer",
    },
    CFStringGetLength: { parameters: ["pointer"], result: "i64" },
    CFStringGetMaximumSizeForEncoding: {
      parameters: ["i64", "u32"],
      result: "i64",
    },
    CFStringGetCString: {
      parameters: ["pointer", "buffer", "i64", "u32"],
      result: "u8",
    },
    CFStringGetTypeID: { parameters: [], result: "usize" },
    CFArrayGetTypeID: { parameters: [], result: "usize" },
    CFArrayGetCount: { parameters: ["pointer"], result: "i64" },
    CFArrayGetValueAtIndex: {
      parameters: ["pointer", "i64"],
      result: "pointer",
    },
    CFDictionaryGetValue: {
      parameters: ["pointer", "pointer"],
      result: "pointer",
    },
    CFNumberGetTypeID: { parameters: [], result: "usize" },
    CFNumberGetValue: {
      parameters: ["pointer", "i64", "buffer"],
      result: "u8",
    },
    CFBooleanGetTypeID: { parameters: [], result: "usize" },
    CFBooleanGetValue: { parameters: ["pointer"], result: "u8" },
    kCFBooleanTrue: { type: "pointer" },
    kCFBooleanFalse: { type: "pointer" },
  },
);

const coreGraphics = Deno.dlopen(
  "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics",
  {
    CGGetActiveDisplayList: {
      parameters: ["u32", "pointer", "pointer"],
      result: "i32",
    },
    CGMainDisplayID: { parameters: [], result: "u32" },
    CGDisplayBounds: { parameters: ["u32"], result: RECT },
    CGDisplayPixelsWide: { parameters: ["u32"], result: "usize" },
    CGWindowListCopyWindowInfo: {
      parameters: ["u32", "u32"],
      result: "pointer",
    },
    CGRectMakeWithDictionaryRepresentation: {
      parameters: ["pointer", "buffer"],
      result: "u8",
    },
    CGEventCreate: { parameters: ["pointer"], result: "pointer" },
    CGEventGetLocation: { parameters: ["pointer"], result: POINT },
    CGEventCreateMouseEvent: {
      parameters: ["pointer", "u32", POINT, "u32"],
      result: "pointer",
    },
    CGEventCreateKeyboardEvent: {
      parameters: ["pointer", "u16", "u8"],
      result: "pointer",
    },
    CGEventKeyboardSetUnicodeString: {
      parameters: ["pointer", "usize", "buffer"],
      result: "void",
    },
    CGEventSetType: {
      parameters: ["pointer", "u32"],
      result: "void",
    },
    CGEventSetIntegerValueField: {
      parameters: ["pointer", "u32", "i64"],
      result: "void",
    },
    CGEventPost: { parameters: ["u32", "pointer"], result: "void" },
    CGWindowListCreateImage: {
      parameters: [RECT, "u32", "u32", "u32"],
      result: "pointer",
      optional: true,
    },
    CGImageGetWidth: { parameters: ["pointer"], result: "usize" },
    CGImageGetHeight: { parameters: ["pointer"], result: "usize" },
    CGImageRelease: { parameters: ["pointer"], result: "void" },
    CGColorSpaceCreateDeviceRGB: { parameters: [], result: "pointer" },
    CGColorSpaceRelease: { parameters: ["pointer"], result: "void" },
    CGBitmapContextCreate: {
      parameters: [
        "buffer",
        "usize",
        "usize",
        "usize",
        "usize",
        "pointer",
        "u32",
      ],
      result: "pointer",
    },
    CGContextDrawImage: {
      parameters: ["pointer", RECT, "pointer"],
      result: "void",
    },
    CGContextRelease: { parameters: ["pointer"], result: "void" },
    kCGWindowNumber: { type: "pointer" },
    kCGWindowLayer: { type: "pointer" },
    kCGWindowBounds: { type: "pointer" },
    kCGWindowOwnerPID: { type: "pointer" },
    kCGWindowOwnerName: { type: "pointer" },
    kCGWindowName: { type: "pointer" },
    kCGWindowIsOnscreen: { type: "pointer" },
  },
);

const applicationServices = Deno.dlopen(
  "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices",
  {
    AXIsProcessTrusted: { parameters: [], result: "u8" },
    AXUIElementCreateApplication: { parameters: ["i32"], result: "pointer" },
    AXUIElementCreateSystemWide: { parameters: [], result: "pointer" },
    AXUIElementCopyAttributeValue: {
      parameters: ["pointer", "pointer", "buffer"],
      result: "i32",
    },
    AXUIElementSetAttributeValue: {
      parameters: ["pointer", "pointer", "pointer"],
      result: "i32",
    },
    AXUIElementIsAttributeSettable: {
      parameters: ["pointer", "pointer", "buffer"],
      result: "i32",
    },
    AXUIElementCopyActionNames: {
      parameters: ["pointer", "buffer"],
      result: "i32",
    },
    AXUIElementPerformAction: {
      parameters: ["pointer", "pointer"],
      result: "i32",
    },
    AXUIElementGetPid: {
      parameters: ["pointer", "buffer"],
      result: "i32",
    },
    AXValueCreate: { parameters: ["u32", "pointer"], result: "pointer" },
    AXValueGetType: { parameters: ["pointer"], result: "u32" },
    AXValueGetValue: {
      parameters: ["pointer", "u32", "pointer"],
      result: "u8",
    },
    AXValueGetTypeID: { parameters: [], result: "usize" },
  },
);

const libproc = Deno.dlopen("/usr/lib/libproc.dylib", {
  proc_pidpath: {
    parameters: ["i32", "buffer", "u32"],
    result: "i32",
  },
});

const appKit = Deno.dlopen(
  "/System/Library/Frameworks/AppKit.framework/AppKit",
  { NSPasteboardTypeString: { type: "pointer" } },
);

const objc = Deno.dlopen("/usr/lib/libobjc.A.dylib", {
  objc_getClass: { parameters: ["buffer"], result: "pointer" },
  sel_registerName: { parameters: ["buffer"], result: "pointer" },
  msg0: {
    name: "objc_msgSend",
    parameters: ["pointer", "pointer"],
    result: "pointer",
  },
  msg0i: {
    name: "objc_msgSend",
    parameters: ["pointer", "pointer"],
    result: "i64",
  },
  msg1p: {
    name: "objc_msgSend",
    parameters: ["pointer", "pointer", "pointer"],
    result: "pointer",
  },
  msg2b: {
    name: "objc_msgSend",
    parameters: ["pointer", "pointer", "pointer", "pointer"],
    result: "u8",
  },
});

const iokit = Deno.dlopen(
  "/System/Library/Frameworks/IOKit.framework/IOKit",
  {
    IOPMAssertionCreateWithName: {
      parameters: ["pointer", "u32", "pointer", "buffer"],
      result: "i32",
    },
    IOPMAssertionDeclareUserActivity: {
      parameters: ["pointer", "u32", "buffer"],
      result: "i32",
    },
    IOPMAssertionRelease: { parameters: ["u32"], result: "i32" },
  },
);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function cString(text) {
  const bytes = textEncoder.encode(String(text));
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  return out;
}

function asPointer(value) {
  return value ? Deno.UnsafePointer.create(BigInt(value)) : null;
}

function cfRelease(value) {
  if (value) coreFoundation.symbols.CFRelease(value);
}

function cfUse(value, fn) {
  if (!value) return null;
  try {
    return fn(value);
  } finally {
    cfRelease(value);
  }
}

function cfString(text) {
  return coreFoundation.symbols.CFStringCreateWithCString(
    null,
    cString(text),
    UTF8,
  );
}

function withCFString(text, fn) {
  return cfUse(cfString(text), fn);
}

function cfText(value) {
  if (!value) return "";
  const length = coreFoundation.symbols.CFStringGetLength(value);
  const size = coreFoundation.symbols.CFStringGetMaximumSizeForEncoding(
    length,
    UTF8,
  ) + 1n;
  if (size <= 1n || size > 16_777_216n) return "";
  const out = new Uint8Array(Number(size));
  if (!coreFoundation.symbols.CFStringGetCString(value, out, size, UTF8)) {
    return "";
  }
  const end = out.indexOf(0);
  return textDecoder.decode(end < 0 ? out : out.subarray(0, end));
}

function cfNumber(value) {
  if (!value) return null;
  const out = new Float64Array(1);
  return coreFoundation.symbols.CFNumberGetValue(value, CF_NUMBER_DOUBLE, out)
    ? out[0]
    : null;
}

function cfPrimitive(value) {
  if (!value) return null;
  const type = coreFoundation.symbols.CFGetTypeID(value);
  if (type === coreFoundation.symbols.CFStringGetTypeID()) return cfText(value);
  if (type === coreFoundation.symbols.CFNumberGetTypeID()) {
    return cfNumber(value);
  }
  if (type === coreFoundation.symbols.CFBooleanGetTypeID()) {
    return !!coreFoundation.symbols.CFBooleanGetValue(value);
  }
  return null;
}

function cfArrayValues(array) {
  const found = [];
  if (!array) return found;
  const count = Number(coreFoundation.symbols.CFArrayGetCount(array));
  for (let i = 0; i < count; i++) {
    const value = coreFoundation.symbols.CFArrayGetValueAtIndex(
      array,
      BigInt(i),
    );
    if (value) found.push(value);
  }
  return found;
}

function structRect(value) {
  const numbers = new Float64Array(
    value.buffer,
    value.byteOffset,
    value.byteLength / 8,
  );
  return {
    x: numbers[0],
    y: numbers[1],
    width: numbers[2],
    height: numbers[3],
  };
}

function structPoint(value) {
  const numbers = new Float64Array(
    value.buffer,
    value.byteOffset,
    value.byteLength / 8,
  );
  return { x: numbers[0], y: numbers[1] };
}

function rectBuffer(rect) {
  return new Float64Array([rect.x, rect.y, rect.width, rect.height]);
}

function displayRecords() {
  const count = new Uint32Array(1);
  if (
    coreGraphics.symbols.CGGetActiveDisplayList(
        0,
        null,
        Deno.UnsafePointer.of(count),
      ) !== 0 || !count[0]
  ) return [];

  const ids = new Uint32Array(count[0]);
  if (
    coreGraphics.symbols.CGGetActiveDisplayList(
      ids.length,
      Deno.UnsafePointer.of(ids),
      Deno.UnsafePointer.of(count),
    ) !== 0
  ) return [];

  const main = coreGraphics.symbols.CGMainDisplayID();
  const found = [...ids.subarray(0, count[0])].map((id) => {
    const rect = structRect(coreGraphics.symbols.CGDisplayBounds(id));
    const pixels = Number(coreGraphics.symbols.CGDisplayPixelsWide(id));
    return {
      id,
      primary: id === main,
      scale: rect.width > 0 ? pixels / rect.width : 1,
      ...rect,
      work: null,
    };
  });
  found.sort((a, b) => Number(b.primary) - Number(a.primary));
  return found.map((display, index) => ({ index, ...display }));
}

export function display_find({ display } = {}) {
  const found = displayRecords().map((
    { index, primary, scale, width, height, work },
  ) => ({ index, primary, scale, width, height, work }));
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

function displayForRect(rect, displays = displayRecords()) {
  if (!rect) return null;
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  return displays.find((display) =>
    x >= display.x && x < display.x + display.width &&
    y >= display.y && y < display.y + display.height
  ) ?? null;
}

function dictionaryValue(dictionary, key) {
  return coreFoundation.symbols.CFDictionaryGetValue(dictionary, key);
}

function windowRect(dictionary) {
  const bounds = dictionaryValue(
    dictionary,
    coreGraphics.symbols.kCGWindowBounds,
  );
  if (!bounds) return null;
  const out = new Uint8Array(32);
  return coreGraphics.symbols.CGRectMakeWithDictionaryRepresentation(
      bounds,
      out,
    )
    ? structRect(out)
    : null;
}

function processPath(pid) {
  const out = new Uint8Array(4096);
  const length = libproc.symbols.proc_pidpath(pid, out, out.length);
  if (length <= 0) return "";
  const end = out.indexOf(0);
  return textDecoder.decode(end < 0 ? out : out.subarray(0, end));
}

function windowId(value) {
  return `0x${Number(value).toString(16)}`;
}

function cgWindowRecords() {
  const all = coreGraphics.symbols.CGWindowListCopyWindowInfo(
    CG_WINDOW_EXCLUDE_DESKTOP,
    0,
  );
  if (!all) return [];

  const onscreen = coreGraphics.symbols.CGWindowListCopyWindowInfo(
    CG_WINDOW_ONSCREEN | CG_WINDOW_EXCLUDE_DESKTOP,
    0,
  );
  const front = new Map();
  if (onscreen) {
    try {
      for (const dictionary of cfArrayValues(onscreen)) {
        const layer = cfNumber(dictionaryValue(
          dictionary,
          coreGraphics.symbols.kCGWindowLayer,
        ));
        if (layer !== 0) continue;
        const id = cfNumber(dictionaryValue(
          dictionary,
          coreGraphics.symbols.kCGWindowNumber,
        ));
        if (id != null && !front.has(id)) front.set(id, front.size);
      }
    } finally {
      cfRelease(onscreen);
    }
  }

  try {
    const displays = displayRecords();
    const records = [];
    for (const dictionary of cfArrayValues(all)) {
      const layer = cfNumber(dictionaryValue(
        dictionary,
        coreGraphics.symbols.kCGWindowLayer,
      ));
      if (layer !== 0) continue;
      const id = cfNumber(dictionaryValue(
        dictionary,
        coreGraphics.symbols.kCGWindowNumber,
      ));
      const pid = cfNumber(dictionaryValue(
        dictionary,
        coreGraphics.symbols.kCGWindowOwnerPID,
      ));
      const rect = windowRect(dictionary);
      if (
        id == null || pid == null || !rect || rect.width <= 0 ||
        rect.height <= 0
      ) {
        continue;
      }
      const titleValue = dictionaryValue(
        dictionary,
        coreGraphics.symbols.kCGWindowName,
      );
      const ownerValue = dictionaryValue(
        dictionary,
        coreGraphics.symbols.kCGWindowOwnerName,
      );
      const onscreenValue = dictionaryValue(
        dictionary,
        coreGraphics.symbols.kCGWindowIsOnscreen,
      );
      const zorder = front.get(id) ?? null;
      records.push({
        wid: windowId(id),
        wpid: null,
        woid: null,
        depth: 0,
        zorder,
        title: titleValue ? cfText(titleValue) : "",
        class: null,
        pid: Math.trunc(pid),
        bin: processPath(Math.trunc(pid)),
        display: displayForRect(rect, displays)?.index ?? null,
        rect,
        client: null,
        status: "normal",
        hidden: onscreenValue ? !cfPrimitive(onscreenValue) : zorder == null,
        foreground: zorder === 0,
        _owner: ownerValue ? cfText(ownerValue) : "",
      });
    }
    return records;
  } finally {
    cfRelease(all);
  }
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
    ? { wid: windowId(filter) }
    : filter;
}

function sameId(a, b) {
  return a == null || b == null
    ? a == null && b == null
    : String(a).toLowerCase() === String(b).toLowerCase();
}

function anyFilter(value, match) {
  const values = Array.isArray(value) ? value : [value];
  return values.length > 0 && values.some(match);
}

function regexFilter(value, patterns) {
  return value != null &&
    anyFilter(patterns, (pattern) => regexMatch(value, pattern));
}

const filterId = (a, b) => anyFilter(b, (value) => sameId(a, value));
const filterNum = (a, b) => anyFilter(b, (value) => a === Number(value));
const filterBool = (a, b) => a === !!b;
const filterExact = (a, b) =>
  valuePresent(a) && anyFilter(b, (value) => a === String(value));
const filterString = (a, b) =>
  valuePresent(a) && anyFilter(b, (value) => a === String(value).toLowerCase());

function valuePresent(value) {
  return value !== null && value !== undefined;
}

function matchesFields(record, filter, rules) {
  for (const [key, [byOwn, test]] of Object.entries(rules)) {
    if (
      (byOwn ? own(filter, key) : filter[key] != null) &&
      !test(record[key], filter[key])
    ) return false;
  }
  return true;
}

const WINDOW_FIELDS = {
  wid: [false, filterId],
  wpid: [true, filterId],
  woid: [true, filterId],
  depth: [
    false,
    (a, b) =>
      anyFilter(
        b,
        (value) => String(value).toLowerCase() === "all" || a === Number(value),
      ),
  ],
  zorder: [false, filterNum],
  pid: [false, filterNum],
  title: [false, regexFilter],
  bin: [false, regexFilter],
  class: [false, regexFilter],
  display: [false, filterNum],
  status: [false, filterString],
  hidden: [false, filterBool],
  foreground: [false, filterBool],
};

function publicWindow({ _owner, ...window }) {
  return window;
}

function windowRecords(filter = {}) {
  filter = normalizeWindowFilter(filter);
  const records = cgWindowRecords();
  for (const record of records) record.status = windowStatus(record);
  records.sort((a, b) => (a.zorder ?? Infinity) - (b.zorder ?? Infinity));
  return records.filter((window) =>
    matchesFields(window, filter, WINDOW_FIELDS) &&
    filter.up == null && filter.down == null
  );
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
  const found = windowRecords(window).map(publicWindow);
  return max === Infinity ? found : found.slice(0, max);
}

function axAttribute(element, name) {
  return withCFString(name, (attribute) => {
    const out = new BigUint64Array(1);
    return applicationServices.symbols.AXUIElementCopyAttributeValue(
            element,
            attribute,
            out,
          ) === 0 && out[0]
      ? asPointer(out[0])
      : null;
  });
}

function axPrimitive(element, name) {
  return cfUse(axAttribute(element, name), cfPrimitive);
}

function axString(element, name) {
  const value = axPrimitive(element, name);
  return typeof value === "string" ? value : "";
}

function axBool(element, name) {
  const value = axPrimitive(element, name);
  return typeof value === "boolean" ? value : null;
}

function axSettable(element, name) {
  return withCFString(name, (attribute) => {
    const out = new Uint8Array(1);
    return applicationServices.symbols.AXUIElementIsAttributeSettable(
          element,
          attribute,
          out,
        ) === 0 && !!out[0];
  });
}

function axSet(element, name, value) {
  if (!value) return false;
  return withCFString(
    name,
    (attribute) =>
      applicationServices.symbols.AXUIElementSetAttributeValue(
        element,
        attribute,
        value,
      ) === 0,
  );
}

function axSetBool(element, name, value) {
  return axSet(
    element,
    name,
    value
      ? coreFoundation.symbols.kCFBooleanTrue
      : coreFoundation.symbols.kCFBooleanFalse,
  );
}

function axSetString(element, name, value) {
  return withCFString(String(value), (text) => axSet(element, name, text));
}

function axPerform(element, action) {
  return withCFString(
    action,
    (name) =>
      applicationServices.symbols.AXUIElementPerformAction(element, name) === 0,
  );
}

function axValue(element, name, type, length) {
  return cfUse(axAttribute(element, name), (value) => {
    if (
      coreFoundation.symbols.CFGetTypeID(value) !==
        applicationServices.symbols.AXValueGetTypeID() ||
      applicationServices.symbols.AXValueGetType(value) !== type
    ) return null;
    const out = new Float64Array(length);
    return applicationServices.symbols.AXValueGetValue(
        value,
        type,
        Deno.UnsafePointer.of(out),
      )
      ? [...out]
      : null;
  });
}

function axRect(element) {
  const position = axValue(element, "AXPosition", 1, 2);
  const size = axValue(element, "AXSize", 2, 2);
  return position && size
    ? { x: position[0], y: position[1], width: size[0], height: size[1] }
    : null;
}

function axSetPoint(element, name, type, values) {
  const data = new Float64Array(values);
  return cfUse(
    applicationServices.symbols.AXValueCreate(
      type,
      Deno.UnsafePointer.of(data),
    ),
    (value) => axSet(element, name, value),
  ) ?? false;
}

function axPid(element) {
  const pid = new Int32Array(1);
  return applicationServices.symbols.AXUIElementGetPid(element, pid) === 0
    ? pid[0]
    : null;
}

function axRoleType(role) {
  const name = String(role ?? "").replace(/^AX/, "");
  const normalized = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  return ({
    checkbox: "check-box",
    radiobutton: "radio-button",
    textfield: "edit",
    textarea: "edit",
    statictext: "text",
    scrollarea: "pane",
    menuitem: "menu-item",
    menubar: "menu-bar",
    tabgroup: "tab",
  }[normalized.replace(/-/g, "")] ?? normalized) || null;
}

function axActionNames(element) {
  const out = new BigUint64Array(1);
  if (
    applicationServices.symbols.AXUIElementCopyActionNames(element, out) !==
      0 ||
    !out[0]
  ) return [];
  return cfUse(
    asPointer(out[0]),
    (array) => cfArrayValues(array).map(cfText).filter(Boolean),
  ) ?? [];
}

function axActions(element, role) {
  const native = new Set(axActionNames(element));
  const actions = [];
  if (native.has("AXPress")) {
    actions.push(role === "AXCheckBox" ? "toggle" : "invoke");
  }
  if (native.has("AXPick") || axSettable(element, "AXSelected")) {
    actions.push("select");
  }
  if (native.has("AXScrollToVisible")) actions.push("scroll");
  if (axSettable(element, "AXExpanded")) actions.push("expand", "collapse");
  if (axSettable(element, "AXValue")) actions.push("set");
  if (native.has("AXRaise") || axSettable(element, "AXFocused")) {
    actions.push("focus");
  }
  return [...new Set(actions)];
}

function axRecord(element) {
  const pid = axPid(element);
  const role = axString(element, "AXRole");
  const rect = axRect(element);
  const hash = coreFoundation.symbols.CFHash(element);
  return {
    uid: pid == null ? null : `${pid}:${hash.toString(16)}`,
    wid: null,
    pid,
    aid: axString(element, "AXIdentifier"),
    name: axString(element, "AXTitle") || axString(element, "AXDescription"),
    type: axRoleType(role),
    class: null,
    framework: "ax",
    value: axPrimitive(element, "AXValue"),
    enabled: axBool(element, "AXEnabled"),
    focus: axBool(element, "AXFocused"),
    focusable: axSettable(element, "AXFocused"),
    offscreen: null,
    rect,
    actions: axActions(element, role),
  };
}

function axChildren(element) {
  return axAttribute(element, "AXChildren");
}

function axParent(element) {
  return axAttribute(element, "AXParent");
}

function axWalk(root, direction, maxDepth, visitor) {
  if (direction === "up") {
    let current = axParent(root);
    for (let depth = 1; current && depth <= maxDepth; depth++) {
      let next = null;
      try {
        if (visitor(current, depth)) return true;
        if (depth < maxDepth) next = axParent(current);
      } finally {
        cfRelease(current);
      }
      current = next;
    }
    return false;
  }

  const down = (parent, depth) =>
    cfUse(axChildren(parent), (children) => {
      for (const child of cfArrayValues(children)) {
        if (visitor(child, depth)) return true;
        if (depth < maxDepth && down(child, depth + 1)) return true;
      }
      return false;
    }) ?? false;
  return maxDepth >= 1 && down(root, 1);
}

function relationSpec(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return null;
  if (own(spec, "window")) return null;
  const depth = spec.depth == null
    ? 1
    : String(spec.depth).toLowerCase() === "all"
    ? Infinity
    : Number(spec.depth);
  if (depth !== Infinity && (!Number.isInteger(depth) || depth < 1)) {
    return null;
  }
  const filter = own(spec, "a11y") ? spec.a11y ?? {} : { ...spec };
  delete filter.depth;
  return { depth, filter };
}

function normalizeA11yFilter(filter) {
  return filter == null
    ? {}
    : typeof filter === "string"
    ? { name: filter }
    : filter;
}

function normalizeA11yType(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
}

const A11Y_FIELDS = {
  uid: [false, filterExact],
  wid: [true, filterId],
  pid: [false, filterNum],
  aid: [false, regexFilter],
  name: [false, regexFilter],
  type: [
    false,
    (a, b) => anyFilter(b, (value) => a === normalizeA11yType(value)),
  ],
  class: [false, regexFilter],
  framework: [false, regexFilter],
  value: [false, regexFilter],
  enabled: [false, filterBool],
  focus: [false, filterBool],
  focusable: [false, filterBool],
  offscreen: [false, filterBool],
};

function matchesA11yRelation(element, direction, spec) {
  const relation = relationSpec(spec);
  if (!relation) return false;
  return axWalk(element, direction, relation.depth, (candidate) => {
    const record = axRecord(candidate);
    return matchesA11y(candidate, record, relation.filter);
  });
}

function matchesA11y(element, record, filter) {
  filter = normalizeA11yFilter(filter);
  return matchesFields(record, filter, A11Y_FIELDS) &&
    (filter.up == null || matchesA11yRelation(element, "up", filter.up)) &&
    (filter.down == null || matchesA11yRelation(element, "down", filter.down));
}

function a11yPids(filter) {
  if (filter.pid != null) {
    const values = Array.isArray(filter.pid) ? filter.pid : [filter.pid];
    return [...new Set(values.map(Number).filter(Number.isInteger))];
  }
  return [...new Set(cgWindowRecords().map((window) => window.pid))];
}

export function a11y_find({ a11y = {}, limit = 0 } = {}) {
  if (!applicationServices.symbols.AXIsProcessTrusted()) return [];
  const max = findLimit(limit);
  if (max == null) return [];
  const filter = normalizeA11yFilter(a11y);
  if (own(filter, "wid") && filter.wid != null) return [];
  const found = [];
  const seen = new Set();
  for (const pid of a11yPids(filter)) {
    const root = applicationServices.symbols.AXUIElementCreateApplication(pid);
    if (!root) continue;
    try {
      axWalk(root, "down", Infinity, (element) => {
        const record = axRecord(element);
        if (!matchesA11y(element, record, filter) || seen.has(record.uid)) {
          return false;
        }
        seen.add(record.uid);
        found.push(record);
        return found.length >= max;
      });
    } finally {
      cfRelease(root);
    }
    if (found.length >= max) break;
  }
  return found;
}

function axFind(root, filter) {
  let found = null;
  const rootRecord = axRecord(root);
  if (matchesA11y(root, rootRecord, filter)) {
    return coreFoundation.symbols.CFRetain(root);
  }
  axWalk(root, "down", Infinity, (element) => {
    const record = axRecord(element);
    if (!matchesA11y(element, record, filter)) return false;
    found = coreFoundation.symbols.CFRetain(element);
    return true;
  });
  return found;
}

function axResolve(filter = {}) {
  if (!applicationServices.symbols.AXIsProcessTrusted()) return null;
  filter = normalizeA11yFilter(filter);
  if (own(filter, "wid") && filter.wid != null) return null;
  for (const pid of a11yPids(filter)) {
    const root = applicationServices.symbols.AXUIElementCreateApplication(pid);
    if (!root) continue;
    try {
      const found = axFind(root, filter);
      if (found) return found;
    } finally {
      cfRelease(root);
    }
  }
  return null;
}

export function a11y_action({ a11y = {}, action, value } = {}) {
  action = String(action ?? "").toLowerCase();
  if (
    ![
      "focus",
      "invoke",
      "select",
      "toggle",
      "expand",
      "collapse",
      "set",
      "scroll",
    ]
      .includes(action) ||
    (action === "set" && value == null)
  ) return null;

  return cfUse(axResolve(a11y), (element) => {
    let ok = false;
    if (action === "focus") {
      ok = axSetBool(element, "AXFocused", true) ||
        axPerform(element, "AXRaise");
    } else if (action === "invoke" || action === "toggle") {
      ok = axPerform(element, "AXPress");
    } else if (action === "select") {
      ok = axSetBool(element, "AXSelected", true) ||
        axPerform(element, "AXPick");
    } else if (action === "expand" || action === "collapse") {
      ok = axSetBool(element, "AXExpanded", action === "expand");
    } else if (action === "set") {
      ok = axSetString(element, "AXValue", value);
    } else if (action === "scroll") {
      ok = axPerform(element, "AXScrollToVisible");
    }
    return ok ? { action, ...axRecord(element) } : null;
  });
}

function axWindowForRecord(record, fn) {
  if (!applicationServices.symbols.AXIsProcessTrusted()) return null;
  const app = applicationServices.symbols.AXUIElementCreateApplication(
    record.pid,
  );
  if (!app) return null;
  try {
    return cfUse(axAttribute(app, "AXWindows"), (windows) => {
      const candidates = cfArrayValues(windows);
      let fallback = null;
      for (const window of candidates) {
        const title = axString(window, "AXTitle");
        const rect = axRect(window);
        const sameTitle = !!record.title && title === record.title;
        const sameRect = rect &&
          Math.abs(rect.x - record.rect.x) <= 3 &&
          Math.abs(rect.y - record.rect.y) <= 3 &&
          Math.abs(rect.width - record.rect.width) <= 3 &&
          Math.abs(rect.height - record.rect.height) <= 3;
        if (sameTitle && sameRect) return fn(window);
        if (!fallback && (sameTitle || sameRect)) fallback = window;
      }
      return fallback ? fn(fallback) : null;
    });
  } finally {
    cfRelease(app);
  }
}

function windowStatus(record) {
  return axWindowForRecord(
    record,
    (window) => axBool(window, "AXMinimized") ? "minimized" : "normal",
  ) ?? record.status;
}

export function window_get({ window = {}, text = false } = {}) {
  const found = windowRecords(window)[0];
  if (!found) return null;
  found.status = windowStatus(found);
  const out = publicWindow(found);
  if (text) out.text = null;
  return out;
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
    WC: null,
    D: explicitDisplay ??
      (info?.display != null ? displays[info.display] : null) ??
      displays[0] ?? null,
    explicitDisplay,
  };
}

const GEOMETRY_VALUE = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(%?)(WC|W|D)?$/i;

function geometryValue(value, axis, current, context, size = false) {
  if (value == null) return Math.round(current);
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(
      size ? value : (context.explicitDisplay?.[axis] ?? 0) + value,
    );
  }
  const match = typeof value === "string" && value.match(GEOMETRY_VALUE);
  if (!match) return Math.round(current);
  const [, sign, amount, percent, suffix] = match;
  const number = Number(amount);
  if (percent) {
    const reference =
      context[(suffix || (context.W ? "W" : "D")).toUpperCase()];
    if (!reference) return Math.round(current);
    const delta = number / 100 *
      (axis === "x" ? reference.width : reference.height);
    return Math.round(
      sign
        ? current + (sign === "-" ? -delta : delta)
        : size
        ? delta
        : reference[axis] + delta,
    );
  }
  if (suffix && !sign) {
    const reference = context[suffix.toUpperCase()];
    return reference
      ? Math.round(size ? number : reference[axis] + number)
      : Math.round(current);
  }
  return sign && !suffix
    ? Math.round(current + (sign === "-" ? -number : number))
    : Math.round(current);
}

function resolvePos(pos, relative, context, fallback = relative) {
  const out = {};
  for (const axis of ["x", "y"]) {
    out[axis] = pos?.[axis] == null
      ? Math.round(fallback[axis])
      : geometryValue(pos[axis], axis, relative[axis], context);
  }
  return out;
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
  const rect = suffix ? context[suffix] : fallback;
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
  if (!info) return null;
  axWindowForRecord(info, (element) => {
    if (action === "focus") {
      axSetBool(element, "AXFocused", true);
      axPerform(element, "AXRaise");
    } else if (action === "minimize") {
      axSetBool(element, "AXMinimized", true);
    } else if (action === "restore") {
      axSetBool(element, "AXMinimized", false);
      axPerform(element, "AXRaise");
    } else if (action === "close") {
      cfUse(
        axAttribute(element, "AXCloseButton"),
        (button) => axPerform(button, "AXPress"),
      );
    } else if (action === "move" || action === "size") {
      const geometry = geometryContext(info, display);
      const next = positionRect(
        resolveRect(rect, info.rect, geometry),
        pos,
        geometry,
      );
      if (next.width > 0 && next.height > 0) {
        axSetPoint(element, "AXPosition", 1, [next.x, next.y]);
        axSetPoint(element, "AXSize", 2, [next.width, next.height]);
      }
    }
  });
  return window_get({ window: { wid: info.wid } });
}

export function window_set(
  { window = {}, title } = {},
) {
  const info = windowRecords(window)[0];
  if (!info) return null;
  if (title != null) {
    axWindowForRecord(info, (element) => {
      if (axSettable(element, "AXTitle")) {
        axSetString(element, "AXTitle", title);
      }
    });
  }
  return window_get({ window: { wid: info.wid } });
}

function cursorPoint() {
  const event = coreGraphics.symbols.CGEventCreate(null);
  return cfUse(
    event,
    (value) => structPoint(coreGraphics.symbols.CGEventGetLocation(value)),
  );
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
  if (child) return null;
  const point = mouseTarget(null, display, pos)?.to;
  if (!point) return null;
  return window_find({ limit: 0 }).find((window) =>
    !window.hidden && point.x >= window.rect.x &&
    point.x < window.rect.x + window.rect.width &&
    point.y >= window.rect.y && point.y < window.rect.y + window.rect.height
  ) ?? null;
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
      x: u ** 3 * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x +
        t ** 3 * to.x + (Math.random() - .5) * 2 * jitter,
      y: u ** 3 * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y +
        t ** 3 * to.y + (Math.random() - .5) * 2 * jitter,
    };
  };
}

function userMouseDuration(from, to) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.max(120, Math.min(900, 80 + Math.sqrt(distance) * 22)) *
    (.8 + Math.random() * .4);
}

const mouseButtons = {
  left: { button: 0, down: 1, up: 2, drag: 6 },
  right: { button: 1, down: 3, up: 4, drag: 7 },
  middle: { button: 2, down: 25, up: 26, drag: 27 },
};
const heldMouse = new Map();

function postMouse(type, button, point) {
  const event = coreGraphics.symbols.CGEventCreateMouseEvent(
    null,
    type,
    rectBuffer({ x: point.x, y: point.y, width: 0, height: 0 }).subarray(0, 2),
    button,
  );
  if (!event) return false;
  try {
    coreGraphics.symbols.CGEventPost(CG_HID_EVENT_TAP, event);
    return true;
  } finally {
    cfRelease(event);
  }
}

function postMouseMove(point) {
  const hold = heldMouse.values().next().value;
  const type = hold ? mouseButtons[hold.button].drag : CG_EVENT_MOUSE_MOVED;
  const button = hold ? mouseButtons[hold.button].button : 0;
  return postMouse(type, button, point);
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
  if (duration <= 0) return { pos: postMouseMove(to) ? to : from };

  const steps = requestedSteps ?? Math.max(2, Math.round(duration / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const point = route
      ? route(t)
      : { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    postMouseMove({ x: Math.round(point.x), y: Math.round(point.y) });
    if (i < steps) await delay(duration / steps);
  }
  return { pos: to };
}

function postScroll(vertical, horizontal) {
  const event = coreGraphics.symbols.CGEventCreate(null);
  if (!event) return false;
  try {
    coreGraphics.symbols.CGEventSetType(event, CG_EVENT_SCROLL);
    coreGraphics.symbols.CGEventSetIntegerValueField(
      event,
      CG_SCROLL_DELTA_AXIS_1,
      BigInt(Math.round(vertical)),
    );
    coreGraphics.symbols.CGEventSetIntegerValueField(
      event,
      CG_SCROLL_DELTA_AXIS_2,
      BigInt(Math.round(horizontal)),
    );
    coreGraphics.symbols.CGEventPost(CG_HID_EVENT_TAP, event);
    return true;
  } finally {
    cfRelease(event);
  }
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
  if (actions.length !== 1 || window != null) return null;
  const [action, value] = actions[0];
  const count = Number.isInteger(repeat) && repeat > 0 ? repeat : 1;
  const target = mouseTarget(null, display, pos);
  const point = target?.to;
  if (!point || (pos != null && !postMouseMove(point))) return null;

  if (action === "wheel" || action === "hwheel") {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return null;
    if (
      !postScroll(
        action === "wheel" ? amount : 0,
        action === "hwheel" ? amount : 0,
      )
    ) {
      return null;
    }
    return { [action]: amount, pos: point };
  }

  const button = String(value).toLowerCase();
  const spec = mouseButtons[button];
  if (!spec) return null;
  if (action === "click") {
    for (let i = 0; i < count; i++) {
      if (!postMouse(spec.down, spec.button, point)) return null;
      if (!postMouse(spec.up, spec.button, point)) return null;
      const pause = timeMs(interval, 0, options);
      if (pause && i + 1 < count) sleepSync(pause);
    }
  } else if (action === "down") {
    if (!postMouse(spec.down, spec.button, point)) return null;
    heldMouse.set(button, { button });
  } else {
    if (!postMouse(spec.up, spec.button, point)) return null;
    heldMouse.delete(button);
  }

  return {
    [action]: button,
    ...(action === "click" && count !== 1 && { repeat: count }),
    pos: point,
  };
}

const KEY_CODES = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  "1": 18,
  "2": 19,
  "3": 20,
  "4": 21,
  "6": 22,
  "5": 23,
  "=": 24,
  "9": 25,
  "7": 26,
  "-": 27,
  "8": 28,
  "0": 29,
  "]": 30,
  o: 31,
  u: 32,
  "[": 33,
  i: 34,
  p: 35,
  enter: 36,
  return: 36,
  l: 37,
  j: 38,
  "'": 39,
  k: 40,
  ";": 41,
  "\\": 42,
  ",": 43,
  "/": 44,
  n: 45,
  m: 46,
  ".": 47,
  tab: 48,
  space: 49,
  "`": 50,
  backspace: 51,
  back: 51,
  escape: 53,
  esc: 53,
  command: 55,
  cmd: 55,
  win: 55,
  shift: 56,
  capslock: 57,
  alt: 58,
  option: 58,
  ctrl: 59,
  control: 59,
  rshift: 60,
  ralt: 61,
  rctrl: 62,
  delete: 117,
  del: 117,
  home: 115,
  end: 119,
  pageup: 116,
  pgup: 116,
  pagedown: 121,
  pgdn: 121,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
};
const heldKeys = new Map();

function keyCode(name) {
  if (typeof name === "number") return name;
  return KEY_CODES[String(name).toLowerCase()] ?? null;
}

function postKeyCode(code, down) {
  const event = coreGraphics.symbols.CGEventCreateKeyboardEvent(
    null,
    code,
    down ? 1 : 0,
  );
  if (!event) return false;
  try {
    coreGraphics.symbols.CGEventPost(CG_HID_EVENT_TAP, event);
    return true;
  } finally {
    cfRelease(event);
  }
}

function postUnicode(text, down) {
  const units = Uint16Array.from(
    String(text),
    (character) => character.charCodeAt(0),
  );
  const event = coreGraphics.symbols.CGEventCreateKeyboardEvent(
    null,
    0,
    down ? 1 : 0,
  );
  if (!event) return false;
  try {
    coreGraphics.symbols.CGEventKeyboardSetUnicodeString(
      event,
      BigInt(units.length),
      units,
    );
    coreGraphics.symbols.CGEventPost(CG_HID_EVENT_TAP, event);
    return true;
  } finally {
    cfRelease(event);
  }
}

function pressUnicode(text) {
  return postUnicode(text, true) && postUnicode(text, false);
}

function keyState(name, down) {
  const code = keyCode(name);
  if (code == null || !postKeyCode(code, down)) return false;
  down ? heldKeys.set(code, name) : heldKeys.delete(code);
  return true;
}

function keyNames(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function pressKeys(value) {
  const requested = keyNames(value);
  const down = [];
  const accepted = [];
  for (const name of requested) {
    const code = keyCode(name);
    if (code == null) {
      if (
        typeof name === "string" && [...name].length === 1 && pressUnicode(name)
      ) {
        accepted.push(name);
      }
      continue;
    }
    if (!postKeyCode(code, true)) continue;
    down.push(code);
    accepted.push(name);
  }
  for (const code of down.reverse()) postKeyCode(code, false);
  return accepted;
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
  const units = [...text.replace(/\r\n?/g, "\n")];
  const hasDuration = duration != null;
  const human = hasDuration ? userTime(duration) : userTime(interval);
  const total = hasDuration && !human ? timeMs(duration, 0, action) : null;
  const fixed = total != null && units.length > 1
    ? total / (units.length - 1)
    : 0;
  let typed = 0;
  for (let i = 0; i < units.length; i++) {
    const char = units[i];
    const ok = char === "\n"
      ? pressKeys("enter").length > 0
      : pressUnicode(char);
    if (ok) typed += char.length;
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
  return { keys: new Set(heldKeys.keys()), mouse: new Set(heldMouse.keys()) };
}

export function releaseInput(keep = { keys: new Set(), mouse: new Set() }) {
  let released = 0;
  for (const code of [...heldKeys.keys()]) {
    if (keep.keys.has(code)) continue;
    if (postKeyCode(code, false)) released++;
    heldKeys.delete(code);
  }
  const point = cursorPoint() ?? { x: 0, y: 0 };
  for (const [button, hold] of [...heldMouse]) {
    if (keep.mouse.has(button)) continue;
    const spec = mouseButtons[hold.button];
    if (postMouse(spec.up, spec.button, point)) released++;
    heldMouse.delete(button);
  }
  return { released };
}

export function input_reset() {
  return releaseInput();
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

function focusedElement(window) {
  if (!applicationServices.symbols.AXIsProcessTrusted()) return null;
  let root;
  if (window == null) {
    root = applicationServices.symbols.AXUIElementCreateSystemWide();
  } else {
    const info = windowRecords(window)[0];
    if (!info) return null;
    root = applicationServices.symbols.AXUIElementCreateApplication(info.pid);
  }
  if (!root) return null;
  try {
    return axAttribute(root, "AXFocusedUIElement");
  } finally {
    cfRelease(root);
  }
}

export function input_sel(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return null;
  }
  const read = own(options, "read");
  const write = own(options, "write");
  const select = own(options, "select");
  if (Number(read) + Number(write) + Number(select) !== 1) return null;

  return cfUse(focusedElement(options.window), (element) => {
    if (write) {
      const text = String(options.write ?? "");
      return axSetString(element, "AXSelectedText", text)
        ? { length: text.length }
        : null;
    }
    if (read) {
      if (options.read !== true) return null;
      const text = axPrimitive(element, "AXSelectedText");
      return typeof text === "string" ? text : null;
    }

    const text = axPrimitive(element, "AXValue");
    if (typeof text !== "string") return null;
    const range = textRange(text, options.select);
    if (!range) return null;
    const data = new BigInt64Array([
      BigInt(range.start),
      BigInt(range.end - range.start),
    ]);
    const value = applicationServices.symbols.AXValueCreate(
      4,
      Deno.UnsafePointer.of(data),
    );
    return cfUse(
      value,
      (selection) =>
        axSet(element, "AXSelectedTextRange", selection) ? range : null,
    );
  });
}

function objcClass(name) {
  return objc.symbols.objc_getClass(cString(name));
}

function objcSelector(name) {
  return objc.symbols.sel_registerName(cString(name));
}

function pasteboard() {
  const type = appKit.symbols.NSPasteboardTypeString;
  const boardClass = objcClass("NSPasteboard");
  const board = boardClass
    ? objc.symbols.msg0(boardClass, objcSelector("generalPasteboard"))
    : null;
  return board && type ? { board, type } : null;
}

function clipboardRead() {
  const pb = pasteboard();
  if (!pb) return "";
  const value = objc.symbols.msg1p(
    pb.board,
    objcSelector("stringForType:"),
    pb.type,
  );
  return value ? cfText(value) : "";
}

function clipboardWrite(text) {
  const pb = pasteboard();
  if (!pb) return null;
  text = String(text ?? "");
  objc.symbols.msg0i(pb.board, objcSelector("clearContents"));
  return withCFString(text, (value) =>
    objc.symbols.msg2b(
        pb.board,
        objcSelector("setString:forType:"),
        value,
        pb.type,
      )
      ? { length: text.length }
      : null);
}

function clipboardClear() {
  const pb = pasteboard();
  if (!pb) return null;
  objc.symbols.msg0i(pb.board, objcSelector("clearContents"));
  return true;
}

export function clipboard(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return null;
  }
  const read = own(options, "read");
  const write = own(options, "write");
  const clear = own(options, "clear");
  if (Number(read) + Number(write) + Number(clear) !== 1) return null;
  if (read) return options.read === true ? clipboardRead() : null;
  if (clear) return options.clear === true ? clipboardClear() : null;
  return clipboardWrite(options.write);
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
  const capture = coreGraphics.symbols.CGWindowListCreateImage;
  if (!capture) return null;
  const rect = captureArea(options);
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const image = capture(
    rectBuffer(rect),
    CG_WINDOW_ONSCREEN,
    0,
    CG_IMAGE_NOMINAL,
  );
  if (!image) return null;
  try {
    const width = Number(coreGraphics.symbols.CGImageGetWidth(image));
    const height = Number(coreGraphics.symbols.CGImageGetHeight(image));
    if (!width || !height) return null;
    const data = new Uint8Array(width * height * 4);
    const colorSpace = coreGraphics.symbols.CGColorSpaceCreateDeviceRGB();
    if (!colorSpace) throw new Error("CGColorSpaceCreateDeviceRGB failed");
    try {
      const context = coreGraphics.symbols.CGBitmapContextCreate(
        data,
        BigInt(width),
        BigInt(height),
        8n,
        BigInt(width * 4),
        colorSpace,
        CG_BITMAP_BGRA,
      );
      if (!context) throw new Error("CGBitmapContextCreate failed");
      try {
        coreGraphics.symbols.CGContextDrawImage(
          context,
          rectBuffer({ x: 0, y: 0, width, height }),
          image,
        );
      } finally {
        coreGraphics.symbols.CGContextRelease(context);
      }
    } finally {
      coreGraphics.symbols.CGColorSpaceRelease(colorSpace);
    }
    return {
      rect: { x: rect.x, y: rect.y, width, height },
      format: "bgra8",
      grayscale: !!options.grayscale,
      data: options.grayscale ? grayscaleBGRA(data) : data,
    };
  } finally {
    coreGraphics.symbols.CGImageRelease(image);
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
    const value = window_get({ window: options.window });
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

let awakeAssertion = 0;

export function system({ wake, awake } = {}) {
  if (
    (wake != null && awake != null) || (wake != null && wake !== true) ||
    (awake != null && typeof awake !== "boolean")
  ) return null;

  if (wake) {
    const assertion = new Uint32Array(1);
    const ok = withCFString(
      "auto.js user activity",
      (name) =>
        iokit.symbols.IOPMAssertionDeclareUserActivity(name, 0, assertion) ===
          0,
    );
    if (!ok) return null;
    if (assertion[0]) iokit.symbols.IOPMAssertionRelease(assertion[0]);
  }

  if (awake === true && !awakeAssertion) {
    const assertion = new Uint32Array(1);
    const ok = withCFString(
      "PreventUserIdleDisplaySleep",
      (type) =>
        withCFString(
          "auto.js awake",
          (name) =>
            iokit.symbols.IOPMAssertionCreateWithName(
              type,
              IOPM_ASSERTION_ON,
              name,
              assertion,
            ) === 0,
        ),
    );
    if (!ok) return null;
    awakeAssertion = assertion[0];
  } else if (awake === false && awakeAssertion) {
    if (iokit.symbols.IOPMAssertionRelease(awakeAssertion) !== 0) return null;
    awakeAssertion = 0;
  }

  return {
    locked: null,
    ...(wake ? { wake: true } : {}),
    ...(awake != null ? { awake } : {}),
  };
}
