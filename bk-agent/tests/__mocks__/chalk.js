// CJS mock for chalk v5 (pure ESM) — returns strings unchanged in test environment.
const proxy = new Proxy(function chalk(...args) {
  return args[0] != null ? String(args[0]) : '';
}, {
  get(target, prop) {
    if (prop === '__esModule' || prop === 'default') return proxy;
    if (prop === 'level') return 3;
    if (prop === 'supportsColor') return { hasBasic: true, has256: true, has16m: true };
    if (prop === 'hex' || prop === 'bgHex') {
      return function () { return proxy; };
    }
    return proxy;
  }
});

module.exports = proxy;
module.exports.default = proxy;
