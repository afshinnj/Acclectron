// Shared renderer runtime for feature modules during the gradual migration to
// explicit module APIs. Bindings live here rather than on window/globalThis.
export const renderer = {};

export function registerRendererBindings(target, { constants = {}, mutable = {}, functions = {} } = {}) {
  Object.assign(target, constants);

  for (const bindings of [mutable, functions]) {
    for (const [name, binding] of Object.entries(bindings)) {
      Object.defineProperty(target, name, {
        configurable: true,
        enumerable: true,
        get: binding.get,
        set: binding.set
      });
    }
  }
}
