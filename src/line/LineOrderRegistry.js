class LineOrderRegistry {
  constructor(lineOrders = {}) {
    this.lineOrders = new Map();
    Object.entries(lineOrders).forEach(([name, handler]) => {
      this.register(name, handler);
    });
  }

  register(name, handler) {
    if (!name) {
      throw new Error('line order name is required');
    }
    if (typeof handler !== 'function') {
      throw new Error(`line order "${name}" must be a function`);
    }
    this.lineOrders.set(name, handler);
    return handler;
  }

  has(name) {
    return this.lineOrders.has(name);
  }

  get(name) {
    return this.lineOrders.get(name);
  }

  list() {
    return [...this.lineOrders.keys()].sort();
  }

  apply(name, data, context = {}) {
    const handler = this.get(name);
    if (!handler) {
      throw new Error(`line order "${name}" is not registered`);
    }
    return handler(Array.isArray(data) ? [...data] : data, context);
  }
}

module.exports = {
  LineOrderRegistry,
};
