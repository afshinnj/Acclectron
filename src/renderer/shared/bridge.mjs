// Temporary adapter for classic shared names while renderer features move to
// explicit imports and exports. Accessor bindings stay live across modules.
export function publishRendererBindings(target, { constants = {}, mutable = {}, functions = {} } = {}) {
  for (const [name, value] of Object.entries(constants)) {
    Object.defineProperty(target, name, {
      configurable: true,
      enumerable: true,
      value,
      writable: true
    });
  }

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
