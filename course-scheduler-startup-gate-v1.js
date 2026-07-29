(function (global) {
  'use strict';

  if (global.__YOUZI_COURSE_SCHEDULER_GATE_INSTALLED__) return;
  global.__YOUZI_COURSE_SCHEDULER_GATE_INSTALLED__ = true;

  var documentObject = global.document;
  var FORMAL_CACHE_KEY = 'youzi.courseScheduler.formalCache.v1';
  if (!documentObject || documentObject.readyState !== 'loading') return;

  var originalAddEventListener = documentObject.addEventListener;
  var schedulerListenerCount = 0;

  function seedFormalCache(result) {
    var source = result && result.snapshot;
    if (!source || Number(source.version) !== 3) return;
    try {
      var formal = JSON.parse(JSON.stringify(source));
      formal.readOnly = true;
      formal.dataMode = 'migration';
      formal.clipboard = null;
      global.localStorage.setItem(FORMAL_CACHE_KEY, JSON.stringify(formal));
    } catch (_) {}
  }

  documentObject.addEventListener = function (type, listener, options) {
    if (type === 'DOMContentLoaded' && typeof listener === 'function' && listener.name === 'init') {
      schedulerListenerCount += 1;

      if (schedulerListenerCount > 1) {
        return;
      }

      return originalAddEventListener.call(documentObject, type, function (event) {
        var ready = global.YouziCourseAutoDataReady;
        Promise.resolve(ready).then(function (result) {
          seedFormalCache(result);
          return result;
        }).catch(function () { return null; }).then(function () {
          listener.call(documentObject, event);
        });
      }, options);
    }

    return originalAddEventListener.call(documentObject, type, listener, options);
  };

  global.setTimeout(function () {
    documentObject.addEventListener = originalAddEventListener;
  }, 10000);
})(window);
