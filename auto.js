import sharp from "npm:sharp";

const backendPath = {
  windows: "./auto_win.js",
  darwin: "./auto_darwin.js",
  linux: "./auto_linux.js",
}[Deno.build.os];

if (!backendPath) {
  throw new Error(`auto.js does not support ${Deno.build.os}`);
}

const backend = await import(backendPath);

export const {
  display_find,
  window_find,
  window_control,
  window_get_prop,
  window_set_prop,
  window_hit,
  window_wait,
  a11y_find,
  a11y_action,
  keyb,
  input_sel,
  mouse_move,
  mouse_button,
  input_reset,
  clipboard,
  wait,
  system,
} = backend;

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function imageCodec(format, path) {
  const codec = String(format ?? path?.match(/\.(png|webp)$/i)?.[1] ?? "webp")
    .toLowerCase();
  return codec === "png" || codec === "webp" ? codec : null;
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

function sharpImage({ rect: { width, height }, data }) {
  return sharp(swapRedBlue(data), { raw: { width, height, channels: 4 } });
}

async function imageBGRA(image) {
  if (!image) return null;
  if (image.format === "bgra8") return image;
  if (!(image.data instanceof Uint8Array)) return null;
  try {
    const { data, info } = await sharp(image.data).ensureAlpha().raw().toBuffer(
      {
        resolveWithObject: true,
      },
    );
    return {
      rect: {
        x: image.rect?.x ?? 0,
        y: image.rect?.y ?? 0,
        width: info.width,
        height: info.height,
      },
      format: "bgra8",
      grayscale: !!image.grayscale,
      data: swapRedBlue(data),
    };
  } catch {
    return null;
  }
}

async function nativeOcr(options) {
  if (!options.image) return backend.ocr(options);
  const image = await imageBGRA(options.image);
  return image ? backend.ocr({ ...options, image }) : null;
}

const TESSERACT_MODULE = "npm:" + "tesseract.js";

function tesseractCachePath() {
  try {
    const home = Deno.env.get("HOME");
    const base = Deno.build.os === "windows"
      ? Deno.env.get("LOCALAPPDATA")
      : Deno.build.os === "darwin"
      ? home && `${home}/Library/Caches`
      : Deno.env.get("XDG_CACHE_HOME") ?? (home && `${home}/.cache`);
    if (!base) return null;
    const path = `${base}/auto.js/tesseract`;
    Deno.mkdirSync(path, { recursive: true });
    return path;
  } catch {
    return null;
  }
}

async function tesseractOcr(options) {
  const image = options.image
    ? await imageBGRA(options.image)
    : backend.captureScreenshot(options);
  if (!image) return null;

  let worker;
  try {
    const { createWorker } = await import(TESSERACT_MODULE);
    const cachePath = tesseractCachePath();
    worker = await createWorker(
      "eng",
      1,
      cachePath ? { cachePath } : { cacheMethod: "none" },
    );
    const png = await sharpImage(image).png().toBuffer();
    const { data } = await worker.recognize(png);
    return { text: data.text, rect: image.rect };
  } catch {
    return null;
  } finally {
    await worker?.terminate();
  }
}

export async function ocr(options = {}) {
  const provider = String(options.provider ?? "default").toLowerCase();
  if (provider === "native") return nativeOcr(options);
  if (provider === "tesseract") return tesseractOcr(options);
  if (provider !== "default") return null;

  const result = await nativeOcr(options);
  return result ?? (Deno.build.os === "linux" ? tesseractOcr(options) : null);
}

async function saveImage(image, path, format) {
  if (!path) return {};
  const codec = imageCodec(format, path);
  if (!codec) return {};
  const pipeline = sharpImage(image);
  const bytes = codec === "webp"
    ? await pipeline.webp({ quality: 80 }).toBuffer()
    : await pipeline.png().toBuffer();
  await Deno.writeFile(path, bytes);
  return { path, bytes: bytes.length, format: codec };
}

function resourceRefs(value, resources, found = new Set()) {
  if (typeof value === "string") {
    if (resources.has(value)) found.add(value);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const item of Object.values(value)) resourceRefs(item, resources, found);
  return found;
}

function imageResult(id, image, saved = {}) {
  return { image: id, rect: image.rect, grayscale: image.grayscale, ...saved };
}

function collectScenarioResources(resources, context) {
  const live = resourceRefs(context.state, resources);
  resourceRefs(context.ret, resources, live);
  for (const id of resources.keys()) {
    if (!live.has(id)) resources.delete(id);
  }
}

async function scenarioScreenshot(options, resources) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return null;
  }
  const { save, format, ...capture } = options;
  const image = backend.captureScreenshot(capture);
  if (!image) return null;
  const id = crypto.randomUUID();
  resources.set(id, image);
  try {
    return imageResult(id, image, await saveImage(image, save, format));
  } catch (error) {
    resources.delete(id);
    throw error;
  }
}

