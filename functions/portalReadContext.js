'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const reads = new AsyncLocalStorage();

// Share in-flight reads only inside one authorized request, never across accounts.
function withPortalReads(handler) {
  return (...args) => reads.run(new Map(), () => handler(...args));
}
function memoPortalRead(key, reader) {
  const cache = reads.getStore();
  if (!cache) return reader();
  if (!cache.has(key)) {
    const pending = Promise.resolve().then(reader).catch(error => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
  }
  return cache.get(key);
}
module.exports = { withPortalReads, memoPortalRead };
