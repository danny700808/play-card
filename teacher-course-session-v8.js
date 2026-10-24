(function (global) {
  'use strict';

  const SESSION_KEY = 'youzi.coursePortal.teacher.session.v1';
  const bindView = document.getElementById('bindView');
  const appView = document.getElementById('appView');
  const loadingView = document.getElementById('sessionLoading');
  if (!bindView || !appView || !loadingView) return;

  const title = document.getElementById('teacherSessionTitle');
  const message = document.getElementById('teacherSessionMessage');
  const retryButton = document.getElementById('retryTeacherSession');
  const spinner = loadingView.querySelector('.teacher-session-spinner');
  let timer = 0, state = 'idle', retry = null;

  function begin() {
    clearTimeout(timer);
    state = 'loading';
    bindView.classList.add('hidden');
    appView.classList.add('hidden');
    loadingView.classList.remove('hidden');
    loadingView.setAttribute('aria-busy', 'true');
    if (title) title.textContent = '正在開啟老師課務';
    if (message) message.textContent = '正在讀取課表，請稍候。';
    if (spinner) spinner.hidden = false;
    if (retryButton) { retryButton.hidden = true; retryButton.disabled = true; }
    observer.observe(bindView, { attributes: true, attributeFilter: ['class'] });
    observer.observe(appView, { attributes: true, attributeFilter: ['class'] });
    timer = setTimeout(function () {
      if (state === 'loading' && message) message.textContent = '連線較慢，仍在讀取課表，請稍候。';
    }, 15000);
  }

  function finish() {
    clearTimeout(timer);
    state = 'ready';
    loadingView.classList.add('hidden');
    loadingView.setAttribute('aria-busy', 'false');
    observer.disconnect();
  }

  function fail(error, retryLoad) {
    clearTimeout(timer);
    state = 'error';
    retry = retryLoad;
    bindView.classList.add('hidden');
    appView.classList.add('hidden');
    loadingView.classList.remove('hidden');
    loadingView.setAttribute('aria-busy', 'false');
    if (title) title.textContent = '暫時無法載入課表';
    if (message) message.textContent = global.navigator && global.navigator.onLine === false
      ? '目前沒有網路連線，恢復連線後會再試一次。'
      : '登入資料已保留，請按「重新載入」再試一次。';
    if (spinner) spinner.hidden = true;
    if (retryButton) { retryButton.hidden = false; retryButton.disabled = false; }
  }

  function retryLoad() {
    if (state !== 'error' || typeof retry !== 'function') return;
    const run = retry;
    begin();
    Promise.resolve().then(run).catch(error => fail(error, run));
  }

  const observer = new MutationObserver(function () {
    if (!appView.classList.contains('hidden') || !bindView.classList.contains('hidden')) finish();
  });
  if (retryButton) retryButton.addEventListener('click', retryLoad);
  global.addEventListener('online', retryLoad);
  global.YouziTeacherSession = { begin, finish, fail };
  const params = new URLSearchParams(location.search);
  let saved = '';
  try { saved = global.CoursePortal ? global.CoursePortal.getSession('teacher') : localStorage.getItem(SESSION_KEY); } catch (_) {}
  if (params.get('access') || String(saved || '').trim()) begin();
})(window);
