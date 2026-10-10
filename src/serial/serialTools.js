const {
  createSerialError,
  isPortBusyError,
  normalizeSerialError,
} = require('./errors');

const DEFAULT_BAUD_CANDIDATES = Object.freeze([115200, 921600, 1000000, 1500000, 3000000]);
const DEFAULT_BAUD_DEVICE_MAP = Object.freeze({
  115200: 'hand',
  921600: 'hand',
  1000000: 'sit',
  1500000: 'bed',
  3000000: 'foot',
});
const DEFAULT_DELIMITER = Buffer.from([0xaa, 0x55, 0x03, 0x99]);
const VALID_FRAME_LENGTHS = Object.freeze([18, 130, 146, 274, 1024, 1025, 4096, 4097]);
const DEFAULT_BAUD_DETECT_TIMEOUT_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSerialPortClass(options = {}) {
  if (options.SerialPortClass) return options.SerialPortClass;
  if (options.SerialPort) return options.SerialPort;
  return require('serialport').SerialPort;
}

function normalizeDelimiter(delimiter = DEFAULT_DELIMITER) {
  return Buffer.isBuffer(delimiter) ? Buffer.from(delimiter) : Buffer.from(delimiter);
}

function hasWchSignature(port = {}) {
  const source = [
    port.path,
    port.manufacturer,
    port.friendlyName,
    port.pnpId,
    port.vendorId,
    port.productId,
  ].filter(Boolean).join(' ').toUpperCase();

  return source.includes('WCH')
    || source.includes('CH34')
    || source.includes('USB-SERIAL')
    || source.includes('USB-ENHANCED-SERIAL')
    || source.includes('1A86');
}

function summarizePort(port = {}) {
  return {
    path: port.path || port.comName || '',
    manufacturer: port.manufacturer || '',
    serialNumber: port.serialNumber || '',
    pnpId: port.pnpId || '',
    vendorId: port.vendorId || '',
    productId: port.productId || '',
    friendlyName: port.friendlyName || '',
    locationId: port.locationId || '',
    isLikelySensorPort: hasWchSignature(port),
  };
}

function filterSerialPorts(ports = [], platform = process.platform) {
  if (platform === 'win32') return ports.filter(hasWchSignature);
  if (platform === 'darwin') {
    return ports.filter((port) => String(port.path || '').toLowerCase().includes('usb'));
  }
  return [...ports];
}

async function listSerialPorts(options = {}) {
  const SerialPortClass = getSerialPortClass(options);
  const ports = await SerialPortClass.list();
  return ports.map(summarizePort);
}

async function listDevicePorts(options = {}) {
  const ports = await listSerialPorts(options);
  return filterSerialPorts(ports, options.platform || process.platform);
}

function openRawPort(path, baudRate, options = {}) {
  const SerialPortClass = getSerialPortClass(options);
  return new SerialPortClass({ path, baudRate, autoOpen: false });
}

