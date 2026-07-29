(function () {
  'use strict';

  const SESSION_KEY = 'youzi.coursePortal.teacher.session.v1';
  const bindView = document.getElementById('bindView');
  const appView = document.getElementById('appView');
  const loadingView = document.getElementById('sessionLoading');
  if (!bindView || !appView || !loadingView) return;

  const params = new URLSearchParams(location.search);
  const hasCandidate = Boolean(params.get('access') || String(localStorage.getItem(SESSION_KEY) || '').trim());
  if (!hasCandidate) return;

  bindView.classList.add('hidden');
  appView.classList.add('hidden');
  loadingView.classList.remove('hidden');

  function finish() {
    loadingView.classList.add('hidden');
    observer.disconnect();
  }

  const observer = new MutationObserver(function () {
    if (!appView.classList.contains('hidden') || !bindView.classList.contains('hidden')) finish();
  });
  observer.observe(bindView, { attributes: true, attributeFilter: ['class'] });
  observer.observe(appView, { attributes: true, attributeFilter: ['class'] });

  setTimeout(function () {
    if (!loadingView.classList.contains('hidden')) {
      finish();
      bindView.classList.remove('hidden');
    }
  }, 15000);
})();
