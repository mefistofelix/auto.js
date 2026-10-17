// Keep native signatures and pointer semantics identical across Deno and Bun.
export const runtime = globalThis.Deno ?? await bunRuntime();

async function bunRuntime() {
  if (!globalThis.Bun) throw new Error("auto.js requires Deno or Bun");
  const ffi = await import("bun:" + "ffi");
  const fs = await import("node:fs");
  const windows = process.platform === "win32";
  const darwin = process.platform === "darwin" ? darwinLoader(ffi) : null;
  const wideInteger = (type) => ["usize", "isize", "u64", "i64"].includes(type);
  const nativeType = (type) => {
    if (type === "buffer") return "buffer";
    if (type === "pointer") return "u64";
    if (type === "usize") return "u64";
    if (type === "isize") return "i64";
    return type;
  };
  const signature = (definition) => ({
    args: definition.parameters.map(nativeType),
    returns: nativeType(definition.result),
  });
  const fromNative = (type, value) => {
    if (type === "pointer") {
      return value ? BigInt(value) : null;
    }
    return wideInteger(type) ? BigInt(value) : value;
  };
  const toNative = (type, value) => {
    if (type === "buffer") return value ?? new Uint8Array(0);
    // Preserve Win32 pseudo-handles and Objective-C tagged object pointers.
    if (type === "pointer") {
      return BigInt.asUintN(64, BigInt(value ?? 0));
    }
    return value;
  };
  const wrap = (fn, definition) => (...args) =>
    fromNative(
      definition.result,
      fn(...definition.parameters.map((type, i) => toNative(type, args[i]))),
    );

  function dlopen(path, definitions) {
    if (darwin) return darwin(path, definitions, signature, wrap);
    const required = {};
    for (const [name, definition] of Object.entries(definitions)) {
      if (!definition.optional) required[name] = signature(definition);
    }
    const library = ffi.dlopen(path, required);
    const libraries = [library];
    const symbols = {};
    try {
      for (const [name, definition] of Object.entries(definitions)) {
        let fn = library.symbols[name];
        if (definition.optional) {
          try {
            const optional = ffi.dlopen(path, {
              [name]: signature(definition),
            });
            libraries.push(optional);
            fn = optional.symbols[name];
          } catch {
            symbols[name] = null;
            continue;
          }
        }
        symbols[name] = wrap(fn, definition);
      }
    } catch (error) {
      for (const opened of libraries) opened.close();
      throw error;
    }
    return {
      symbols,
      close: () => libraries.forEach((opened) => opened.close()),
    };
  }

  class UnsafeCallback {
    constructor(definition, callback) {
      this.callback = new ffi.JSCallback(
        (...args) =>
          toNative(
            definition.result,
            callback(...definition.parameters.map((type, i) =>
              fromNative(type, args[i])
            )),
          ),
        signature(definition),
      );
      this.pointer = this.callback.ptr;
    }

    close() {
      this.callback.close();
      this.pointer = null;
    }
  }

  class UnsafeFnPointer {
    constructor(pointer, definition) {
      this.call = wrap(
        new ffi.CFunction({ ...signature(definition), ptr: pointer }),
        definition,
      );
    }
  }

  class UnsafePointerView {
    constructor(pointer) {
      this.pointer = pointer;
    }

    getArrayBuffer(length, offset = 0) {
      return ffi.toArrayBuffer(Number(this.pointer), offset, length);
    }

    getPointer(offset = 0) {
      return fromNative("pointer", ffi.read.u64(this.pointer, offset));
    }

    getUint16(offset = 0) {
      return ffi.read.u16(this.pointer, offset);
    }

    getCString(offset = 0) {
      return String(new ffi.CString(Number(this.pointer), offset));
    }
  }

  return {
    build: {
      os: windows ? "windows" : process.platform,
      arch: process.arch === "x64"
        ? "x86_64"
        : process.arch === "arm64"
        ? "aarch64"
        : process.arch,
    },
    args: process.argv.slice(2),
    env: { get: (name) => process.env[name] },
    mkdirSync: fs.mkdirSync,
    readLinkSync: fs.readlinkSync,
    readFile: fs.promises.readFile,
    readTextFile: (path) => fs.promises.readFile(path, "utf8"),
    writeFile: fs.promises.writeFile,
    dlopen,
    UnsafeCallback,
    UnsafeFnPointer,
    UnsafePointerView,
    UnsafePointer: {
      create: (value) => fromNative("pointer", value),
      of: (value) =>
        value.byteLength ? fromNative("pointer", ffi.ptr(value)) : null,
      value: (value) => BigInt(value ?? 0),
    },
  };
}