async function scenarioScreenshotSave(options, resources, state) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return null;
  }
  const { image: id, save, format } = options;
  if (!save || !resourceRefs(state, resources).has(id)) return null;
  const image = resources.get(id);
  if (!image) return null;
  return imageResult(id, image, await saveImage(image, save, format));
}

function scenarioFail(error, details = {}) {
  throw Object.assign(new Error(error), { scenario: details });
}

function scenarioError(error, action) {
  if (error?.scenario) return { error: error.message, ...error.scenario };
  return {
    error: "action failed",
    ...(action ? { action } : {}),
    message: error instanceof Error ? error.message : String(error),
  };
}

function resolveActionResources(name, value, resources) {
  if (
    name !== "ocr" || !value || typeof value !== "object" ||
    typeof value.image !== "string"
  ) return value;
  const image = resources.get(value.image);
  if (!image) {
    scenarioFail("image resource unavailable", { image: value.image });
  }
  return { ...value, image };
}

const ACTIONS = { ...backend, ocr };
delete ACTIONS.captureScreenshot;
delete ACTIONS.inputState;
delete ACTIONS.releaseInput;
delete ACTIONS.window_wait;

const SCENARIO_PATH =
    /^\$\.(prev|ret|state)((?:\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\])*)$/,
  STATE_PATH = /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/;

function scenarioPath(path) {
  const match = typeof path === "string" && path.match(SCENARIO_PATH);
  return match
    ? [
      match[1],
      ...[...match[2].matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)|\[(\d+)\]/g)].map((
        x,
      ) => x[1] ?? Number(x[2])),
    ]
    : null;
}

function scenarioReference(path, context) {
  const parts = scenarioPath(path);
  if (!parts) scenarioFail("invalid reference", { path });
  let value = context[parts[0]];
  for (const key of parts.slice(1)) {
    if (value == null || !own(Object(value), key)) {
      scenarioFail("unresolved reference", { path });
    }
    value = value[key];
  }
  return structuredClone(value);
}

function scenarioText(value) {
  return typeof value === "string"
    ? value
    : value && typeof value === "object"
    ? JSON.stringify(value)
    : String(value);
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveScenarioString(value, context) {
  if (value.startsWith("$.")) return scenarioReference(value, context);
  return value.replace(/<<([^<>]+)>>/g, (placeholder, expression) => {
    const match = expression.match(/^(\$\..*?)(?:\|(re))?$/);
    if (!match) return placeholder;
    const text = scenarioText(scenarioReference(match[1], context));
    return match[2] ? regexEscape(text) : text;
  });
}

function resolveScenarioValue(value, context) {
  if (typeof value === "string") return resolveScenarioString(value, context);
  if (!value || typeof value !== "object") return value;
  const out = Array.isArray(value) ? [] : {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = resolveScenarioValue(item, context);
  }
  return out;
}

function statePath(value) {
  return typeof value === "string" && STATE_PATH.test(value)
    ? value.split(".")
    : null;
}

function stateKey(value) {
  if (typeof value !== "string") return null;
  const push = value[0] === "&";
  const path = statePath(push ? value.slice(1) : value);
  return path && { push, path };
}

function stateParent(root, path, create) {
  let target = root;
  for (const key of path.slice(0, -1)) {
    if (
      !own(target, key) || !target[key] || typeof target[key] !== "object" ||
      Array.isArray(target[key])
    ) {
      if (!create) return null;
      target[key] = Object.create(null);
    }
    target = target[key];
  }
  return target;
}

function applyStatePatch(root, patch, context, prefix = []) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    scenarioFail("invalid state patch");
  }

  const hasDelete = !prefix.length && own(patch, "-");
  const remove = hasDelete ? patch["-"] : [];
  if (hasDelete && !Array.isArray(remove)) scenarioFail("invalid state delete");

  for (const [rawKey, item] of Object.entries(patch)) {
    if (!prefix.length && rawKey === "-") continue;

    const key = stateKey(rawKey);
    if (!key) scenarioFail("invalid state path", { path: rawKey });
    const path = [...prefix, ...key.path];
    const object = !key.push && item && typeof item === "object" &&
      !Array.isArray(item);

    if (object && Object.keys(item).length) {
      applyStatePatch(root, item, context, path);
      continue;
    }

    const parent = stateParent(root, path, true);
    const leaf = path.at(-1);
    if (object) {
      if (
        !own(parent, leaf) || !parent[leaf] ||
        typeof parent[leaf] !== "object" || Array.isArray(parent[leaf])
      ) parent[leaf] = Object.create(null);
      continue;
    }

    const value = resolveScenarioValue(item, context);
    if (key.push) {
      if (!own(parent, leaf)) parent[leaf] = [];
      if (!Array.isArray(parent[leaf])) {
        scenarioFail("state target is not an array", { path: path.join(".") });
      }
      parent[leaf].push(value);
    } else {
      parent[leaf] = value;
    }
  }

  if (!hasDelete) return;
  for (const name of remove) {
    const resolved = resolveScenarioValue(name, context);
    const path = statePath(resolved);
    if (!path) scenarioFail("invalid state path", { path: String(resolved) });
    const parent = stateParent(root, path, false);
    if (parent) delete parent[path.at(-1)];
  }
}

