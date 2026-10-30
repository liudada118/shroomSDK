import { Shroom, type GloveFrame, type RecordingSession } from 'shroom-sdk';
import { Shroom as NodeShroom } from 'shroom-sdk/node';

/** Check the documented product-to-browser quick path without running hardware. */
async function quickPath() {
  const glove = await NodeShroom.connectGlove({ path: 'COM3', side: 'left' });
  const server = await NodeShroom.serveDevice(glove, { port: 19999, recordingsDir: './recordings' });
  const stream = await Shroom.connectStream<GloveFrame>({ port: server.port });
  stream.onData((frame) => console.log(frame.fingers.index.pulp.raw[0]));
  const view = Shroom.createProductView('#view', { source: stream });
  const recording: RecordingSession = await stream.startRecording({ label: '握拳' });
  const stopped = await stream.stopRecording();
  if (stopped) stream.downloadRecording(stopped.id, { format: 'csv' });
  void stream.getRecordingUrl(recording.id, { format: 'jsonl' });
  view.destroy();
  stream.close();
  await server.close();
  await glove.close();
}
void quickPath;

// @ts-expect-error A label is required for a new recording session.
void Shroom.connectStream().then((stream) => stream.startRecording({}));
// @ts-expect-error Downloads expose only the implemented CSV and JSONL formats.
void Shroom.connectStream().then((stream) => stream.downloadRecording('id', { format: 'xlsx' }));
// @ts-expect-error A recording ID must be selected explicitly; there is no latest-session default.
void Shroom.connectStream().then((stream) => stream.downloadRecording());
