import { Shroom, ShroomError, ERROR_CODES, type SerialDiagnostics, type DeviceState } from 'shroom-sdk';
import { Shroom as NodeShroom, asShroomError } from 'shroom-sdk/node';

const mock = Shroom.mock({ rows: 2, cols: 2 });
const state: DeviceState = mock.state;
const diagnostics: SerialDiagnostics = mock.getDiagnostics();
const off = mock.onError((error: ShroomError) => console.log(error.code, error.stage, error.suggestion));
const error = new NodeShroom.ShroomError(ERROR_CODES.INVALID_CONFIG, 'bad config', { stage: 'configure' });
void NodeShroom.connect({ path: 'COM3' }).then((device) => device.onError((reason) => console.log(reason.toJSON())));
void Shroom.connect({ baudRate: 1000000 });
void [state, diagnostics, error, asShroomError(new Error('test')), off, mock.close()];