async function outputImage(image) {
  try {
    return {
      rect: image.rect,
      format: "png",
      grayscale: image.grayscale,
      data: await sharpImage(image).png().toBuffer(),
    };
  } catch {
    return image;
  }
}

async function scenarioOutputState(value, resources, images = new Map()) {
  if (typeof value === "string") {
    const image = resources.get(value);
    if (!image) return value;
    if (!images.has(value)) images.set(value, outputImage(image));
    return images.get(value);
  }
  if (!value || typeof value !== "object") return value;
  const out = Array.isArray(value) ? [] : {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = await scenarioOutputState(item, resources, images);
  }
  return out;
}

export async function run(actions = []) {
  if (!Array.isArray(actions)) {
    return {
      results: [{
        error: "invalid scenario",
        message: "actions must be an array",
      }],
      state: {},
    };
  }

  const results = [];
  const context = { prev: null, ret: null, state: Object.create(null) };
  const resources = new Map();
  const held = backend.inputState();
  try {
    for (const action of actions) {
      let name;
      let result;
      let input;
      let stateStep = false;
      try {
        const entries =
          action && typeof action === "object" && !Array.isArray(action)
            ? Object.entries(action)
            : [];
        if (entries.length !== 1) {
          scenarioFail("invalid action", {
            message: "expected exactly one command",
          });
        }

        name = entries[0][0];
        const params = entries[0][1];
        stateStep = name === "state";
        if (stateStep) {
          const next = structuredClone(context.state);
          applyStatePatch(next, params, context);
          context.state = next;
          result = next;
        } else {
          if (
            name !== "screenshot" && name !== "screenshot_save" &&
            !ACTIONS[name]
          ) scenarioFail("unknown action", { action: name });

          input = resolveScenarioValue(params, context) ?? {};
          if (name === "screenshot") {
            result = await scenarioScreenshot(input, resources);
          } else if (name === "screenshot_save") {
            result = await scenarioScreenshotSave(
              input,
              resources,
              context.state,
            );
          } else if (name === "input_reset") {
            result = backend.releaseInput(held);
          } else {
            result = await ACTIONS[name](
              resolveActionResources(name, input, resources),
            );
          }
          if (result == null) result = { error: "no result", action: name };
        }
      } catch (error) {
        result = scenarioError(error, name);
      }

      results.push(result);
      if (!stateStep) {
        if (input !== undefined) context.prev = input;
        context.ret = result;
      }
      collectScenarioResources(resources, context);
    }

    return {
      results,
      state: await scenarioOutputState(context.state, resources),
    };
  } finally {
    backend.releaseInput(held);
    resources.clear();
  }
}

if (import.meta.main) {
  if (Deno.args.length !== 1) {
    throw new Error("usage: deno run -A auto.js <scenario.yaml>");
  }
  const { parse } = await import("jsr:" + "@std/yaml@1.2.0");
  const actions = parse(await Deno.readTextFile(Deno.args[0]));
  console.log(JSON.stringify(await run(actions), null, 2));
}
