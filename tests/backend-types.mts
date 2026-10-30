// Compile-only smoke checks: relative imports and package subpath exports.
import { BackendSdkClient, type BackendFrame } from '../web/index.js';
import { BackendSdkClient as NodeClient, Shroom } from '../node/index.js';
import { BackendSdkClient as PackageClient } from 'shroom-sdk/backend';
import { BackendSdkClient as PackageNodeClient } from 'shroom-sdk/node';
import { BackendSdkClient as PackageWebClient } from 'shroom-sdk/web';

const client = new BackendSdkClient({ headers: { 'x-test': 'example' }, WebSocketImpl: WebSocket });
client.on('frame', (frame: BackendFrame) => console.log(frame.channelId, frame.value));
client.on('error', (error) => console.log(error.message));
client.once('open', () => client.subscribe(['sit']));
void client.request<{ ok: boolean }>('/status', { signal: new AbortController().signal });
void Shroom.connect({ path: 'COM3' });
void [new NodeClient(), new PackageClient(), new PackageNodeClient(), new PackageWebClient()];
