import {
  display_find,
  window_find,
  window_get_prop,
  window_control,
  ocr,
  mouse_move,
  mouse_button,
  window_hit,
  keyb,
  clipboard,
  wait,
  run,
} from "../auto.js";

const TEST_TEXT = "AUTO OCR TEST 48291";
const STEP_DELAY = 1200;
const pause = (label) => (console.log(`\n--- ${label} ---`), wait({ ms: STEP_DELAY }));
const saveShot = async (options) => (await run([{ screenshot: options }])).results[0];
const before = new Set(window_find({ window: { bin: "notepad\\.exe$", class: "^Notepad$" } }).map((w) => w.wid));
new Deno.Command("notepad.exe").spawn();

function focusTarget(win) {
  window_control({ window: { wid: win.wid }, action: "focus" });
  const current = window_get_prop({ window: { wid: win.wid } });
  if (!current?.foreground) {
    throw new Error(`Refusing input: target ${win.wid} is not foreground`);
  }
  return current;
}

console.log("display_find", display_find());

  let win;
  const until = performance.now() + 8000;
  do {
    win = window_find({ window: { bin: "notepad\\.exe$", class: "^Notepad$" } }).find((w) => !before.has(w.wid));
    if (win) break;
    await wait({ ms: 50 });
  } while (performance.now() < until);
  if (!win) {
    throw new Error(
      "Notepad reused an existing window instead of creating a new top-level HWND; refusing to automate a pre-existing Notepad window",
    );
  }

  console.log("new Notepad window selected by binary path", win);
  if (!/notepad\.exe$/i.test(win.bin)) throw new Error(`Wrong binary: ${win.bin}`);

  await pause("minimize");
  window_control({ window: { wid: win.wid }, action: "minimize" });
  await wait({ ms: STEP_DELAY });
  if (window_get_prop({ window: { wid: win.wid } })?.status !== "minimized") throw new Error("Notepad did not minimize");
  console.log("minimize: ok");

  await pause("restore + focus");
  window_control({ window: { wid: win.wid }, action: "restore" });
  await wait({ ms: STEP_DELAY });
  focusTarget(win);
  await wait({ ms: STEP_DELAY });
  if (window_get_prop({ window: { wid: win.wid } })?.status === "minimized") throw new Error("Notepad did not restore");
  console.log("restore + focus: ok");

  // Clipboard roundtrip is tested independently before keyboard input.
  clipboard({ write: TEST_TEXT });
  if (clipboard({ read: true }) !== TEST_TEXT) throw new Error("Clipboard roundtrip failed");
  console.log("clipboard: ok");

  await pause("typing text");
  focusTarget(win);
  await keyb({ press: ["ctrl", "a"] });
  await keyb({ type: `${TEST_TEXT}\r\n${TEST_TEXT}`, interval: 35 });
  await wait({ ms: STEP_DELAY });
  console.log("keyboard typing: ok");

  await pause("window screenshot");
  const shot = await saveShot({
    save: "notepad.png",
    window: { wid: win.wid },
  });
  console.log("window screenshot", shot);

  const clientShot = await saveShot({
    save: "notepad-client.png",
    window: { wid: win.wid },
    rect: { at: "centerWC", width: "50%WC", height: "50%WC" },
  });
  const clientPoint = await mouse_move({
    window: { wid: win.wid },
    pos: { x: "20WC", y: "30WC" },
  });
  if (window_hit(clientPoint)?.wid !== win.wid) throw new Error("WC geometry did not land inside Notepad");
  console.log("client-area geometry", { clientShot, clientPoint });

  // Also exercise primary-display capture and a small rect capture.
  await saveShot({ save: "desktop.png" });
  await saveShot({
    save: "desktop-rect-gray.png",
    display: { index: 0 },
    rect: { x: 0, y: 0, width: 400, height: 240 },
    grayscale: true,
  });
  console.log("display + rect + grayscale screenshots: ok");

  await pause("OCR");
  const recognized = await ocr({ window: { wid: win.wid } });
  console.log("ocr text:\n", recognized.text);
  const normalized = recognized.text.replace(/\s+/g, " ").toUpperCase();
  if (!normalized.includes("AUTO OCR TEST")) {
    throw new Error(`OCR assertion failed. Expected AUTO OCR TEST, got: ${recognized.text}`);
  }
  console.log("ocr assertion: ok");

  const geometry = window_get_prop({ window: { wid: win.wid } });

  await pause("relative window move + resize");
  window_control({
    window: { wid: win.wid },
    action: "move",
    pos: { x: "+60", y: "+30" },
    rect: { right: "+10%", bottom: "+8%" },
  });
  let changed = window_get_prop({ window: { wid: win.wid } });
  if (changed.rect.x !== geometry.rect.x + 60 || changed.rect.y !== geometry.rect.y + 30) {
    throw new Error("Relative window move failed");
  }
  const addedWidth = Math.round(geometry.rect.width * 0.10);
  const addedHeight = Math.round(geometry.rect.height * 0.08);
  if (changed.rect.width !== geometry.rect.width + addedWidth || changed.rect.height !== geometry.rect.height + addedHeight) {
    throw new Error("Relative percentage window resize failed");
  }
  window_control({
    window: { wid: win.wid },
    action: "size",
    pos: { x: "-60", y: "-30" },
    rect: { right: String(-addedWidth), bottom: String(-addedHeight) },
  });
  changed = window_get_prop({ window: { wid: win.wid } });
  if (
    changed.rect.x !== geometry.rect.x || changed.rect.y !== geometry.rect.y ||
    changed.rect.width !== geometry.rect.width || changed.rect.height !== geometry.rect.height
  ) {
    throw new Error("Window geometry restore failed");
  }
  console.log("relative window move + resize: ok");

  const beforeMove = changed;

  // Anchor directly to the current top edge, then drag with cursor-relative moves.
  await pause("mouse drag: fast right, slow left");
  await mouse_move({ window: { wid: win.wid }, pos: { at: "top", y: "+2%" }, duration: 500 });
  mouse_button({ down: "left" });
  await mouse_move({ pos: { x: "+140" }, duration: 450 });
  await mouse_move({ pos: { x: "-80" }, duration: 1400 });
  mouse_button({ up: "left" });
  await wait({ ms: STEP_DELAY });

  const afterMove = window_get_prop({ window: { wid: win.wid } });
  console.log("window moved", {
    before: [beforeMove.rect.x, beforeMove.rect.y],
    after: [afterMove.rect.x, afterMove.rect.y],
  });
  if (afterMove.rect.x === beforeMove.rect.x && afterMove.rect.y === beforeMove.rect.y) {
    throw new Error("Mouse drag did not move the window");
  }

  const hit = window_hit({
    pos: {
      x: afterMove.rect.x + Math.min(80, Math.max(10, afterMove.rect.width - 10)),
      y: afterMove.rect.y + 15,
    },
  });
  console.log("window_hit", hit);
  if (hit?.wid !== win.wid) throw new Error(`window_hit returned ${hit?.wid}, expected ${win.wid}`);
  console.log("mouse drag + hit test: ok");

  // Return the new blank document to its original state before closing, avoiding a save prompt.
  focusTarget(win);
  await keyb({ press: ["ctrl", "z"] });
  await keyb({ press: ["ctrl", "z"] });
  await keyb({ press: ["ctrl", "z"] });
  await wait({ ms: 150 });

  await pause("close");
  window_control({ window: { wid: win.wid }, action: "close" });
  await wait({ ms: STEP_DELAY });
  const stillOpen = window_get_prop({ window: { wid: win.wid } });
  if (stillOpen) throw new Error("Close was requested but the test Notepad window is still open");
  console.log("close: ok");
