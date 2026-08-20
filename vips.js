import { createRequire } from "node:module";

if (false) await import("npm:sharp");

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
let library;

function resolveLib() {
  let sharp;
  try {
    sharp = import.meta.resolve("sharp");
  } catch {
    sharp = import.meta.resolve("npm:sharp");
  }
  const require = createRequire(sharp);
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
  return path;
}

function loadVips() {
  if (library) return library;
  library = Deno.dlopen(resolveLib(), VIPS_SYMBOLS);
  if (library.symbols.vips_init(cString("auto.js")) !== 0) {
    library.close();
    library = null;
    throw new Error("Could not initialize libvips");
  }
  library.symbols.vips_cache_set_max(0);
  return library;
}

function gValue(type) {
  const value = new Uint8Array(24);
  loadVips().symbols.g_value_init(value, type);
  return value;
}

export function imageCodec(format, path) {
  const codec = String(format ?? path?.match(/\.(png|webp)$/i)?.[1] ?? "webp")
    .toLowerCase();
  return codec === "png" || codec === "webp" ? codec : null;
}

function imageInput(symbols, operation, image) {
  const input = gValue(symbols.vips_image_get_type());
  symbols.g_value_set_object(input, image);
  symbols.g_object_set_property(operation, cString("in"), input);
  symbols.g_value_unset(input);
}

function operationImage(symbols, operation) {
  const output = gValue(symbols.vips_image_get_type());
  try {
    symbols.g_object_get_property(operation, cString("out"), output);
    return symbols.g_value_get_object(output);
  } finally {
    symbols.g_value_unset(output);
  }
}

function unrefOperation(symbols, operation, built) {
  if (built) {
    symbols.vips_object_unref_outputs(built);
    symbols.g_object_unref(built);
    if (built !== operation) symbols.g_object_unref(operation);
  } else if (operation) {
    symbols.g_object_unref(operation);
  }
}

export function encodeImage(
  { rect: { width, height }, data },
  codec,
  scale = 1,
) {
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

  let resize;
  let resized;
  let source = image;
  let operation;
  let built;
  try {
    if (scale !== 1) {
      resize = symbols.vips_operation_new(cString("resize"));
      if (!resize) throw new Error("Could not create libvips resize operation");
      imageInput(symbols, resize, image);
      symbols.vips_object_set_argument_from_string(
        resize,
        cString("scale"),
        cString(String(scale)),
      );
      resized = symbols.vips_cache_operation_build(resize);
      if (!resized) throw new Error("Could not resize image");
      source = operationImage(symbols, resized);
      if (!source) throw new Error("Could not read resized image");
    }

    operation = symbols.vips_operation_new(cString(`${codec}save_buffer`));
    if (!operation) {
      throw new Error(`Could not create libvips ${codec} encoder`);
    }
    imageInput(symbols, operation, source);
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
    unrefOperation(symbols, operation, built);
    unrefOperation(symbols, resize, resized);
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

export async function decodeImage(
  source,
  rect = {},
  grayscale = false,
  format,
) {
  const data = typeof source === "string"
    ? await Deno.readFile(source)
    : source;
  const codec = typeof source === "string"
    ? imageCodec(format, source)
    : encodedCodec(data, format);
  if (!codec) throw new Error("Unsupported image format");
  return decodeBytes(data, codec, rect, grayscale);
}

export const vips = {
  get lib() {
    return resolveLib();
  },
  imageCodec,
  encodeImage,
  decodeImage,
};
