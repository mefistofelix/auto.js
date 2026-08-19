## Engineering preferences

These principles apply across languages, runtimes, and frameworks.

### Simplicity and readability

- Optimize for cognitive simplicity first and line count second.
- Keep code minimal and readable. Do not use code golf or compress unrelated operations onto one line.
- Let each line express one clear idea.
- Prefer guard clauses for empty, error, and exceptional cases so the main path stays flat.
- Prefer structured data transformations over clever string manipulation.
- Use descriptive names. Do not introduce short aliases solely to reduce repetition.

### Native constructs and dependencies

- Prefer direct language, runtime, and standard-library features over wrappers or custom replacements.
- Do not introduce third-party dependencies without explicit approval.
- Rely on native validation, errors, and defaults instead of reimplementing them.
- Keep the origin of an operation visible when qualification improves clarity. Prefer repeating a short, meaningful qualified path such as `backend.foo` at each use instead of destructuring or aliasing it merely to remove repetition. Shorten an access path only when it is genuinely long, noisy, and low in semantic value. When several frequently used branches share a long prefix, alias the deepest common prefix that still has useful meaning, even if that prefix is two or three levels deep, and keep the branches below it visible. For example, prefer `const symbols = library.subsystem.symbols; symbols.open(); symbols.close(); symbols.read();` over destructuring `open`, `close`, and `read` into separate leaf aliases. Do not flatten a namespace just because several leaves are used. Keep the common-prefix alias as local as practical, but file-level scope is appropriate when that same prefix is used broadly throughout the file. Avoid redundant qualification when the imported symbol already communicates its origin.
- Do not hide ordinary public fields or attributes behind trivial accessors or properties.
- In languages with type inference, avoid redundant annotations. Keep types where required or where they clarify a public boundary.

### Abstractions and boundaries

- Add helpers, abstractions, validation layers, comments, or documentation only when they solve a concrete problem.
- Prefer a few obvious duplicated lines over an abstraction that hides semantics.
- Keep abstraction boundaries strict: lower layers expose generic representations; higher layers translate domain- or protocol-specific concepts.
- Generic parsers and formatters must not branch on concrete drivers unless that syntax belongs to the generic layer.
- At protocol boundaries, prefer a structured argument when a low-level function signature would otherwise keep growing.
- Assume established internal data contracts. Do not add machinery for every theoretical malformed input.

### Errors and concurrency

- Handle errors when they affect program logic or when additional context is actionable. Otherwise, let native errors propagate.
- Do not add broad catches, defensive checks, or fallback behavior merely to suppress possible errors.
- Do not wrap synchronous or blocking APIs in asynchronous functions unless real concurrency is required.
- When blocking work must coexist with asynchronous code, make the boundary explicit at the caller using the language's standard thread or executor mechanism.

---
