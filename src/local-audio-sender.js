import { connectLocalSender } from './local-receiver.js';
import { LocalSenderQueue } from './local-sender-queue.js';
import { LocalAudioTiming } from './local-audio-timing.js';

function workerSender(config, onStats, makeWorker, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled.', 'AbortError')); return; }
    const worker = makeWorker(); let ready = false, stopped = false, finish;
    const closed = new Promise(resolveClosed => { finish = resolveClosed; });
    const close = () => { if (stopped) return; stopped = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); finish({ closeCode: 1 }); };
    const abort = () => { if (!ready) reject(new DOMException('Cancelled.', 'AbortError')); close(); };
    const fail = message => { if (!ready) reject(new Error(message)); else finish({}); close(); };
    const timer = setTimeout(() => fail('Cannot reach the local receiver. Check local network access and use the same Wi-Fi.'), 32000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    onStats({ path: 'Worker', sent: null, dropped: null });
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

export async function openLocalAudioSender(config, onStats, contextAge, makeWorker = typeof Worker === 'function' ? () => new Worker(new URL('./local-sender-worker.js', import.meta.url), { type: 'module' }) : null, signal) {
  if (makeWorker) {
    const sender = await workerSender(config, onStats, makeWorker, signal);
    if (sender) return sender;
  }
  // Compatibility only when the worker API explicitly lacks WebTransport.
  // Do not retry a rejected network/permission request on a different thread.
  onStats({ path: 'Page', sent: null, dropped: null });
  const { transport, writer } = await connectLocalSender(config, signal);
  let finish; const failed = new Promise(resolve => { finish = resolve; });
  const timing = new LocalAudioTiming(transport);
  const queue = new LocalSenderQueue(timing.writer(writer), () => finish({}), { stale: data => contextAge(data) > .03 });
  const publish = () => { timing.poll(); timing.publish(queue.stats); onStats({ path: 'Page', ...queue.stats, ...timing.snapshot() }); };
  const timer = setInterval(publish, 500); publish();
  const close = () => { clearInterval(timer); queue.close(); timing.close(); transport.close(); signal?.removeEventListener('abort', close); };
  signal?.addEventListener('abort', close, { once: true });
  if (signal?.aborted) { close(); throw new DOMException('Cancelled.', 'AbortError'); }
  return {
    closed: Promise.race([transport.closed, failed]),
    close,
    attach(worklet) { worklet.port.onmessage = ({ data }) => queue.accept(data); },
  };
}
