import { connectLocalSender } from './local-receiver.js';
import { LocalSenderQueue } from './local-sender-queue.js';

let transport, queue, port, timer, stopped = false;
function stop() {
  stopped = true; clearInterval(timer); queue?.close(); port?.close(); transport?.close();
}
self.onmessage = async ({ data }) => {
  if (data.type === 'stop') { stop(); return; }
  if (data.type === 'port') {
    if (stopped || !queue) { data.port.close(); return; }
    port = data.port; port.onmessage = event => queue.accept(event.data); return;
  }
  if (data.type !== 'connect' || transport || stopped) return;
  if (!self.WebTransport) { self.postMessage({ type: 'unsupported' }); return; }
  try {
    const connection = await connectLocalSender(data.config);
    transport = connection.transport;
    if (stopped) { transport.close(); return; }
    const closed = info => { if (!stopped) self.postMessage({ type: 'closed', deliberate: info?.closeCode === 1 || info?.sessionErrorCode === 1 }); stop(); };
    queue = new LocalSenderQueue(connection.writer, () => closed());
    transport.closed.then(closed, closed);
    timer = setInterval(() => self.postMessage({ type: 'stats', stats: queue.stats }), 500);
    self.postMessage({ type: 'ready' });
  } catch (e) { if (!stopped) self.postMessage({ type: 'error', message: e.message }); stop(); }
};
