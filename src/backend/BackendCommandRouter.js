const { EventEmitter } = require('events');

function parseMessage(message) {
  if (Buffer.isBuffer(message)) {
    return JSON.parse(message.toString());
  }
  if (typeof message === 'string') {
    return JSON.parse(message);
  }
  return message || {};
}

class BackendCommandRouter extends EventEmitter {
  route(message) {
    const command = parseMessage(message);

    if (command.date != null) this.emit('license:setKey', command.date);
    if (command.file != null) this.emit('system:switch', command.file);
    if (command.baudRate != null) this.emit('system:setBaudRate', Number(command.baudRate));

    if (command.serialReset != null) this.emit('serial:list');
    if (command.sitPort != null) this.emit('serial:open', { channel: 'sit', portPath: command.sitPort });
    if (command.backPort != null) this.emit('serial:open', { channel: 'back', portPath: command.backPort });
    if (command.headPort != null) this.emit('serial:open', { channel: 'head', portPath: command.headPort });
    if (command.sitClose === true) this.emit('serial:close', { channel: 'sit' });
    if (command.backClose === true) this.emit('serial:close', { channel: 'back' });
    if (command.headClose === true) this.emit('serial:close', { channel: 'head' });

    if (command.resetZero === true) this.emit('zero:capture');
    if (command.resetZero === false) this.emit('zero:clear');

    if (command.colName != null) this.emit('capture:setName', command.colName);
    if (command.time != null) this.emit('capture:setName', command.time);
    if (command.colHZ != null) this.emit('capture:setHz', Number(command.colHZ));
    if (command.flag === true) this.emit('capture:start', command);
    if (command.flag === false) this.emit('capture:stop', command);

    if (command.getTime != null) this.emit('replay:load', command.getTime);
    if (command.local != null) this.emit('replay:setLocal', Boolean(command.local));
    if (command.play != null) this.emit('replay:setPlay', Boolean(command.play));
    if (command.value != null) this.emit('replay:setIndex', Number(command.value));
    if (command.speed != null) this.emit('replay:setSpeed', Number(command.speed));

    if (command.download != null) {
      this.emit('export:csv', {
        captureName: command.download,
        options: command.downloadOptions || {},
      });
    }

    return command;
  }
}

module.exports = {
  BackendCommandRouter,
  parseMessage,
};
