import { connectLocalSender } from './local-receiver.js';
import { LocalSenderQueue } from './local-sender-queue.js';

function workerSender(config, onStats, makeWorker) {
  return new Promise((resolve, reject) => {
    const worker = makeWorker(); let ready = false, stopped = false, finish;
    const closed = new Promise(resolveClosed => { finish = resolveClosed; });
    const close = () => { if (stopped) return; stopped = true; clearTimeout(timer); worker.terminate(); finish({ closeCode: 1 }); };
    const fail = message => { if (!ready) reject(new Error(message)); else finish({}); close(); };
    const timer = setTimeout(() => fail('Cannot reach the local receiver. Check local network access and use the same Wi-Fi.'), 32000);
    worker.onerror = () => fail('Local audio sender stopped. Refresh the page and request again.');
    worker.onmessage = ({ data }) => {
      if (stopped) return;
      if (data.type === 'unsupported') { close(); resolve(null); }
      else if (data.type === 'error') fail(data.message || 'Local audio could not connect.');
      else if (data.type === 'closed') {
        if (!ready) reject(new Error('Local audio connection closed.'));
        finish(data.deliberate ? { closeCode: 1 } : {}); close();
      } else if (data.type === 'stats') onStats({ path: 'Worker', ...data.stats });
      else if (data.type === 'ready') {
        ready = true; clearTimeout(timer); onStats({ path: 'Worker', sent: 0, dropped: 0 });
        resolve({ close, closed, attach(worklet) {
          if (stopped) return;
          const channel = new MessageChannel();
          worker.postMessage({ type: 'port', port: channel.port1 }, [channel.port1]);
          worklet.port.postMessage({ type: 'sender-port', port: channel.port2 }, [channel.port2]);
        } });
      }
    };
    worker.postMessage({ type: 'connect', config });
  });
}

export async function openLocalAudioSender(config, onStats, contextAge, makeWorker = typeof Worker === 'function' ? () => new Worker(new URL('./local-sender-worker.js', import.meta.url), { type: 'module' }) : null) {
  if (makeWorker) {
    const sender = await workerSender(config, onStats, makeWorker);
    if (sender) return sender;
  }
  // Compatibility only when the worker API explicitly lacks WebTransport.
  // Do not retry a rejected network/permission request on a different thread.
  const { transport, writer } = await connectLocalSender(config);
  let finish; const failed = new Promise(resolve => { finish = resolve; });
  const queue = new LocalSenderQueue(writer, () => finish({}), { stale: data => contextAge(data) > .03 });
  const publish = () => onStats({ path: 'Page', ...queue.stats });
  const timer = setInterval(publish, 500); publish();
  return {
    closed: Promise.race([transport.closed, failed]),
    close() { clearInterval(timer); queue.close(); transport.close(); },
    attach(worklet) { worklet.port.onmessage = ({ data }) => queue.accept(data); },
  };
}