function tryBaudRate(path, baudRate, options = {}) {
  const delimiter = normalizeDelimiter(options.delimiter);
  const timeoutMs = Number(options.timeoutMs || DEFAULT_BAUD_DETECT_TIMEOUT_MS);
  const validFrameLengths = options.validFrameLengths || VALID_FRAME_LENGTHS;
  const allowUnknownFrameLength = options.allowUnknownFrameLength !== false;

  return new Promise((resolve, reject) => {
    let port;
    let timer;
    let settled = false;
    let delimiterFound = false;
    let bytesAfterDelimiter = 0;
    const slidingWindow = [];

    const closeAndSettle = (matched, error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);

      const settle = () => {
        if (error) reject(error);
        else resolve(matched);
      };

      try {
        port?.removeAllListeners?.('data');
        port?.removeAllListeners?.('error');
        if (port?.isOpen) {
          port.close(() => settle());
          return;
        }
      } catch {
        // Detection owns this temporary port; settling is more important than close diagnostics.
      }
      settle();
    };

    const pushAndMatch = (byte) => {
      slidingWindow.push(byte);
      if (slidingWindow.length > delimiter.length) slidingWindow.shift();
      return slidingWindow.length === delimiter.length
        && delimiter.every((expected, index) => slidingWindow[index] === expected);
    };

    try {
      port = openRawPort(path, baudRate, options);
      timer = setTimeout(() => closeAndSettle(delimiterFound), timeoutMs);
      port.on('error', (error) => {
        closeAndSettle(false, isPortBusyError(error) ? error : null);
      });
      port.open((openError) => {
        if (settled) {
          if (port.isOpen) port.close(() => {});
          return;
        }
        if (openError) {
          closeAndSettle(false, isPortBusyError(openError) ? openError : null);
          return;
        }

        port.on('data', (chunk) => {
          for (const byte of Buffer.from(chunk)) {
            if (!delimiterFound) {
              if (pushAndMatch(byte)) {
                delimiterFound = true;
                bytesAfterDelimiter = 0;
              }
              continue;
            }

            bytesAfterDelimiter += 1;
            if (pushAndMatch(byte)) {
              const frameLength = bytesAfterDelimiter - delimiter.length;
              const valid = validFrameLengths.includes(frameLength) || allowUnknownFrameLength;
              closeAndSettle(valid);
              return;
            }

            if (bytesAfterDelimiter > 8200) {
              closeAndSettle(true);
              return;
            }
          }
        });
      });
    } catch (error) {
      closeAndSettle(false, error);
    }
  });
}

async function detectBaudRate(path, options = {}) {
  const candidates = options.baudCandidates || DEFAULT_BAUD_CANDIDATES;
  for (const baudRate of candidates) {
    try {
      if (await tryBaudRate(path, baudRate, options)) return baudRate;
    } catch (error) {
      if (isPortBusyError(error)) {
        throw createSerialError('PORT_BUSY', { path, baudRate }, error);
      }
      options.onError?.(error, { path, baudRate, stage: 'detect_baud' });
    }
  }

  throw createSerialError('BAUD_FAIL', { path });
}

function normalizeWriteData(data, options = {}) {
  if (Buffer.isBuffer(data)) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Buffer.from(data);
  if (typeof data === 'string') return Buffer.from(data, options.encoding || 'utf8');
  throw new TypeError('serial write data must be a Buffer, typed array, byte array, or string');
}

function writeSerialPort(port, data, options = {}) {
  return new Promise((resolve, reject) => {
    if (!port?.isOpen) {
      reject(createSerialError('PORT_OFFLINE', options));
      return;
    }

    let buffer;
    try {
      buffer = normalizeWriteData(data, options);
    } catch (error) {
      reject(error);
      return;
    }

    port.write(buffer, (writeError) => {
      if (writeError) {
        reject(normalizeSerialError(writeError, 'WRITE_FAIL', options));
        return;
      }
      if (options.drain === false || typeof port.drain !== 'function') {
        resolve({ bytesWritten: buffer.length, buffer });
        return;
      }
      port.drain((drainError) => {
        if (drainError) reject(normalizeSerialError(drainError, 'WRITE_FAIL', options));
        else resolve({ bytesWritten: buffer.length, buffer });
      });
    });
  });
}

function withTimeout(promise, timeoutMs, error) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(error), timeoutMs);
    }),
  ]);
}

module.exports = {
  DEFAULT_BAUD_CANDIDATES,
  DEFAULT_BAUD_DETECT_TIMEOUT_MS,
  DEFAULT_BAUD_DEVICE_MAP,
  DEFAULT_DELIMITER,
  VALID_FRAME_LENGTHS,
  detectBaudRate,
  filterSerialPorts,
  getSerialPortClass,
  hasWchSignature,
  listDevicePorts,
  listSerialPorts,
  normalizeDelimiter,
  normalizeWriteData,
  openRawPort,
  sleep,
  summarizePort,
  tryBaudRate,
  withTimeout,
  writeSerialPort,
};