// Bun cannot pass C structs by value. macOS ships libffi for the Quartz ABI,
// and libSystem resolves exported constants and Objective-C symbol aliases.
function darwinLoader(ffi) {
  const loader = ffi.dlopen("/usr/lib/libSystem.B.dylib", {
    dlopen: { args: ["buffer", "i32"], returns: "ptr" },
    dlsym: { args: ["ptr", "buffer"], returns: "u64" },
    dlclose: { args: ["ptr"], returns: "i32" },
  }).symbols;
  const cString = (value) => new TextEncoder().encode(`${value}\0`);
  const lookup = (handle, name) => loader.dlsym(handle, cString(name));
  let libffi;
  let typeHandle;

  function structFunction(pointer, definition) {
    if (!libffi) {
      const path = "/usr/lib/libffi.dylib";
      typeHandle = loader.dlopen(cString(path), 2);
      libffi = ffi.dlopen(path, {
        ffi_prep_cif: {
          args: ["buffer", "u32", "u32", "ptr", "buffer"],
          returns: "u32",
        },
        ffi_call: {
          args: ["buffer", "u64", "buffer", "buffer"],
          returns: "void",
        },
      }).symbols;
    }
    const storage = [];
    function typePointer(type) {
      if (type.struct) {
        const elements = new BigUint64Array(type.struct.length + 1);
        type.struct.forEach((member, i) =>
          elements[i] = BigInt(typePointer(member))
        );
        const descriptor = new Uint8Array(24);
        const view = new DataView(descriptor.buffer);
        view.setUint16(10, 13, true); // FFI_TYPE_STRUCT
        view.setBigUint64(16, BigInt(ffi.ptr(elements)), true);
        storage.push(elements, descriptor);
        return ffi.ptr(descriptor);
      }
      const name = {
        pointer: "pointer",
        buffer: "pointer",
        void: "void",
        u32: "uint32",
        usize: "uint64",
        f64: "double",
      }[type];
      if (!name) throw new Error(`Unsupported Quartz ABI type: ${type}`);
      return lookup(typeHandle, `ffi_type_${name}`);
    }
    const cif = new Uint8Array(64);
    const resultType = typePointer(definition.result);
    const types = BigUint64Array.from(
      definition.parameters,
      (type) => BigInt(typePointer(type)),
    );
    const abi = process.arch === "arm64" ? 1 : 2;
    if (libffi.ffi_prep_cif(cif, abi, types.length, resultType, types) !== 0) {
      throw new Error("Could not prepare Quartz struct ABI");
    }
    return (...args) => {
      const values = definition.parameters.map((type, i) => {
        if (type.struct) return args[i];
        if (type === "u32") return new Uint32Array([args[i]]);
        if (type === "f64") return new Float64Array([args[i]]);
        const value = type === "buffer" ? ffi.ptr(args[i]) : args[i];
        return new BigUint64Array([BigInt(value ?? 0)]);
      });
      const pointers = BigUint64Array.from(
        values,
        (value) => BigInt(ffi.ptr(value)),
      );
      const output = new Uint8Array(
        Math.max(8, (definition.result.struct?.length ?? 0) * 8),
      );
      libffi.ffi_call(cif, pointer, output, pointers);
      // Keep all buffers referenced by native pointers alive until ffi_call returns.
      for (const buffer of [...storage, types, ...values]) ffi.ptr(buffer);
      if (definition.result.struct) return output;
      if (definition.result === "pointer") {
        return ffi.read.u64(ffi.ptr(output)) || null;
      }
    };
  }

  return (path, definitions, signature, wrap) => {
    const handle = loader.dlopen(cString(path), 2);
    if (!handle) throw new Error(`Could not open ${path}`);
    const symbols = {};
    try {
      for (const [name, definition] of Object.entries(definitions)) {
        const pointer = lookup(handle, definition.name ?? name);
        if (!pointer) {
          if (definition.optional) {
            symbols[name] = null;
            continue;
          }
          throw new Error(`Could not resolve ${name} in ${path}`);
        }
        if (definition.type) {
          // Deno exposes a pointer static's address, not the pointer stored there.
          symbols[name] = pointer;
        } else if (
          definition.result.struct ||
          definition.parameters.some((type) => type.struct)
        ) {
          symbols[name] = structFunction(pointer, definition);
        } else {
          symbols[name] = wrap(
            new ffi.CFunction({ ...signature(definition), ptr: pointer }),
            definition,
          );
        }
      }
    } catch (error) {
      loader.dlclose(handle);
      throw error;
    }
    return { symbols, close: () => loader.dlclose(handle) };
  };
}
