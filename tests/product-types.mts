import { Shroom, type GloveFrame, type HandPadFrame } from 'shroom-sdk';
import { Shroom as NodeShroom, connectProduct, listDeviceProducts } from 'shroom-sdk/node';

void NodeShroom.connectGlove({ path: 'COM3', side: 'left', onData(data) {
  const frame: GloveFrame = data;
  console.log(frame.side, frame.fingers.thumb.raw, frame.fingers.index.pulp.values[0], frame.palm.matrix);
  const sourceIndex: number = frame.fingers.little.sourceIndices[0];
  const rowLengths: number[] = frame.palm.rowLengths;
  void [sourceIndex, rowLengths, frame.pressureMatrix, frame.imu.raw];
} });
void NodeShroom.connectHandPad({ path: 'COM4', onData(data) {
  const frame: HandPadFrame = data;
  console.log(frame.values, frame.rows, frame.cols);
} });
void connectProduct({ product: 'handGloveFullPacket', side: 'right' }).then((device) => {
  device.onData((data) => console.log(data.imu.raw));
});
void Shroom.connectGlove({ side: 'right', filters: [{ usbVendorId: 0x1a86 }] });
void Shroom.connectProduct({ product: 'hand', onData: (data) => console.log(data.pressure) });
void listDeviceProducts();

// @ts-expect-error A glove must have an explicit side.
void NodeShroom.connectGlove({ path: 'COM3' });
// @ts-expect-error Product configuration cannot silently override the wire protocol.
void NodeShroom.connectHandPad({ baudRate: 115200 });
// @ts-expect-error The browser product API does not select an OS path.
void Shroom.connectGlove({ side: 'left', path: 'COM3' });
