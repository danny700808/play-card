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
    BUILD: '2026-08-05-auth-route-cleanup-v1'
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
   * 課務登入共用路由：
   * 1. 中央入口只依照使用者明確選擇的登入方式與身分前進。
   * 2. LINE 第一次綁定、錯誤與失效狀態統一回到 course-portal.html。
   * 3. 老師或學生由自己的入口前往教室租用時，只沿用網址 from 指定的工作階段。
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
  const LEGACY_LAST_ROLE_KEY = 'youzi.coursePortal.lastRole';
  const ENTRY_INTENT_KEYS = [
    'youzi.coursePortal.entryIntent.v1',
    'youzi.coursePortal.entryIntent.v2'
  ];
  const AUTH_STATE_MIGRATION_KEY = 'youzi.coursePortal.authStateMigration.20260805.v1';
  const STALE_AUTH_STATE_KEYS = Object.freeze([
    LAST_ROLE_KEY,
    LEGACY_LAST_ROLE_KEY,
    'youzi.coursePortal.teacher.session.v1',
    'youzi.coursePortal.student.session.v1',
    'youzi.coursePortal.renter.session.v1',
    'youzi.coursePortal.pendingRole',
    'youzi.coursePortal.autoRedirect',
    'coursePortalEntryRole',
    'coursePortalAutoRedirect',
    ...ENTRY_INTENT_KEYS
  ]);
  const STALE_AUTH_STATE_PREFIXES = Object.freeze([
    'youzi.coursePortal.dataCache.'
  ]);

  function clean(value){ return String(value == null ? '' : value).trim(); }
  function pageName(){ return clean(global.location.pathname.split('/').pop()).toLowerCase(); }
  function validRole(role){ return ['teacher','student','renter'].includes(clean(role)) ? clean(role) : ''; }
  function sessionKey(role){ return 'youzi.coursePortal.' + role + '.session.v1'; }
  function storageHasMigrationMarker(storage){
    try { return storage.getItem(AUTH_STATE_MIGRATION_KEY) === 'done'; }
    catch (_) { return false; }
  }
  function storageKeys(storage){
    const keys = [];
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key) keys.push(key);
      }
    } catch (_) {}
    return keys;
  }
  function clearStaleAuthState(storage){
    STALE_AUTH_STATE_KEYS.forEach(function(key){
      try { storage.removeItem(key); } catch (_) {}
    });
    storageKeys(storage).forEach(function(key){
      if (STALE_AUTH_STATE_PREFIXES.some(function(prefix){ return key.indexOf(prefix) === 0; })) {
        try { storage.removeItem(key); } catch (_) {}
      }
    });
  }
  function migrateBrowserAuthStateOnce(){
    const storages = [global.localStorage, global.sessionStorage].filter(Boolean);
    let migrated = false;
    storages.forEach(function(storage){
      if (storageHasMigrationMarker(storage)) return;
      clearStaleAuthState(storage);
      try { storage.setItem(AUTH_STATE_MIGRATION_KEY, 'done'); } catch (_) {}
      migrated = true;
    });
    return migrated;
  }
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
    } catch (_) {}
  }
  function lastCourseRole(){
    try {
      return validRole(global.localStorage.getItem(LAST_ROLE_KEY));
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
    authStateMigrationVersion: AUTH_STATE_MIGRATION_KEY,
    rolePages: COURSE_ROLE_PAGES_BY_ROLE,
    getSession: courseSession,
    getLastRole: lastCourseRole,
    rememberRole: rememberCourseRole,
    normalizeLineAuthorizationUrl: normalizeLineAuthorizationUrl,
    entryUrl: courseEntryUrl
  });
  global.normalizeYouziLineAuthorizationUrl = normalizeLineAuthorizationUrl;
  migrateBrowserAuthStateOnce();
  clearExpiredEntryIntents();

  function rentalBridgeRole(){
    if (pageName() !== 'room-booking.html') return '';
    const search = new URLSearchParams(global.location.search || '');
    const requested = validRole(search.get('from'));
    if (requested === 'teacher' || requested === 'student') return requested;
    return 'renter';
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

  }
  global.setTimeout(installCoursePortalHooks, 0);
})(window);
