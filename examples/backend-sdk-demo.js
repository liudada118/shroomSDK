#!/usr/bin/env node

const { BackendSdkClient } = require('..');

function parseArgs(argv) {
  const options = {
    channels: ['sit'],
    durationMs: 10000,
    httpBaseUrl: process.env.SHROOM_SDK_HTTP || 'http://127.0.0.1:19245',
    wsUrl: process.env.SHROOM_SDK_WS || 'ws://127.0.0.1:19999',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--http') {
      options.httpBaseUrl = next;
      index += 1;
    } else if (arg === '--ws') {
      options.wsUrl = next;
      index += 1;
    } else if (arg === '--channels') {
      options.channels = String(next || '').split(',').map((item) => item.trim()).filter(Boolean);
      index += 1;
    } else if (arg === '--duration') {
      options.durationMs = Number(next) || options.durationMs;
      index += 1;
    } else if (arg === '--sensor') {
      options.sensorType = next;
      index += 1;
    } else if (arg === '--open') {
      const [role, port] = String(next || '').split('=');
      options.openSerial = { role, port };
      index += 1;
    } else if (arg === '--start-collection') {
      options.startCollection = true;
      options.collectionName = next && !next.startsWith('--') ? next : `sdk_demo_${Date.now()}`;
      if (next && !next.startsWith('--')) index += 1;
    } else if (arg === '--help') {
      options.help = true;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Usage:
  npm run sdk:demo -- [options]

Safe read-only demo:
  npm run sdk:demo

Options:
  --http http://127.0.0.1:19245   Backend HTTP control API
  --ws ws://127.0.0.1:19999       Realtime WebSocket URL
  --channels sit,back             Realtime channels to subscribe
  --duration 10000                Realtime listen duration in milliseconds
  --sensor hand0205               Set current sensor type before subscribing
  --open sit=COM3                 Open a serial port explicitly
  --start-collection demo_name    Start collection; demo stops it before exit
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const client = new BackendSdkClient({
    httpBaseUrl: options.httpBaseUrl,
    wsUrl: options.wsUrl,
  });

  console.log('[sdk-demo] loading backend contract...');
  const contract = await client.getContract();
  console.log('[sdk-demo] contract:', {
    apiVersion: contract.apiVersion,
    contractVersion: contract.contractVersion,
    serialRoles: contract.serial?.roles,
  });

  const [ports, serialStatus, displaySystems] = await Promise.all([
    client.listSerialPorts().catch((error) => ({ error: error.message })),
    client.getSerialStatus().catch((error) => ({ error: error.message })),
    client.listDisplaySystems().catch((error) => ({ error: error.message })),
  ]);

  console.log('[sdk-demo] serial ports:', ports);
  console.log('[sdk-demo] serial status:', serialStatus);
  console.log('[sdk-demo] display systems:', displaySystems);

  if (options.sensorType) {
    console.log('[sdk-demo] setting sensor type:', options.sensorType);
    console.log(await client.setSensorType(options.sensorType));
  }

  if (options.openSerial?.role && options.openSerial?.port) {
    console.log('[sdk-demo] opening serial:', options.openSerial);
    console.log(await client.openSerial(options.openSerial));
  }

  if (options.startCollection) {
    console.log('[sdk-demo] starting collection:', options.collectionName);
    console.log(await client.startCollection({
      name: options.collectionName,
      frequencyHz: 12,
    }));
  }

  let frameCount = 0;
  client.on('open', () => {
    console.log('[sdk-demo] websocket connected, subscribed:', options.channels);
  });
  client.on('frame', (frame) => {
    frameCount += 1;
    if (frameCount <= 5) {
      console.log('[sdk-demo] frame:', {
        channelId: frame.channelId,
        portId: frame.portId,
        metric: frame.metric,
        valueLength: Array.isArray(frame.value) ? frame.value.length : undefined,
        timestamp: frame.timestamp,
      });
    }
  });
  client.on('message', (message) => {
    if (message?.type && message.type !== 'frame') {
      console.log('[sdk-demo] ws message:', message.type);
    }
  });
  client.on('error', (error) => {
    console.error('[sdk-demo] websocket error:', error.message || error);
  });

  client.connectRealtime({ channels: options.channels });
  await new Promise((resolve) => setTimeout(resolve, options.durationMs));
  client.disconnectRealtime();

  if (options.startCollection) {
    console.log('[sdk-demo] stopping collection');
    console.log(await client.stopCollection());
  }

  console.log('[sdk-demo] done:', { frameCount });
}

main().catch((error) => {
  console.error('[sdk-demo] failed:', error.message || error);
  process.exit(1);
});
