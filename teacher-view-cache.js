(function (root) {
  'use strict';
  function create(options) {
    const pending = new Map();
    const now = options.now || Date.now;
    const prefix = options.prefix;
    let revision = 0;
    function storage() { return typeof options.storage === 'function' ? options.storage() : options.storage; }
    function owner() { return String(options.owner()); }
    function key(scope, account) { return prefix + (account || owner()) + ':' + scope; }
    function entries() {
      try { return Object.keys(storage()).filter(name => name.startsWith(prefix)); }
      catch (_) { return []; }
    }
    function get(scope) {
      try {
        const row = JSON.parse(storage().getItem(key(scope)) || 'null');
        if (!row || now() - row.savedAt >= row.ttl) return null;
        return row.value;
      } catch (_) { return null; }
    }
    function put(scope, value, ttl, account) {
      try {
        storage().setItem(key(scope, account), JSON.stringify({scope, value, savedAt:now(), ttl:ttl || options.ttl}));
        const rows = entries().map(name => {
          try { return {name, row:JSON.parse(storage().getItem(name))}; } catch (_) { return {name}; }
        }).sort((a,b) => (b.row && b.row.savedAt || 0) - (a.row && a.row.savedAt || 0));
        rows.forEach((entry,index) => {
          if (!entry.row || now() - entry.row.savedAt >= entry.row.ttl || index >= (options.maxEntries || 16)) storage().removeItem(entry.name);
        });
      } catch (_) { /* Storage denial must not prevent a network read. */ }
    }
    function invalidate(matches) {
      revision++;
      for (const name of entries()) {
        try {
          const row = JSON.parse(storage().getItem(name));
          if (!matches || !row || matches(row.scope, row.value)) storage().removeItem(name);
        } catch (_) { try { storage().removeItem(name); } catch (_) {} }
      }
    }
    function load(scope, reader, ttl) {
      const account = owner(), version = revision, id = account + ':' + version + ':' + scope;
      if (pending.has(id)) return pending.get(id);
      const request = Promise.resolve().then(reader).then(value => {
        if (version === revision && account === owner()) put(scope, value, ttl, account);
        return value;
      }).finally(() => pending.delete(id));
      pending.set(id, request);
      return request;
    }
    return {get, put, load, invalidate, revision:() => revision};
  }
  const api = {create};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.YouziTeacherViewCache = api;
})(typeof window !== 'undefined' ? window : globalThis);
