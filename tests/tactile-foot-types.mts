import { type TactileFootFrame, connectTactileFoot as connectWebTactileFoot } from 'shroom-sdk';
import { Shroom, connectTactileFoot, connectProduct, scanProductPorts } from 'shroom-sdk/node';
import { readProduct } from 'shroom-sdk/quick-flow';

/** Compile-only checks for the new raw-data contract across the public package entry points. */
async function tactileFootTypes() {
  const direct = await connectTactileFoot();
  const explicit = await Shroom.connectTactileFoot({ path: 'COM3', side: 'right' });
  const alias = await readProduct({ product: 'foot', onData(frame) {
    const data: TactileFootFrame = frame;
    const product: 'footVideo' = data.product;
    const protocol: 'segmented' = data.protocol;
    const packetType: 3 | 4 = data.packetType;
    const raw: Uint8Array = data.raw;
    const pressure: Uint8Array = data.pressure;
    const rows: 10 = data.rows;
    const columns: 6 = data.cols;
    const imuRaw: Uint8Array = data.imu.raw;
    const packets: [Uint8Array, Uint8Array] = data.rawPackets;
    void [product, protocol, packetType, raw, pressure, rows, columns, imuRaw, packets];
    // @ts-expect-error Segment ordinals are not a device sample sequence.
    const sequence: number = data.sequence;
    void sequence;
  } });
  const canonical = await readProduct({ product: 'footVideo', side: 'auto', scan: { paths: ['COM4'], timeoutMs: 100 } });
  const lowerLevel = await connectProduct({ product: 'foot', side: 'left', onData(frame) {
    const data: TactileFootFrame = frame;
    void data.rawPackets;
  } });
  direct.onData(frame => { const data: TactileFootFrame = frame; void data.packetType; });
  canonical.onData(frame => { const data: TactileFootFrame = frame; void data.imu.raw; });
  const scanned = await scanProductPorts({ product: 'foot' });
  const canonicalScan = await Shroom.scanProductPorts({ product: 'footVideo', side: 'right' });
  const gloveScan = await scanProductPorts();
  const footId: 'footVideo' | undefined = scanned.devices[0]?.product;
  const canonicalId: 'footVideo' | undefined = canonicalScan.devices[0]?.product;
  const defaultId: 'handGloveSegmented' | undefined = gloveScan.devices[0]?.product;
  void [footId, canonicalId, defaultId];
  await Promise.all([direct.close(), explicit.close(), alias.close(), canonical.close(), lowerLevel.close()]);
}
void tactileFootTypes;

// @ts-expect-error The side must be a known foot side or the Node automatic mode.
void connectTactileFoot({ side: 'both' });
// @ts-expect-error The product's serial baud rate cannot be overridden.
void connectTactileFoot({ baudRate: 115200 });
// @ts-expect-error The quick-flow entry uses the same fixed product protocol.
void readProduct({ product: 'foot', baudRate: 115200 });
// @ts-expect-error The tactile-foot protocol is not the legacy 12-bit insole format.
void connectProduct({ product: 'footVideo', protocol: '12bit' });
// @ts-expect-error Browser direct serial connections require an explicit side.
void connectWebTactileFoot({ side: 'auto' });
// @ts-expect-error Browser direct serial connections do not enumerate Node OS paths.
void connectWebTactileFoot({ side: 'left', path: 'COM3' });
