// Non-interactive checks for both runtimes on all three native backends.
import { runtime } from "../runtime.js";
import { display_find, run, vips, window_find } from "../auto.js";
import { strict as assert } from "node:assert";

assert(Array.isArray(display_find()));
assert(Array.isArray(window_find({ limit: 1 })));

const scenario = await run([
  { state: { value: 42 } },
  { state: { copied: "$.state.value" } },
  { wait: 0 },
]);
assert.deepEqual(scenario.state, { value: 42, copied: 42 });

const pixels = new Uint8Array([
  0,
  0,
  255,
  255,
  0,
  255,
  0,
  255,
  255,
  0,
  0,
  255,
  32,
  64,
  128,
  255,
]);
const image = { rect: { width: 2, height: 2 }, data: pixels };
const png = vips.encodeImage(image, "png");
const decoded = await vips.decodeImage(png);
assert.deepEqual(new Uint8Array(decoded.data), pixels);
assert.equal(decoded.rect.width, 2);
assert.equal(decoded.rect.height, 2);
const webp = vips.encodeImage(image, "webp", 0.5);
const scaled = await vips.decodeImage(webp);
assert.equal(scaled.rect.width, 1);
assert.equal(scaled.rect.height, 1);

if (runtime.build.os === "darwin") {
  const rect = { struct: ["f64", "f64", "f64", "f64"] };
  const library = runtime.dlopen(
    "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics",
    { CGRectStandardize: { parameters: [rect], result: rect } },
  );
  try {
    const input = new Float64Array([20, 30, -10, -15]);
    const bytes = new Uint8Array(input.buffer);
    const result = library.symbols.CGRectStandardize(bytes);
    const output = new Float64Array(result.buffer, result.byteOffset, 4);
    assert.deepEqual(Array.from(output), [10, 15, 10, 15]);
  } finally {
    library.close();
  }
}

console.log(
  "Runtime, backend, scenario, PNG/WebP and native ABI checks passed",
);
