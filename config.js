(function(global){
  const DEFAULTS = {
    // 這裡請在你部署新 Apps Script Web App 後，改成新的 /exec 網址
    API_URL: 'https://script.google.com/macros/s/AKfycby2fAM3Q5j9-4je9atMNzbdNIXn3-Y90nacN75jJgCyO7fSglgBR9iE-lOEacmh7dI_/exec',
    GOOGLE_CLIENT_ID: '1061451682971-664fkp8jnd3771srdrshujqalngnocla.apps.googleusercontent.com',
    CLOUDINARY_CLOUD_NAME: 'dkwzybiw9',
    CLOUDINARY_UPLOAD_PRESET: 'yuzu_unsigned2',
    CLOUDINARY_ROOT_FOLDER: 'employee-system',
    CLOUDINARY_CHUNK_SIZE_MB: 20,
    CLOUDINARY_SOFT_MAX_VIDEO_MB: 0,
    FIREBASE_CONFIG: {
      apiKey: 'AIzaSyBTrUyhQSEI2mun5O1mjnSN_mO10c_t-Xs',
      authDomain: 'youzi-c1b74.firebaseapp.com',
      projectId: 'youzi-c1b74',
      storageBucket: 'youzi-c1b74.firebasestorage.app',
      messagingSenderId: '187002582910',
      appId: '1:187002582910:web:f5c73a46e5a773a860a52f',
      measurementId: 'G-WLYK892EDW'
    },
    FIREBASE_ENABLED: true,
    BUILD: '2026-08-03-rental-session-bridge-v1'
  };

  const params = new URLSearchParams(global.location.search || '');
  const queryApi = String(params.get('api') || '').trim();
  const storedApi = String(global.localStorage.getItem('EMPLOYEE_SYSTEM_API_BASE') || '').trim();
  const resolvedApi = queryApi || storedApi || DEFAULTS.API_URL;

  global.APP_CONFIG = Object.assign({}, DEFAULTS, { API_URL: resolvedApi });
  global.API_URL = resolvedApi;

  global.setEmployeeSystemApiUrl = function(url){
    const next = String(url || '').trim();
    if(next){
      global.localStorage.setItem('EMPLOYEE_SYSTEM_API_BASE', next);
    }else{
      global.localStorage.removeItem('EMPLOYEE_SYSTEM_API_BASE');
    }
    return next || DEFAULTS.API_URL;
  };

  global.resetEmployeeSystemApiUrl = function(){
    global.localStorage.removeItem('EMPLOYEE_SYSTEM_API_BASE');
    return DEFAULTS.API_URL;
  };

  /*
   * 課務登入穩定層：
   * 1. 老師／學生／租用頁不再各自顯示另一套登入畫面。
   * 2. LINE 第一次綁定、錯誤與失效狀態統一回到 course-portal.html。
   * 3. 換手機不使用舊式登入碼；同一個 LINE 帳號重新授權即可。
   * 4. bot_prompt 改為 normal，好友選項留在同一個 LINE 同意畫面，不再額外跳一頁。
   * 5. 中央入口會直接交換 LINE 回傳的 access，再開啟正確的身分頁。
   * 6. 老師或學生由自己的入口前往教室租用時，沿用原本工作階段。
   */
  const COURSE_ROLE_PAGES = Object.freeze({
    'teacher-course-portal.html': 'teacher',
    'student-course-portal.html': 'student',
    'room-booking.html': 'renter'
  });
  const COURSE_ROLE_PAGES_BY_ROLE = Object.freeze({
    teacher: 'teacher-course-portal.html',
    student: 'student-course-portal.html',
    renter: 'room-booking.html'
  });
  const LAST_ROLE_KEY = 'youzi.coursePortal.lastRole.v2';
  const ENTRY_INTENT_KEYS = [
    'youzi.coursePortal.entryIntent.v1',
    'youzi.coursePortal.entryIntent.v2'
  ];

  function clean(value){ return String(value == null ? '' : value).trim(); }
  function pageName(){ return clean(global.location.pathname.split('/').pop()).toLowerCase(); }
  function validRole(role){ return ['teacher','student','renter'].includes(clean(role)) ? clean(role) : ''; }
  function sessionKey(role){ return 'youzi.coursePortal.' + role + '.session.v1'; }
  function courseSession(role){
    const key = sessionKey(role);
    try {
      return clean(global.sessionStorage.getItem(key)) || clean(global.localStorage.getItem(key));
    } catch (_) {
      return '';
    }
  }
  function rememberCourseRole(role){
    const value = validRole(role);
    if (!value) return;
    try {
      global.localStorage.setItem(LAST_ROLE_KEY, value);
      global.localStorage.setItem('youzi.coursePortal.lastRole', value);
    } catch (_) {}
  }
  function lastCourseRole(){
    try {
      return validRole(global.localStorage.getItem(LAST_ROLE_KEY)) ||
        validRole(global.localStorage.getItem('youzi.coursePortal.lastRole'));
    } catch (_) {
      return '';
    }
  }
  function normalizeLineAuthorizationUrl(raw){
    const source = clean(raw);
    if (!source) return source;
    try {
      const url = new URL(source, global.location.href);
      if (url.hostname === 'access.line.me') url.searchParams.set('bot_prompt', 'normal');
      return url.toString();
    } catch (_) {
      return source.replace(/([?&])bot_prompt=aggressive(?:&|$)/, '$1bot_prompt=normal&').replace(/&$/, '');
    }
  }
  function courseEntryUrl(values){
    const search = new URLSearchParams();
    Object.keys(values || {}).forEach(function(key){
      const value = clean(values[key]);
      if (value) search.set(key, value);
    });
    return 'course-portal.html' + (search.toString() ? '?' + search.toString() : '');
  }
  function safeReplace(url){
    const target = clean(url);
    if (!target) return;
    try { global.location.replace(target); }
    catch (_) { global.location.href = target; }
  }
  function clearExpiredEntryIntents(){
    const now = Date.now();
    ENTRY_INTENT_KEYS.forEach(function(key){
      try {
        const raw = global.sessionStorage.getItem(key) || global.localStorage.getItem(key) || '';
        const row = raw ? JSON.parse(raw) : null;
        if (!row || !row.startedAt || now - Number(row.startedAt) > 15 * 60 * 1000) {
          global.sessionStorage.removeItem(key);
          global.localStorage.removeItem(key);
        }
      } catch (_) {
        try {
          global.sessionStorage.removeItem(key);
          global.localStorage.removeItem(key);
        } catch (ignore) {}
      }
    });
  }

  global.YouziCoursePortalEntry = Object.assign({}, global.YouziCoursePortalEntry || {}, {
    rolePages: COURSE_ROLE_PAGES_BY_ROLE,
    getSession: courseSession,
    getLastRole: lastCourseRole,
    rememberRole: rememberCourseRole,
    normalizeLineAuthorizationUrl: normalizeLineAuthorizationUrl,
    entryUrl: courseEntryUrl
  });
  global.normalizeYouziLineAuthorizationUrl = normalizeLineAuthorizationUrl;
  clearExpiredEntryIntents();

  function rentalBridgeRole(){
    if (pageName() !== 'room-booking.html') return '';
    const search = new URLSearchParams(global.location.search || '');
    const requested = validRole(search.get('from'));
    if ((requested === 'teacher' || requested === 'student') && courseSession(requested)) {
      return requested;
    }
    if (courseSession('renter')) return 'renter';
    if (courseSession('student')) return 'student';
    if (courseSession('teacher')) return 'teacher';
    return '';
  }

  const currentPage = pageName();
  const bridgedRentalRole = rentalBridgeRole();
  const currentRole = validRole(
    currentPage === 'room-booking.html' && bridgedRentalRole
      ? bridgedRentalRole
      : COURSE_ROLE_PAGES[currentPage]
  );
  if (currentRole) {
    const roleParams = new URLSearchParams(global.location.search || '');
    const lineSetup = clean(roleParams.get('lineSetup'));
    const lineError = clean(roleParams.get('lineError'));
    const access = clean(roleParams.get('access'));

    if (lineSetup) {
      safeReplace(courseEntryUrl({ method:'line', role:currentRole, lineSetup:lineSetup }));
      return;
    }
    if (lineError) {
      safeReplace(courseEntryUrl({ method:'line', role:currentRole, lineError:lineError }));
      return;
    }
    if (!access && !courseSession(currentRole)) {
      safeReplace(courseEntryUrl({ method:'line', role:currentRole, reason:'login-required' }));
      return;
    }
    if (access || courseSession(currentRole)) rememberCourseRole(currentRole);

    function installRolePageRecovery(){
      const authView = document.querySelector('[data-auth-view]') ||
        document.getElementById('bindView') || document.getElementById('publicBindView');
      const appView = document.querySelector('[data-app-view]') ||
        document.getElementById('appView') || document.getElementById('bookingView');
      if (!authView && !appView) return;
      let redirecting = false;
      function hidden(node){ return !node || node.classList.contains('hidden'); }
      function check(){
        if (redirecting) return;
        if (appView && !hidden(appView)) {
          rememberCourseRole(currentRole);
          return;
        }
        const addingAnotherStudent = authView && authView.dataset.addStudent === 'true';
        const liveAccess = clean(new URLSearchParams(global.location.search || '').get('access'));
        if (authView && !hidden(authView) && !addingAnotherStudent && !liveAccess) {
          redirecting = true;
          safeReplace(courseEntryUrl({ method:'line', role:currentRole, reason:'session-expired' }));
        }
      }
      const observer = new MutationObserver(check);
      if (authView) observer.observe(authView, { attributes:true, attributeFilter:['class','data-add-student'] });
      if (appView) observer.observe(appView, { attributes:true, attributeFilter:['class'] });
      check();
      global.setTimeout(check, 16000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installRolePageRecovery, { once:true });
    else installRolePageRecovery();
  }

  /* course-portal-common.js 載入後自動包裝，不需每一頁各自再改一次。 */
  let hookAttempts = 0;
  function installCoursePortalHooks(){
    hookAttempts += 1;
    const portal = global.CoursePortal;
    if (!portal) {
      if (hookAttempts < 120) global.setTimeout(installCoursePortalHooks, 50);
      return;
    }
    if (portal.__youziLoginStabilityV4) return;
    portal.__youziLoginStabilityV4 = true;

    if (typeof portal.call === 'function') {
      const originalCall = portal.call.bind(portal);
      portal.call = async function(name, data){
        const result = await originalCall(name, data);
        if (name === 'coursePortalStartLineLogin' && result && result.authorizationUrl) {
          result.authorizationUrl = normalizeLineAuthorizationUrl(result.authorizationUrl);
        }
        return result;
      };
    }
    if (typeof portal.setSession === 'function') {
      const originalSetSession = portal.setSession.bind(portal);
      portal.setSession = function(role, token, options){
        const result = originalSetSession(role, token, options);
        if (clean(token)) rememberCourseRole(role);
        return result;
      };
    }

    /*
     * 已綁定的 LINE 帳號可能由後端回到中央入口並帶入一次性 access。
     * 入口在此直接交換工作階段並前往身分頁，不讓使用者再按第二次。
     */
    if (pageName() === 'course-portal.html' && !global.__YOUZI_CENTRAL_ACCESS_EXCHANGE_V4__) {
      const centralParams = new URLSearchParams(global.location.search || '');
      const accessToken = clean(centralParams.get('access'));
      const accessRole = validRole(centralParams.get('role'));
      if (accessToken && accessRole && typeof portal.call === 'function' && typeof portal.setSession === 'function') {
        global.__YOUZI_CENTRAL_ACCESS_EXCHANGE_V4__ = true;
        const loadingView = document.getElementById('loadingView');
        const loadingTitle = document.getElementById('loadingTitle');
        const loadingText = document.getElementById('loadingText');
        if (loadingTitle) loadingTitle.textContent = 'LINE 登入完成';
        if (loadingText) loadingText.textContent = '正在建立這台裝置的登入狀態，完成後會直接進入。';
        if (loadingView) {
          ['methodView','roleView','setupView','emailView','otpView'].forEach(function(id){
            const node = document.getElementById(id);
            if (node) node.classList.add('hidden');
          });
          loadingView.classList.remove('hidden');
        }
        portal.call('coursePortalExchangeAccess', { accessToken:accessToken }).then(function(result){
          if (!result || validRole(result.role) !== accessRole || !clean(result.sessionToken)) {
            throw new Error('LINE 登入資料不完整，請重新操作。');
          }
          portal.setSession(accessRole, result.sessionToken);
          rememberCourseRole(accessRole);
          ENTRY_INTENT_KEYS.forEach(function(key){
            try { global.sessionStorage.removeItem(key); } catch (_) {}
            try { global.localStorage.removeItem(key); } catch (_) {}
          });
          safeReplace(COURSE_ROLE_PAGES_BY_ROLE[accessRole]);
        }).catch(function(error){
          const message = clean(error && error.message) || 'LINE 登入未完成，請重新操作。';
          try {
            global.sessionStorage.removeItem(sessionKey(accessRole));
            global.localStorage.removeItem(sessionKey(accessRole));
          } catch (_) {}
          safeReplace(courseEntryUrl({ method:'line', role:accessRole, lineError:message }));
        });
      }
    }
  }
  global.setTimeout(installCoursePortalHooks, 0);
})(window);
