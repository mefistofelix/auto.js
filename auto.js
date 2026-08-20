import { createRequire } from "node:module";

if (false) {
  await import("npm:sharp");
  await import("./auto_win.js");
  await import("./auto_darwin.js");
  await import("./auto_linux.js");
  await import("jsr:@std/yaml@1.2.0");
}

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

const VIPS_SYMBOLS = {
  vips_init: { parameters: ["buffer"], result: "i32" },
  vips_cache_set_max: { parameters: ["i32"], result: "void" },
  vips_image_new_from_memory: {
    parameters: ["buffer", "usize", "i32", "i32", "i32", "i32"],
    result: "pointer",
  },
  vips_image_get_type: { parameters: [], result: "usize" },
  vips_blob_get_type: { parameters: [], result: "usize" },
  vips_operation_new: { parameters: ["buffer"], result: "pointer" },
  vips_object_set_argument_from_string: {
    parameters: ["pointer", "buffer", "buffer"],
    result: "i32",
  },
  vips_cache_operation_build: { parameters: ["pointer"], result: "pointer" },
  vips_value_set_blob: {
    parameters: ["buffer", "pointer", "buffer", "usize"],
    result: "void",
  },
  vips_value_get_blob: { parameters: ["buffer", "buffer"], result: "pointer" },
  vips_object_unref_outputs: { parameters: ["pointer"], result: "void" },
  vips_image_get_width: { parameters: ["pointer"], result: "i32" },
  vips_image_get_height: { parameters: ["pointer"], result: "i32" },
  vips_image_get_bands: { parameters: ["pointer"], result: "i32" },
  vips_image_write_to_memory: {
    parameters: ["pointer", "buffer"],
    result: "pointer",
  },
  g_value_init: { parameters: ["buffer", "usize"], result: "pointer" },
  g_value_set_object: { parameters: ["buffer", "pointer"], result: "void" },
  g_value_get_object: { parameters: ["buffer"], result: "pointer" },
  g_value_unset: { parameters: ["buffer"], result: "void" },
  g_object_set_property: {
    parameters: ["pointer", "buffer", "buffer"],
    result: "void",
  },
  g_object_get_property: {
    parameters: ["pointer", "buffer", "buffer"],
    result: "void",
  },
  g_object_unref: { parameters: ["pointer"], result: "void" },
  g_free: { parameters: ["pointer"], result: "void" },
};

const textEncoder = new TextEncoder();
const cString = (value) => textEncoder.encode(`${value}\0`);
let vips;

function loadVips() {
  if (vips) return vips;
  const require = createRequire(import.meta.resolve("npm:sharp"));
  const platform = require("./libvips.cjs").runtimePlatformArch();
  const dependencies = require("../package.json").optionalDependencies;
  const find = (subpath) => {
    for (const dependency in dependencies) {
      if (!dependency.endsWith(platform)) continue;
      try {
        return require.resolve(`${dependency}/${subpath}`);
      } catch { /* optional dependency without this export */ }
    }
  };
  const path = find("binary") ??
    find("sharp.node")?.replace(/index\.cjs$/, "lib/libvips-42.dll");
  if (!path) throw new Error("Could not resolve Sharp's libvips binary");
  vips = Deno.dlopen(path, VIPS_SYMBOLS);
  if (vips.symbols.vips_init(cString("auto.js")) !== 0) {
    vips.close();
    vips = null;
    throw new Error("Could not initialize libvips");
  }
  vips.symbols.vips_cache_set_max(0);
  return vips;
}

function gValue(type) {
  const value = new Uint8Array(24);
  loadVips().symbols.g_value_init(value, type);
  return value;
}

function encodeImage({ rect: { width, height }, data }, codec) {
  const symbols = loadVips().symbols;
  const rgba = swapRedBlue(data);
  const image = symbols.vips_image_new_from_memory(
    rgba,
    BigInt(rgba.length),
    width,
    height,
    4,
    0,
  );
  if (!image) throw new Error("Could not create libvips image");
  const operation = symbols.vips_operation_new(cString(`${codec}save_buffer`));
  if (!operation) {
    symbols.g_object_unref(image);
    throw new Error(`Could not create libvips ${codec} encoder`);
  }

  let built;
  try {
    const input = gValue(symbols.vips_image_get_type());
    symbols.g_value_set_object(input, image);
    symbols.g_object_set_property(operation, cString("in"), input);
    symbols.g_value_unset(input);
    if (codec === "webp") {
      symbols.vips_object_set_argument_from_string(
        operation,
        cString("Q"),
        cString("80"),
      );
      symbols.vips_object_set_argument_from_string(
        operation,
        cString("effort"),
        cString("4"),
      );
    }
    built = symbols.vips_cache_operation_build(operation);
    if (!built) throw new Error(`Could not encode ${codec}`);

    const output = gValue(symbols.vips_blob_get_type());
    try {
      symbols.g_object_get_property(built, cString("buffer"), output);
      const length = new BigUint64Array(1);
      const pointer = symbols.vips_value_get_blob(output, length);
      if (!pointer) throw new Error(`Could not encode ${codec}`);
      return new Uint8Array(
        new Deno.UnsafePointerView(pointer).getArrayBuffer(Number(length[0])),
      ).slice();
    } finally {
      symbols.g_value_unset(output);
    }
  } finally {
    if (built) {
      symbols.vips_object_unref_outputs(built);
      symbols.g_object_unref(built);
      if (built !== operation) symbols.g_object_unref(operation);
    } else {
      symbols.g_object_unref(operation);
    }
    symbols.g_object_unref(image);
  }
}

