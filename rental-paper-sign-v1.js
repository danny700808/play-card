(function (global) {
  'use strict';

  if (global.__YZ_RENTAL_PAPER_SIGN_LOADER_V7__) return;
  global.__YZ_RENTAL_PAPER_SIGN_LOADER_V7__ = true;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = resolve;
      script.onerror = function () { reject(new Error('載入失敗：' + src)); };
      document.head.appendChild(script);
    });
  }

  loadScript('rental-admin-enhancements-v1.js?v=20260804-paper-activation-v7')
    .catch(function (error) {
      console.error(error);
      if (global.YZRental && typeof global.YZRental.toast === 'function') {
        global.YZRental.toast('紙本成立與案件數功能載入失敗，請重新整理。', false);
      }
    })
    .then(function () {
      return loadScript('rental-paper-sign-v1-core-v5.js?v=20260804-paper-activation-v7');
    })
    .catch(function (error) {
      console.error(error);
      if (global.YZRental && typeof global.YZRental.toast === 'function') {
        global.YZRental.toast('紙本簽署功能載入失敗，請重新整理。', false);
      }
    });
})(window);
