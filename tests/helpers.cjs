// Yield to the next event-loop turn after the current promise/mutation jobs drain.
exports.flush = () => new Promise(resolve => setImmediate(resolve));
