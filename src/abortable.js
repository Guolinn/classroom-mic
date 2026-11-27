// Cancel waiting without allowing a late completion to restart an old turn.
// The caller still owns resource cleanup and must check its speaking grant.
export function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => { signal.removeEventListener('abort', abort); callback(value); };
    const abort = () => finish(reject, new DOMException('Cancelled.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
    if (signal.aborted) abort();
  });
}