function decodePixels(data, bands) {
  const pixels = data.length / bands;
  const out = new Uint8Array(pixels * 4);
  for (let p = 0; p < pixels; p++) {
    const source = p * bands, target = p * 4;
    if (bands <= 2) {
      out[target] = out[target + 1] = out[target + 2] = data[source];
      out[target + 3] = bands === 2 ? data[source + 1] : 255;
    } else {
      out[target] = data[source + 2];
      out[target + 1] = data[source + 1];
      out[target + 2] = data[source];
      out[target + 3] = bands >= 4 ? data[source + 3] : 255;
    }
  }
  return out;
}

function decodeBytes(data, codec, rect = {}, grayscale = false) {
  const symbols = loadVips().symbols;
  const operation = symbols.vips_operation_new(cString(`${codec}load_buffer`));
  if (!operation) throw new Error(`Could not create libvips ${codec} decoder`);
  let built;
  try {
    const input = gValue(symbols.vips_blob_get_type());
    symbols.vips_value_set_blob(input, null, data, BigInt(data.length));
    symbols.g_object_set_property(operation, cString("buffer"), input);
    symbols.g_value_unset(input);
    built = symbols.vips_cache_operation_build(operation);
    if (!built) throw new Error(`Could not decode ${codec}`);

    const output = gValue(symbols.vips_image_get_type());
    try {
      symbols.g_object_get_property(built, cString("out"), output);
      const image = symbols.g_value_get_object(output);
      const width = symbols.vips_image_get_width(image);
      const height = symbols.vips_image_get_height(image);
      const bands = symbols.vips_image_get_bands(image);
      const length = new BigUint64Array(1);
      const pointer = symbols.vips_image_write_to_memory(image, length);
      if (!pointer || bands < 1) throw new Error(`Could not decode ${codec}`);
      try {
        const raw = new Uint8Array(
          new Deno.UnsafePointerView(pointer).getArrayBuffer(Number(length[0])),
        );
        return {
          rect: { x: rect.x ?? 0, y: rect.y ?? 0, width, height },
          format: "bgra8",
          grayscale: !!grayscale,
          data: decodePixels(raw, bands),
        };
      } finally {
        symbols.g_free(pointer);
      }
    } finally {
      symbols.g_value_unset(output);
    }
  } finally {
    if (built) {
      symbols.vips_object_unref_outputs(built);
      symbols.g_object_unref(built);
      if (built !== operation) symbols.g_object_unref(operation);
    } else {
      symbols.g_object_unref(operation);
    }
  }
}

function encodedCodec(data, format) {
  const codec = String(format ?? "").toLowerCase();
  if (codec === "png" || codec === "webp") return codec;
  if (
    data.length >= 12 && data[0] === 0x52 && data[1] === 0x49 &&
    data[2] === 0x46 && data[3] === 0x46 && data[8] === 0x57 &&
    data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) return "webp";
  if (
    data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 &&
    data[2] === 0x4e && data[3] === 0x47
  ) return "png";
  return null;
}

async function decodeImage(source, rect = {}, grayscale = false, format) {
  const data = typeof source === "string"
    ? await Deno.readFile(source)
    : source;
  const codec =
    imageCodec(format, typeof source === "string" ? source : null) ??
      encodedCodec(data, format);
  if (!codec) throw new Error("Unsupported image format");
  return decodeBytes(data, codec, rect, grayscale);
}

async function imageBGRA(image) {
  if (!image) return null;
  if (image.format === "bgra8") return image;
  if (!(image.data instanceof Uint8Array)) return null;
  try {
    return await decodeImage(
      image.data,
      image.rect,
      image.grayscale,
      image.format,
    );
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
    const png = encodeImage(image, "png");
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

export async function wait(options = 0) {
  if (
    !options || typeof options !== "object" || Array.isArray(options) ||
    options.image == null
  ) return backend.wait(options);

  const spec = typeof options.image === "string"
    ? { path: options.image }
    : options.image;
  if (!spec || typeof spec !== "object" || !spec.path) return null;
  try {
    const template = await decodeImage(spec.path);
    return backend.wait({ ...options, image: { ...spec, template } });
  } catch {
    return null;
  }
}

async function saveImage(image, path, format) {
  if (!path) return {};
  const codec = imageCodec(format, path);
  if (!codec) return {};
  const bytes = encodeImage(image, codec);
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

const ACTIONS = { ...backend, ocr, wait };
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
      data: encodeImage(image, "png"),
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
