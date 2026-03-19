function missingBinding(name, kind) {
  throw new Error(`Missing legacy ${kind} binding: ${name}`);
}

export function bindWindowState(names) {
  const bindings = {};

  for (const name of names) {
    Object.defineProperty(bindings, name, {
      enumerable: true,
      configurable: false,
      get() {
        return window[name];
      },
      set(value) {
        window[name] = value;
      },
    });
  }

  return bindings;
}

export function bindWindowFunctions(names) {
  const bindings = {};

  for (const name of names) {
    bindings[name] = (...args) => {
      const fn = window[name];
      if (typeof fn !== "function") {
        missingBinding(name, "function");
      }
      return fn(...args);
    };
  }

  return bindings;
}

export function bindWindowValue(name) {
  return {
    get() {
      return window[name];
    },
    set(value) {
      window[name] = value;
      return value;
    },
  };
}

export function listAvailable(names) {
  return names.filter((name) => name in window);
}
