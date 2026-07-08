const { resolveProfile } = require('../profiles');
const { parseFrame } = require('./parsers');
const { createProjectLineOrderRegistry } = require('../line/projectLineOrders');

class ProtocolRegistry {
  constructor(profiles = {}, options = {}) {
    this.profiles = new Map();
    this.lineOrders = options.lineOrders || createProjectLineOrderRegistry(options.extraLineOrders || {});
    Object.keys(profiles).forEach((sensorType) => {
      this.registerProfile(sensorType, profiles[sensorType]);
    });
  }

  registerProfile(sensorType, profile = {}) {
    if (!sensorType) {
      throw new Error('sensorType is required');
    }
    const resolved = resolveProfile(sensorType, profile);
    this.profiles.set(sensorType, resolved);
    return resolved;
  }

  getProfile(sensorType, override = {}) {
    const registered = this.profiles.get(sensorType);
    if (registered) {
      return resolveProfile(sensorType, { ...registered, ...override });
    }
    return resolveProfile(sensorType, override);
  }

  parse(sensorType, buffer, context = {}) {
    const profile = this.getProfile(sensorType, context.profile || {});
    return parseFrame(buffer, profile, {
      ...context,
      lineOrders: context.lineOrders || this.lineOrders,
    });
  }
}

module.exports = {
  ProtocolRegistry,
};
