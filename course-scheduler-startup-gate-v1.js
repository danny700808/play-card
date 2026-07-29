(function (global) {
  'use strict';

  if (global.__YOUZI_COURSE_SCHEDULER_GATE_INSTALLED__) return;
  global.__YOUZI_COURSE_SCHEDULER_GATE_INSTALLED__ = true;

  var documentObject = global.document;
  if (!documentObject || documentObject.readyState !== 'loading') return;

  var originalAddEventListener = documentObject.addEventListener;
  var schedulerListenerCount = 0;

  documentObject.addEventListener = function (type, listener, options) {
    if (type === 'DOMContentLoaded' && typeof listener === 'function' && listener.name === 'init') {
      schedulerListenerCount += 1;

      if (schedulerListenerCount > 1) {
        return;
      }

      return originalAddEventListener.call(documentObject, type, function (event) {
        var ready = global.YouziCourseAutoDataReady;
        Promise.resolve(ready).catch(function () { return null; }).then(function () {
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
