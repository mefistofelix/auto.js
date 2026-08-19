// macOS backend. Native implementations are added incrementally; unsupported
// capabilities return null/empty results rather than pretending to exist.

export function display_find() {
  return [];
}

export function window_find() {
  return [];
}

export function window_control() {
  return null;
}

export function window_get() {
  return null;
}

export async function window_set() {
  return null;
}

export function window_hit() {
  return null;
}

export function a11y_find() {
  return [];
}

export function a11y_action() {
  return null;
}

export async function keyb() {
  return {};
}

export function input_sel() {
  return null;
}

export async function mouse_move() {
  return null;
}

export function mouse_button() {
  return null;
}

export function inputState() {
  return { keys: new Set(), mouse: new Set() };
}

export function releaseInput() {
  return { released: 0 };
}

export function input_reset() {
  return releaseInput();
}

export function clipboard() {
  return null;
}

export async function ocr() {
  return null;
}

export async function wait(options = 0) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    await new Promise((resolve) => setTimeout(resolve, Number(options) || 0));
    return true;
  }
  return null;
}

export function window_wait(
  { window = {}, timeout = 5000, interval = 50 } = {},
) {
  return wait({ window, timeout, interval });
}

export function system() {
  return { locked: null };
}

export function captureScreenshot() {
  return null;
}
