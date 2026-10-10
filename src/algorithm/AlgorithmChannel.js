const { EventEmitter } = require('events');
const { calculatePressureStats } = require('../utils/stats');

function selectFrameData(frame = {}) {
  if (Array.isArray(frame.pressureData)) return frame.pressureData;
  if (Array.isArray(frame.matrixData)) return frame.matrixData;
  return Array.isArray(frame.data) ? frame.data : [];
}

function createPressureStatsAlgorithm(options = {}) {
  return (data) => calculatePressureStats(data, options);
}

class AlgorithmChannel extends EventEmitter {
  constructor(options = {}) {
    super();
    this.errorMode = options.errorMode === 'throw' ? 'throw' : 'continue';
    this.algorithms = new Map();
    Object.entries(options.algorithms || {}).forEach(([name, definition]) => {
      if (typeof definition === 'function') {
        this.register(name, definition);
      } else if (definition && typeof definition.handler === 'function') {
        this.register(name, definition.handler, definition);
      }
    });
  }

  register(name, handler, options = {}) {
    if (!name || typeof name !== 'string') throw new Error('algorithm name is required');
    if (typeof handler !== 'function') throw new Error(`algorithm handler must be a function: ${name}`);
    this.algorithms.set(name, {
      name,
      handler,
      enabled: options.enabled !== false,
      select: typeof options.select === 'function' ? options.select : selectFrameData,
      when: typeof options.when === 'function' ? options.when : null,
    });
    return this;
  }

  unregister(name) {
    return this.algorithms.delete(name);
  }

  enable(name, enabled = true) {
    const algorithm = this.algorithms.get(name);
    if (!algorithm) return false;
    algorithm.enabled = Boolean(enabled);
    return true;
  }

  list() {
    return [...this.algorithms.values()].map(({ name, enabled }) => ({ name, enabled }));
  }

  process(frame, context = {}) {
    if (!frame || typeof frame !== 'object') return frame;
    const algorithmResults = { ...(frame.algorithmResults || {}) };
    const output = { ...frame, algorithmResults };

    for (const algorithm of this.algorithms.values()) {
      if (!algorithm.enabled || (algorithm.when && !algorithm.when(output, context))) continue;
      try {
        const input = algorithm.select(output, context);
        const result = algorithm.handler(input, {
          ...context,
          frame: output,
          results: algorithmResults,
          name: algorithm.name,
        });
        if (result && typeof result.then === 'function') {
          throw new Error(`algorithm must be synchronous: ${algorithm.name}`);
        }
        algorithmResults[algorithm.name] = result;
        this.emit('result', { name: algorithm.name, result, frame: output, context });
      } catch (error) {
        const payload = { name: algorithm.name, error, frame: output, context };
        this.emit('algorithmError', payload);
        if (this.errorMode === 'throw') throw error;
        algorithmResults[algorithm.name] = {
          ok: false,
          error: error.message || String(error),
        };
      }
    }

    return output;
  }
}

module.exports = {
  AlgorithmChannel,
  createPressureStatsAlgorithm,
  selectFrameData,
};
