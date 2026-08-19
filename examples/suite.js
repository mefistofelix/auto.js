const FIXTURE_CLASS = "AAF.TestFixture";
const OCR_TEXT = "AAF OCR TEST 48291";
const BUTTON_TEXT = "CLICK";
const EDIT_INITIAL = "EDIT READY";
const STATUS_PREFIX = "CLICKS";

function wide(text) {
  const out = new Uint16Array(text.length + 1);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

function fixture(token) {
  const user32 = Deno.dlopen("user32.dll", {
    RegisterClassExW: { parameters: ["buffer"], result: "u16" },
    CreateWindowExW: {
      parameters: ["u32", "buffer", "buffer", "u32", "i32", "i32", "i32", "i32", "pointer", "pointer", "pointer", "pointer"],
      result: "pointer",
    },
    DefWindowProcW: { parameters: ["pointer", "u32", "usize", "isize"], result: "isize" },
    ShowWindow: { parameters: ["pointer", "i32"], result: "i32" },
    UpdateWindow: { parameters: ["pointer"], result: "i32" },
    SetWindowTextW: { parameters: ["pointer", "buffer"], result: "i32" },
    SetForegroundWindow: { parameters: ["pointer"], result: "i32" },
    SetFocus: { parameters: ["pointer"], result: "pointer" },
    SendMessageW: { parameters: ["pointer", "u32", "usize", "isize"], result: "isize" },
    GetMessageW: { parameters: ["buffer", "pointer", "u32", "u32"], result: "i32" },
    TranslateMessage: { parameters: ["buffer"], result: "i32" },
    DispatchMessageW: { parameters: ["buffer"], result: "isize" },
    PostQuitMessage: { parameters: ["i32"], result: "void" },
    SetProcessDPIAware: { parameters: [], result: "i32" },
  });
  const kernel32 = Deno.dlopen("kernel32.dll", {
    GetModuleHandleW: { parameters: ["pointer"], result: "pointer" },
  });

  try { user32.symbols.SetProcessDPIAware(); } catch { /* already configured is fine */ }

  const WM_DESTROY = 0x0002;
  const WM_COMMAND = 0x0111;
  const WS_CHILD = 0x40000000;
  const WS_VISIBLE = 0x10000000;
  const WS_BORDER = 0x00800000;
  const WS_TABSTOP = 0x00010000;
  const WS_OVERLAPPEDWINDOW = 0x00cf0000;
  const ES_AUTOHSCROLL = 0x0080;
  const BUTTON_ID = 1001;
  const instance = kernel32.symbols.GetModuleHandleW(null);
  let clicks = 0;
  let edit = null;
  let status = null;

  const wndProc = new Deno.UnsafeCallback(
    { parameters: ["pointer", "u32", "usize", "isize"], result: "isize" },
    (hwnd, message, wParam, lParam) => {
      if (message === WM_COMMAND) {
        const id = Number(BigInt(wParam) & 0xffffn);
        if (id === BUTTON_ID && status) {
          clicks++;
          user32.symbols.SetForegroundWindow(hwnd);
          if (edit) user32.symbols.SetFocus(edit);
          user32.symbols.SetWindowTextW(status, wide(`${STATUS_PREFIX} ${clicks}`));
          return 0n;
        }
      }
      if (message === WM_DESTROY) {
        user32.symbols.PostQuitMessage(0);
        return 0n;
      }
      return user32.symbols.DefWindowProcW(hwnd, message, wParam, lParam);
    },
  );

  const wc = new Uint8Array(80);
  const view = new DataView(wc.buffer);
  view.setUint32(0, 80, true);
  view.setBigUint64(8, Deno.UnsafePointer.value(wndProc.pointer), true);
  view.setBigUint64(24, Deno.UnsafePointer.value(instance), true);
  const className = wide(FIXTURE_CLASS);
  view.setBigUint64(64, Deno.UnsafePointer.value(Deno.UnsafePointer.of(className)), true);
  if (!user32.symbols.RegisterClassExW(wc)) throw new Error("fixture RegisterClassExW failed");

  const create = (className, title, style, x, y, width, height, parent, id = 0) => {
    const hwnd = user32.symbols.CreateWindowExW(
      0,
      wide(className),
      wide(title),
      style >>> 0,
      x,
      y,
      width,
      height,
      parent,
      id ? Deno.UnsafePointer.create(BigInt(id)) : null,
      instance,
      null,
    );
    if (!hwnd) throw new Error(`fixture CreateWindowExW(${className}) failed`);
    return hwnd;
  };

  const root = create(
    FIXTURE_CLASS,
    `AAF TEST FIXTURE ${token}`,
    WS_OVERLAPPEDWINDOW | WS_VISIBLE,
    140,
    120,
    760,
    520,
    null,
  );
  create("STATIC", OCR_TEXT, WS_CHILD | WS_VISIBLE, 28, 28, 360, 36, root);
  edit = create("EDIT", EDIT_INITIAL, WS_CHILD | WS_VISIBLE | WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL, 28, 86, 410, 34, root, 1002);
  user32.symbols.SendMessageW(edit, 0xb1, 0n, 4n);
  create("BUTTON", BUTTON_TEXT, WS_CHILD | WS_VISIBLE | WS_TABSTOP, 462, 86, 150, 34, root, BUTTON_ID);
  status = create("STATIC", `${STATUS_PREFIX} 0`, WS_CHILD | WS_VISIBLE, 28, 148, 280, 36, root);
  const panel = create("STATIC", "PANEL", WS_CHILD | WS_VISIBLE | WS_BORDER, 28, 210, 330, 105, root);
  create("STATIC", "NESTED CHILD", WS_CHILD | WS_VISIBLE, 12, 18, 220, 28, panel);
  create("STATIC", "IMAGE MARKER 7391", WS_CHILD | WS_VISIBLE, 390, 210, 220, 46, root);

  user32.symbols.ShowWindow(root, 5);
  user32.symbols.UpdateWindow(root);

  const msg = new Uint8Array(48);
  try {
    while (user32.symbols.GetMessageW(msg, null, 0, 0) > 0) {
      user32.symbols.TranslateMessage(msg);
      user32.symbols.DispatchMessageW(msg);
    }
  } finally {
    wndProc.close();
    user32.close();
    kernel32.close();
  }
}

if (Deno.args[0] === "--fixture") {
  fixture(Deno.args[1] ?? "fixture");
  Deno.exit(0);
}

const {
  display_find,
  window_find,
  a11y_find,
  a11y_action,
  window_get,
  window_wait,
  window_control,
  window_set,
  window_hit,
  mouse_move,
  mouse_button,
  keyb,
  input_sel,
  input_reset,
  clipboard,
  ocr,
  wait,
  run,
  system,
} = await import("../auto.js");

function assert(value, message) {
  if (!value) throw new Error(message);
}

function same(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function escaped(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function check(name, value = "ok") {
  console.log(`✓ ${name}`, value);
}

async function eventually(test, message, timeout = 1000) {
  const until = performance.now() + timeout;
  do {
    if (test()) return;
    await wait(20);
  } while (performance.now() < until);
  throw new Error(message);
}

async function findFixture(pid) {
  const until = performance.now() + 5000;
  while (performance.now() < until) {
    const found = window_find({
      window: { pid, class: `^${escaped(FIXTURE_CLASS)}$`, depth: 0 },
      limit: 1,
    })[0];
    if (found) return found;
    await wait(25);
  }
  return null;
}

const token = crypto.randomUUID().slice(0, 8);
const child = new Deno.Command(Deno.execPath(), {
  args: ["run", "-A", import.meta.filename, "--fixture", token],
  stdin: "null",
  stdout: "null",
  stderr: "inherit",
}).spawn();
const temp = await Deno.makeTempDir({ prefix: "aaf-suite-" });
const originalClipboard = clipboard({ read: true });
const originalCursor = (await mouse_move({})).pos;
let root = null;
let awake = false;

try {
  const session = system();
  assert(typeof session.locked === "boolean", "system lock-state detection failed");
  same((await run([{ system: {} }])).results[0]?.locked, session.locked, "scenario system query failed");
  same(system({ wake: true })?.wake, true, "system wake failed");
  same(system({ awake: true })?.awake, true, "system awake:true failed");
  awake = true;
  check("system lock detection, wake, awake", session);

  root = await findFixture(child.pid);
  assert(root, "fixture window did not appear");
  same(root.woid, null, "fixture should have no owner");
  check("self-contained fixture", { pid: child.pid, wid: root.wid });

  const displays = display_find();
  assert(displays.length >= 1 && displays[0].primary, "primary display missing");
  assert(Number.isFinite(displays[0].scale) && displays[0].scale > 0, "display scale missing");
  same(display_find({ display: { index: 0 } }).length, 1, "display target failed");
  check("display_find + scale");

  const allFixtureWindows = window_find({ window: { pid: child.pid, depth: "all" }, limit: 0 });
  assert(allFixtureWindows.length >= 7, "fixture native child tree incomplete");
  same(window_find({ window: { pid: child.pid, depth: "all" }, limit: 1 }).length, 1, "window limit:1 failed");
  same(window_find({ window: { pid: child.pid, depth: "all" }, limit: 0 }).length, allFixtureWindows.length, "window limit:0 must be unlimited");
  const titleOr = window_find({ window: { title: ["^DOES NOT EXIST$", `^${escaped(root.title)}$`], pid: child.pid }, limit: 1 });
  same(titleOr[0]?.wid, root.wid, "window OR filter failed");

  const buttonWindow = window_find({ window: { pid: child.pid, wpid: root.wid, class: "^Button$" }, limit: 1 })[0];
  const editWindow = window_find({ window: { pid: child.pid, wpid: root.wid, class: "^Edit$" }, limit: 1 })[0];
  const statusWindow = window_find({ window: { pid: child.pid, wpid: root.wid, title: `^${STATUS_PREFIX} 0$` }, limit: 1 })[0];
  const nestedWindow = window_find({ window: { pid: child.pid, title: "^NESTED CHILD$", depth: "all" }, limit: 1 })[0];
  assert(buttonWindow && editWindow && statusWindow && nestedWindow, "fixture child windows not found");
  assert(root.client?.width > 0 && root.client?.height > 0, "window client rect missing");
  assert(Number.isInteger(root.zorder) && root.zorder >= 0, "window zorder missing");
  same(window_find({ window: { wid: root.wid, zorder: root.zorder }, limit: 1 })[0]?.wid, root.wid, "window zorder filter failed");
  same(window_get({ window: { wid: editWindow.wid }, text: true })?.text, EDIT_INITIAL, "window_get edit text failed");
  same(window_get({ window: { wid: statusWindow.wid }, text: true })?.text, `${STATUS_PREFIX} 0`, "window_get label text failed");
  same((await run([{ window_get: { window: { wid: editWindow.wid }, text: true } }])).results[0]?.text, EDIT_INITIAL, "scenario window_get text failed");
  same(input_sel({ window: { wid: editWindow.wid }, read: true }), "EDIT", "input_sel read failed");
  same((await run([{ input_sel: { window: { wid: editWindow.wid }, read: true } }])).results[0], "EDIT", "scenario input_sel read failed");
  assert(nestedWindow.depth >= 2, "nested native depth was not preserved");
  same(
    window_find({ window: { wid: root.wid, down: { class: "^Button$", depth: "all" } }, limit: 1 })[0]?.wid,
    root.wid,
    "window down relation failed",
  );
  same(
    window_find({ window: { wid: nestedWindow.wid, up: { wid: root.wid, depth: "all" } }, limit: 1 })[0]?.wid,
    nestedWindow.wid,
    "window up relation failed",
  );
  check("window filters, arrays, tree relations, limit");

  const a11yAll = a11y_find({ a11y: { pid: child.pid }, limit: 0 });
  assert(a11yAll.length >= 5, "fixture accessibility tree incomplete");
  same(a11y_find({ a11y: { pid: child.pid }, limit: 1 }).length, 1, "a11y limit:1 failed");
  same(a11y_find({ a11y: { pid: child.pid }, limit: 0 }).length, a11yAll.length, "a11y limit:0 must be unlimited");
  const a11yButton = a11y_find({
    a11y: {
      pid: child.pid,
      type: "button",
      name: `^${BUTTON_TEXT}$`,
      up: { depth: "all", window: { wid: root.wid } },
    },
    limit: 1,
  })[0];
  assert(a11yButton, "accessible button not found through a11y -> window bridge");
  assert(a11yButton.actions?.includes("invoke"), "accessible button invoke capability missing");
  const a11yEdit = a11y_find({ a11y: { wid: editWindow.wid }, limit: 1 })[0];
  assert(a11yEdit?.actions?.includes("set"), "accessible edit set capability missing");
  const a11ySetText = `A11Y SET ${token}`;
  same(a11y_action({ a11y: { wid: editWindow.wid }, action: "set", value: a11ySetText })?.action, "set", "a11y set action failed");
  await eventually(() => window_get({ window: { wid: editWindow.wid }, text: true })?.text === a11ySetText, "a11y set did not update edit text");
  a11y_action({ a11y: { wid: editWindow.wid }, action: "set", value: EDIT_INITIAL });
  await eventually(() => window_get({ window: { wid: editWindow.wid }, text: true })?.text === EDIT_INITIAL, "a11y set did not restore edit text");
  same((await run([{ a11y_action: { a11y: { wid: editWindow.wid }, action: "set", value: EDIT_INITIAL } }])).results[0]?.action, "set", "scenario a11y_action failed");
  same(
    window_find({
      window: {
        wid: root.wid,
        down: { depth: "all", a11y: { type: "button", name: `^${BUTTON_TEXT}$` } },
      },
      limit: 1,
    })[0]?.wid,
    root.wid,
    "window -> a11y bridge failed",
  );
  check("a11y filters, capabilities, actions, limit, cross-domain relations");

  same(input_sel({ window: { wid: editWindow.wid }, write: "Z" })?.length, 1, "input_sel write failed");
  const selectionWritten = window_get({ window: { wid: editWindow.wid }, text: true })?.text;
  assert(selectionWritten?.includes("Z") && selectionWritten !== EDIT_INITIAL, "input_sel write did not replace/insert at the current selection");
  a11y_action({ a11y: { wid: editWindow.wid }, action: "set", value: EDIT_INITIAL });
  await eventually(() => window_get({ window: { wid: editWindow.wid }, text: true })?.text === EDIT_INITIAL, "selection test did not restore edit text");
  check("input_sel read/write");

  assert(await window_wait({ window: { wid: root.wid }, timeout: 500, interval: 20 }), "window_wait failed");
  assert(await wait({ window: { wid: root.wid }, timeout: 0 }), "wait.window immediate match failed");
  same(await wait({ window: { title: "^AAF DEFINITELY MISSING$" }, not: true, timeout: 0 }), true, "wait.not failed");
  check("window_wait and wait.window/not");

  window_control({ window: { wid: root.wid }, action: "minimize" });
  same(window_get({ window: { wid: root.wid } })?.status, "minimized", "minimize failed");
  window_control({ window: { wid: root.wid }, action: "restore" });
  window_control({ window: { wid: root.wid }, action: "maximize" });
  same(window_get({ window: { wid: root.wid } })?.status, "maximized", "maximize failed");
  window_control({ window: { wid: root.wid }, action: "restore" });
  await wait(50);

  let geometry = window_get({ window: { wid: root.wid } });
  window_control({
    window: { wid: root.wid },
    action: "move",
    pos: { x: "+37", y: "+23" },
    rect: { width: "+40", height: "+30" },
  });
  let moved = window_get({ window: { wid: root.wid } });
  same(moved.rect.x, geometry.rect.x + 37, "relative x move failed");
  same(moved.rect.y, geometry.rect.y + 23, "relative y move failed");
  same(moved.rect.width, geometry.rect.width + 40, "relative width failed");
  same(moved.rect.height, geometry.rect.height + 30, "relative height failed");
  window_control({
    window: { wid: root.wid },
    action: "size",
    pos: { x: geometry.rect.x, y: geometry.rect.y },
    rect: { width: geometry.rect.width, height: geometry.rect.height },
  });
  geometry = window_get({ window: { wid: root.wid } });
  check("window_control minimize/maximize/restore/move/size");

  const changedTitle = `AAF MUTATED ${token}`;
  const changed = await window_set({
    window: { wid: root.wid },
    title: changedTitle,
    frame: "border",
    topmost: true,
    opacity: 0.97,
    enabled: false,
  });
  same(changed?.title, changedTitle, "window_set title failed");
  await wait(30);
  assert(a11y_find({ a11y: { wid: root.wid, enabled: false }, limit: 1 }).length === 1, "window_set enabled:false not observable in a11y");
  await window_set({
    window: { wid: root.wid },
    title: `AAF TEST FIXTURE ${token}`,
    frame: "resizable",
    topmost: false,
    opacity: 1,
    enabled: true,
    highlight: 30,
  });
  root = window_get({ window: { wid: root.wid } });
  check("window_set + highlight");

  await window_set({ window: { wid: root.wid }, topmost: true });
  window_control({ window: { wid: root.wid }, action: "focus" });
  await wait(40);
  root = window_get({ window: { wid: root.wid } });

  const buttonNow = window_get({ window: { wid: buttonWindow.wid } });
  assert(buttonNow, "button disappeared before hit test");
  const buttonCenter = {
    x: buttonNow.rect.x + Math.floor(buttonNow.rect.width / 2),
    y: buttonNow.rect.y + Math.floor(buttonNow.rect.height / 2),
  };
  const rootHit = window_hit({ pos: buttonCenter });
  const childHit = window_hit({ pos: buttonCenter, child: true });
  const interactiveDesktop = rootHit?.wid === root.wid && childHit?.wid === buttonWindow.wid;
  if (interactiveDesktop) {
    check("window_hit child/root");
  } else {
    console.log(`↷ window_hit fixture assertion skipped: desktop is occluded by ${rootHit?.class ?? "another surface"}`);
  }
  const clientPoint = await mouse_move({ window: { wid: root.wid }, pos: { at: "centerWC", x: "+10", y: "-10" } });
  assert(clientPoint?.pos, "mouse_move WC geometry failed");
  const humanTarget = { x: clientPoint.pos.x + 12, y: clientPoint.pos.y + 8 };
  const humanPoint = await mouse_move({ pos: humanTarget, duration: 40, path: "user" });
  same(humanPoint?.pos.x, humanTarget.x, "user mouse path x destination failed");
  same(humanPoint?.pos.y, humanTarget.y, "user mouse path y destination failed");
  let clicks = 0;
  same(a11y_action({ a11y: { wid: buttonWindow.wid }, action: "invoke" })?.action, "invoke", "a11y invoke action failed");
  clicks++;
  assert(await wait({ window: { wid: statusWindow.wid, title: `^${STATUS_PREFIX} ${clicks}$` }, timeout: 1000, interval: 20 }), "a11y invoke did not update fixture status");
  if (interactiveDesktop) {
    await mouse_move({ pos: buttonCenter });
    mouse_button({ click: "left" });
    clicks++;
    assert(
      await wait({ window: { wid: statusWindow.wid, title: `^${STATUS_PREFIX} ${clicks}$` }, timeout: 1000, interval: 20 }),
      "physical mouse click did not update fixture status",
    );
    check("physical mouse move/click");
  } else {
    console.log("↷ physical mouse click verification skipped: desktop is not interactively exposing the fixture");
  }
  check("geometry W/WC");

  clipboard({ write: `AAF CLIPBOARD ${token}` });
  same(clipboard({ read: true }), `AAF CLIPBOARD ${token}`, "clipboard read/write failed");
  same(clipboard({ clear: true }), true, "clipboard clear failed");
  check("clipboard read/write/clear");

  const directClick = mouse_button({
    window: { wid: buttonWindow.wid },
    click: "left",
    repeat: 3,
    interval: 10,
  });
  same(directClick?.wid, buttonWindow.wid, "direct-target mouse click failed");
  same(directClick?.repeat, 3, "mouse click repeat output failed");
  clicks += 3;
  assert(
    await wait({ window: { wid: statusWindow.wid, title: `^${STATUS_PREFIX} ${clicks}$` }, timeout: 1000, interval: 20 }),
    "repeated direct-target button clicks did not update fixture status",
  );
  const wheel = mouse_button({ window: { wid: root.wid }, wheel: 1 });
  same(wheel?.wheel, 1, "direct-target mouse wheel failed");
  const hwheel = mouse_button({ window: { wid: root.wid }, hwheel: 1 });
  same(hwheel?.hwheel, 1, "direct-target horizontal mouse wheel failed");
  same((await run([{ mouse_button: { window: { wid: nestedWindow.wpid }, down: "left" } }])).results[0]?.down, "left", "scenario mouse hold failed");
  same(input_reset().released, 0, "run did not implicitly reset direct mouse hold");
  check("mouse_button direct click/wheel/hwheel + run reset");

  root = window_get({ window: { wid: root.wid } });
  if (interactiveDesktop && root?.foreground) {
    const editNow = window_get({ window: { wid: editWindow.wid } });
    const editCenter = {
      x: editNow.rect.x + Math.floor(editNow.rect.width / 2),
      y: editNow.rect.y + Math.floor(editNow.rect.height / 2),
    };
    await mouse_move({ pos: editCenter });
    mouse_button({ click: "left" });
    await wait(30);
    assert(
      a11y_find({ a11y: { wid: editWindow.wid, focus: true }, limit: 1 }).length === 1,
      "fixture edit did not receive keyboard focus",
    );
    const chord = await keyb({ press: ["ctrl", "a"] });
    same(chord.press.length, 2, "keyb chord press failed");
    const typedText = `KEYB ${token}`;
    const typed = await keyb({ type: typedText, interval: 5 });
    same(typed.typed, typedText.length, "keyb typed count failed");
    const editValue = () => window_get({ window: { wid: editWindow.wid }, text: true })?.text;
    const afterType = `${EDIT_INITIAL}${typedText}`;
    await eventually(() => editValue() === afterType, "typed text did not reach fixture edit");
    const repeated = await keyb({ press: "backspace", repeat: 2, interval: 10 });
    same(repeated.repeat, 2, "keyb repeat output failed");
    const shortened = afterType.slice(0, -2);
    await eventually(() => editValue() === shortened, "repeated backspace did not reach fixture edit");
    const mapped = await keyb({ press: "@" });
    same(mapped.press[0], "@", "layout-mapped key press failed");
    const finalText = `${shortened}@`;
    await eventually(() => editValue() === finalText, "layout-mapped @ did not reach fixture edit");
    const timed = (await run([{ state: { timingText: "XY" } }, { keyb: { type: "$.state.timingText", duration: "rand($.curr.type.len*10)" } }])).results;
    same(timed[1]?.typed, 2, "$.curr timing expression failed after scenario normalization");
    await eventually(() => editValue() === `${finalText}XY`, "timed scenario typing did not reach fixture edit");
    await keyb({ press: "backspace", repeat: 2 });
    const priorityStart = performance.now(), priority = await keyb({ type: "ZZ", duration: 0, interval: 1000 });
    same(priority.typed, 2, "keyb duration/interval priority typing failed");
    assert(performance.now() - priorityStart < 500, "keyb interval was not ignored when duration was supplied");
    await keyb({ press: "backspace", repeat: 2 });
    const humanTyped = await keyb({ type: "UV", duration: "user()" });
    same(humanTyped.typed, 2, "user typing duration failed");
    await keyb({ press: "backspace", repeat: 2 });
    await eventually(() => editValue() === finalText, "timing tests did not restore fixture text");
    const down = await keyb({ down: "shift" });
    const up = await keyb({ up: "shift" });
    same(down.down[0], "shift", "keyb down failed");
    same(up.up[0], "shift", "keyb up failed");
    const held = await keyb({ down: "ctrl" });
    same(held.down[0], "ctrl", "keyb held input for reset failed");
    same((await run([{ input_reset: {} }])).results[0]?.released, 0, "scenario input_reset must preserve pre-existing held input");
    assert(input_reset().released >= 1, "input_reset did not release held keyboard input");
    const earlyReset = await run([{ keyb: { down: "shift" } }, { input_reset: {} }]);
    same(earlyReset.results[0]?.down?.[0], "shift", "scenario held key failed");
    same(earlyReset.results[1]?.released, 1, "scenario input_reset did not release run-owned input");
    same(input_reset().released, 0, "scenario input_reset leaked held keyboard input");
    same((await run([{ keyb: { down: "shift" } }])).results[0]?.down?.[0], "shift", "scenario held key cleanup setup failed");
    same(input_reset().released, 0, "run did not implicitly reset held keyboard input");
    await eventually(() => editValue() === finalText, "final keyboard text did not remain in fixture edit");
    check("keyb press/type/down/up/repeat/layout mapping/timing + input_reset");
  } else {
    console.log("↷ keyb injection verification skipped: fixture is not foreground on an interactive desktop");
  }
  await window_set({ window: { wid: root.wid }, topmost: false });

  const fullPng = `${temp}\\full.png`;
  const immediate = (await run([{
    screenshot: { window: { wid: root.wid }, save: fullPng },
  }])).results[0];
  assert(immediate?.bytes > 0 && immediate.path === fullPng, "screenshot immediate save failed");
  same(immediate.format, "png", "PNG extension inference failed");
  const defaultImage = `${temp}\\default-codec`;
  const defaultSaved = (await run([{ screenshot: { window: { wid: root.wid }, save: defaultImage } }])).results[0];
  same(defaultSaved?.format, "webp", "default screenshot codec must be WebP");
  const defaultBytes = await Deno.readFile(defaultImage);
  same(new TextDecoder().decode(defaultBytes.subarray(0, 4)), "RIFF", "default WebP signature missing");

  const recognized = await ocr({ window: { wid: root.wid } });
  assert(recognized?.text, "ocr returned no text");
  const normalizedOcr = recognized.text.replace(/\s+/g, " ").toUpperCase();
  assert(normalizedOcr.includes("IMAGE MARKER 7391"), `ocr did not see fixture marker: ${recognized.text}`);
  assert(
    await wait({ ocr: { text: "IMAGE MARKER 7391", window: { wid: root.wid } }, timeout: 2500, interval: 100 }),
    "wait.ocr failed",
  );
  check("screenshot save, ocr, wait.ocr");

  const templateWebp = `${temp}\\template.webp`;
  const template = (await run([{
    screenshot: { window: { wid: root.wid }, save: templateWebp },
  }])).results[0];
  assert(template?.bytes > 0 && template.format === "webp", "default WebP screenshot failed");
  const imageMatch = await wait({
    image: { path: templateWebp, window: { wid: root.wid } },
    timeout: 1000,
    interval: 50,
  });
  assert(imageMatch?.similarity >= .98, `wait.image WebP match failed: ${imageMatch?.similarity}`);

  setTimeout(() => mouse_button({ window: { wid: buttonWindow.wid }, click: "left" }), 120);
  const changedPixels = await wait({
    change: { window: { wid: root.wid } },
    timeout: 1500,
    interval: 40,
  });
  assert(changedPixels?.changed > 0, "wait.change did not detect fixture update");
  check("wait.image and wait.change");

  const refs = await run([
    { window_find: { window: { wid: root.wid }, limit: 1 } },
    { state: { retWid: "$.ret[0].wid", prevWid: "$.prev.window.wid", prevLimit: "$.prev.limit" } },
    { state: { retWidAgain: "$.ret[0].wid", prevWidAgain: "$.prev.window.wid" } },
  ]);
  same(refs.results[1].retWid, root.wid, "$.ret did not expose the previous return value");
  same(refs.results[1].prevWid, root.wid, "$.prev did not expose the previous resolved input");
  same(refs.results[1].prevLimit, 1, "$.prev input fields were not preserved");
  same(refs.results[2].retWidAgain, root.wid, "state unexpectedly changed $.ret");
  same(refs.results[2].prevWidAgain, root.wid, "state unexpectedly changed $.prev");

  const save1 = `${temp}\\resource-1.webp`;
  const save2 = `${temp}\\resource-2.webp`;
  const stale = `${temp}\\stale.webp`;
  const scenarioTitle = `AAF SCENARIO [${token}]`;
  const { results, state: scenarioState } = await run([
    { window_find: { window: { wid: root.wid }, limit: 1 } },
    {
      state: {
        target: "$.ret[0]",
        expected: scenarioTitle,
        "meta.pid": "$.ret[0].pid",
        "&history": "$.ret[0]",
      },
    },
    { window_set: { window: { wid: "$.state.target.wid" }, title: "<<$.state.expected>>" } },
    { window_find: { window: { title: "^<<$.state.expected|re>>$" }, limit: 1 } },
    { state: { matched: "$.ret[0]", "-": ["meta.pid"] } },
    { screenshot: { window: { wid: "$.state.target.wid" } } },
    { state: { shot: "$.ret.image", backup: "$.ret.image" } },
    { screenshot_save: { image: "$.state.shot", save: save1 } },
    { ocr: { image: "$.state.shot" } },
    { state: { "-": ["shot"] } },
    { screenshot_save: { image: "$.state.backup", save: save2 } },
    { state: { "-": ["backup"] } },
    { screenshot_save: { image: "$.ret.image", save: stale } },
  ]);

  same(results[0][0].wid, root.wid, "scenario window_find failed");
  same(results[1].history.length, 1, "state push failed");
  same(results[4].matched.title, scenarioTitle, "typed reference/interpolation failed");
  assert(results[4].meta && !("pid" in results[4].meta), "state delete failed");
  assert(results[7]?.bytes > 0, "screenshot_save first write failed");
  assert(results[8]?.text?.replace(/\s+/g, " ").toUpperCase().includes("IMAGE MARKER 7391"), "ocr.image resource failed");
  assert(results[10]?.bytes > 0, "resource should survive one deleted state reference");
  same(results[12]?.error, "no result", "stale resource should return a diagnostic");
  same(results[12]?.action, "screenshot_save", "stale resource diagnostic should identify the action");
  const bytes1 = await Deno.readFile(save1);
  const bytes2 = await Deno.readFile(save2);
  same(bytes1.length, bytes2.length, "resource saves differ in size");
  assert(bytes1.every((value, index) => value === bytes2[index]), "screenshot_save recaptured or changed resource bytes");
  same(scenarioState.matched.title, scenarioTitle, "run final state missing scenario data");

  const returned = await run([
    { screenshot: { window: { wid: root.wid } } },
    { state: { shot: "$.ret.image", alias: "$.ret.image" } },
  ]);
  const returnedImage = returned.state.shot;
  assert(returnedImage?.format === "png" && returnedImage.data instanceof Uint8Array, "run final state did not materialize PNG image resource");
  assert(returnedImage.data.length > 0 && returnedImage.data.length < returnedImage.rect.width * returnedImage.rect.height * 4, "returned PNG image was not compacted");
  assert(returned.state.alias === returnedImage, "duplicate final state image references should share one resource object");
  same(returned.results[1].shot, returned.results[0].image, "scenario state step should still expose the internal image handle");
  const returnedOcr = await ocr({ image: returnedImage });
  assert(returnedOcr?.text?.replace(/\s+/g, " ").toUpperCase().includes("IMAGE MARKER 7391"), "OCR could not consume returned PNG image resource");

  const diagnostics = (await run([
    { window_find: { window: { wid: "$.state.missing" }, limit: 1 } },
    { state: { "bad path": 1 } },
    { unknown_action: {} },
    {},
    { keyb: { press: "a", repeat: 0 } },
    { display_find: { display: { index: 0 } } },
  ])).results;
  same(diagnostics[0]?.error, "unresolved reference", "missing scenario reference should be diagnosed");
  same(diagnostics[0]?.path, "$.state.missing", "reference diagnostic should include the path");
  same(diagnostics[1]?.error, "invalid state path", "invalid state path should be diagnosed");
  same(diagnostics[1]?.path, "bad path", "state diagnostic should include the path");
  same(diagnostics[2]?.error, "unknown action", "unknown action should be diagnosed");
  same(diagnostics[2]?.action, "unknown_action", "unknown-action diagnostic should identify the action");
  same(diagnostics[3]?.error, "invalid action", "malformed action should be diagnosed instead of thrown");
  same(diagnostics[4]?.error, "action failed", "runtime action failure should be diagnosed");
  same(diagnostics[4]?.action, "keyb", "runtime diagnostic should identify the action");
  assert(diagnostics[4]?.message?.includes("Invalid repeat"), "runtime diagnostic should preserve the concise cause");
  same(diagnostics[5].length, 1, "run should continue after diagnosed failures");
  same((await run({})).results[0]?.error, "invalid scenario", "non-array scenario should be diagnosed");
  check("run curr/prev/ret/state, diagnostics, interpolation, push/delete, image resource lifetime");

  await window_set({ window: { wid: root.wid }, title: `AAF TEST FIXTURE ${token}`, highlight: 20 });
  check("all verification groups passed");
} finally {
  try {
    if (awake) system({ awake: false });
  } catch {
    // Power-state restoration is best effort.
  }
  try {
    if (root && window_get({ window: { wid: root.wid } })) {
      window_control({ window: { wid: root.wid }, action: "close" });
      await wait(100);
    }
  } catch {
    // Best-effort cleanup continues below.
  }
  try {
    if (originalClipboard == null) clipboard({ clear: true });
    else clipboard({ write: originalClipboard });
  } catch {
    // Clipboard restoration is best effort.
  }
  try {
    await mouse_move({ pos: originalCursor });
  } catch {
    // Cursor restoration is best effort.
  }
  try {
    await Deno.remove(temp, { recursive: true });
  } catch {
    // Temp cleanup is best effort.
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // It normally exits after WM_CLOSE.
  }
}
