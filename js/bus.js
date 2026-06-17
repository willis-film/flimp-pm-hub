// bus.js — the application function namespace.
//
// The original single-file build relied on every handler being a global, so
// any function could call any other by bare name. That creates a dense web of
// mutual references (render() calls panel handlers; panel handlers call
// render()) which would be a circular import nightmare if expressed as ES
// `import` statements.
//
// Instead, each module registers its public functions onto this single mutable
// object `A` via register(). Cross-module calls go through `A.fnName()`, which
// resolves at call time — no static import cycle. app.js also mirrors every
// registered function onto `window` so the inline on* handlers in the markup
// (and in render()'s generated HTML strings) keep working byte-for-byte.

export const A = {};

export function register(fns) {
  Object.assign(A, fns);
}
