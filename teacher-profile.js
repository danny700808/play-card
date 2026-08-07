(function (global) {
  'use strict';

  const SESSION_KEY = 'youzi.coursePortal.teacher.session.v1';
  const WATERMARK = '僅供柚子樂器外聘教師資料建檔使用';
  let currentResult = null;
  let saving = false;

  function $(id) { return document.getElementById(id); }
  function clean(value) { return String(value == null ? '' : value).trim(); }
  function token() {
    try { return clean(global.localStorage.getItem(SESSION_KEY)); } catch (_) { return ''; }
  }
  function show(node, visible) { if (node) node.classList.toggle('hidden', !visible); }
  function message(text, error) {
    const node = $('profileMessage');
    if (!node) return;
    node.textContent = clean(text);
    node.classList.toggle('error', Boolean(error));
    node.style.display = text ? 'block' : 'none';
  }
  function errorText(error) {
    return clean(error && (error.details || error.message) || error || '目前無法處理，請稍後再試。')
      .replace(/^FirebaseError:\s*/i, '');
  }
  function goBack() { global.location.href = 'teacher-course-portal.html'; }
  function logout() {
    if (global.YZTeacherMoreAuth && typeof global.YZTeacherMoreAuth.clearPortalBridge === 'function') {
      global.YZTeacherMoreAuth.clearPortalBridge();
    } else {
      try { global.localStorage.removeItem(SESSION_KEY); } catch (_) {}
    }
    global.location.replace('course-portal.html?method=line&role=teacher');
  }
  function functionsClient() {
    const config = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
    if (!global.firebase || !config) throw new Error('系統尚未準備完成，請重新整理。');
    if (!global.firebase.apps.length) global.firebase.initializeApp(config);
    return global.firebase.app().functions('us-central1');
  }
  async function call(name, data) {
    const sessionToken = token();
    if (!sessionToken) {
      const error = new Error('老師登入已失效，請重新登入。');
      error.portalAuthExpired = true;
      throw error;
    }
    try {
      const response = await functionsClient().httpsCallable(name)(Object.assign({}, data || {}, { sessionToken }));
      return response && response.data || {};
    } catch (error) {
      const wrapped = new Error(errorText(error));
      const code = clean(error && error.code);
      wrapped.portalAuthExpired = /(?:^|\/)(?:unauthenticated|permission-denied)$/i.test(code) ||
        /登入狀態已到期|請先登入|登入權限已停用|綁定已停用/.test(wrapped.message);
      throw wrapped;
    }
  }
  function profileOf(result) { return result && result.profile && typeof result.profile === 'object' ? result.profile : {}; }
  function lines(value) {
    return clean(value).split(/[\n、,，]+/u).map(clean).filter(Boolean).slice(0, 20);
  }
  function render(result) {
    currentResult = result || {};
    const profile = profileOf(result);
    const missing = Array.isArray(result.missingProfileFields) ? result.missingProfileFields : [];
    const complete = result.profileComplete === true;
    $('profileName').value = clean(profile.name);
    $('profileMobile').value = clean(profile.mobilePhone);
    $('profileEmail').value = clean(profile.email);
    $('profileIdNumber').value = '';
    const masked = clean(profile.idNumberMasked);
    $('profileIdNumber').placeholder = masked ? '已留存；需要更換時再輸入' : '請輸入身分證字號';
    $('profileIdHint').textContent = masked ? `目前已留存：${masked}` : '';
    $('profileTeaching').value = (Array.isArray(profile.teachingAbilities) ? profile.teachingAbilities : [])
      .map((row) => clean(row && (row.item || row.name || row.subject))).filter(Boolean).join('\n');
    const fileCount = Math.max(0, Number(profile.identityFileCount || 0));
    $('profileFileState').textContent = fileCount ? `已安全留存 ${fileCount} 份附件` : '尚未上傳';
    $('profileStatusCard').classList.toggle('incomplete', !complete);
    $('profileStatusMark').textContent = complete ? '✓' : '!';
    $('profileStatusTitle').textContent = complete ? '個人資料已完成' : '資料尚未完成';
    $('profileStatusText').textContent = complete
      ? '資料已儲存；合約會在「其他 → 合約」獨立顯示。'
      : `可先儲存，下次再繼續${missing.length ? `（尚缺 ${missing.length} 項）` : ''}。`;
    const lineOn = Boolean(clean(profile.lineUserId));
    const emailOn = Boolean(clean(profile.email));
    $('profileLineStatus').textContent = lineOn ? 'LINE 已綁定' : 'LINE 未綁定';
    $('profileLineStatus').classList.toggle('off', !lineOn);
    $('profileEmailStatus').textContent = emailOn ? 'Email 可使用' : 'Email 未設定';
    $('profileEmailStatus').classList.toggle('off', !emailOn);
    show($('profileLoadingCard'), false);
    show($('profileErrorCard'), false);
    show($('profileStatusCard'), true);
    show($('teacherProfileForm'), true);
  }
  function showFailure(error) {
    show($('profileLoadingCard'), false);
    show($('profileStatusCard'), false);
    show($('teacherProfileForm'), false);
    show($('profileErrorCard'), true);
    $('profileErrorText').textContent = errorText(error);
    if (error && error.portalAuthExpired) {
      global.setTimeout(function () { logout(); }, 900);
    }
  }
  async function load() {
    show($('profileLoadingCard'), true);
    show($('profileErrorCard'), false);
    message('', false);
    try {
      const result = global.YZTeacherMoreAuth && typeof global.YZTeacherMoreAuth.fetchUtilitySession === 'function'
        ? await global.YZTeacherMoreAuth.fetchUtilitySession()
        : await call('coursePortalTeacherUtilitySession');
      render(result);
    } catch (error) {
      showFailure(error);
    }
  }
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = function () { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = function () { URL.revokeObjectURL(url); reject(new Error('照片無法讀取，請改用 JPG 或 PNG。')); };
      image.src = url;
    });
  }
  async function prepareImage(file) {
    const image = await loadImage(file);
    const maxSide = 1400;
    const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * ratio));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, width, height);
    const fontSize = Math.max(18, Math.round(Math.min(width, height) / 22));
    context.save();
    context.translate(width / 2, height / 2);
    context.rotate(-Math.PI / 7);
    context.font = `900 ${fontSize}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = 'rgba(120,20,20,.28)';
    const stepY = fontSize * 3.2;
    for (let y = -height; y <= height; y += stepY) {
      context.fillText(WATERMARK, 0, y);
    }
    context.restore();
    return {
      fileName: clean(file.name) || 'identity.jpg',
      dataUrl: canvas.toDataURL('image/jpeg', .76),
      watermarkApplied: true
    };
  }
  async function payload() {
    const value = {
      name: clean($('profileName').value),
      mobilePhone: clean($('profileMobile').value),
      email: clean($('profileEmail').value),
      teachingAbilities: lines($('profileTeaching').value).map((item) => ({ item }))
    };
    const idNumber = clean($('profileIdNumber').value);
    if (idNumber || !clean(profileOf(currentResult).idNumberMasked)) value.idNumber = idNumber;
    const files = Array.from($('profileIdentityFiles').files || []);
    if (files.length > 2) throw new Error('一次最多選擇 2 張照片。');
    value.identityImages = [];
    for (const file of files) value.identityImages.push(await prepareImage(file));
    return value;
  }
  function setSaving(active) {
    saving = active;
    [$('profileSaveBtn'), $('profileSaveReturnBtn')].forEach(function (button) {
      if (!button) return;
      button.disabled = active;
    });
    $('profileSaveBtn').textContent = active ? '儲存中…' : '儲存';
  }
  async function save(returnAfter) {
    if (saving) return;
    setSaving(true);
    message('正在安全儲存…', false);
    try {
      const result = await call('coursePortalTeacherSaveProfileDraft', await payload());
      $('profileIdentityFiles').value = '';
      render(result);
      message(result.profileComplete ? '個人資料已完成並儲存。' : '已儲存目前內容，下次可繼續填寫。', false);
      if (returnAfter) global.setTimeout(goBack, 450);
    } catch (error) {
      if (error && error.portalAuthExpired) {
        showFailure(error);
      } else {
        message(errorText(error), true);
      }
    } finally {
      setSaving(false);
    }
  }

  $('profileBackBtn').addEventListener('click', goBack);
  $('profileLogoutBtn').addEventListener('click', logout);
  $('profileErrorBackBtn').addEventListener('click', goBack);
  $('profileRetryBtn').addEventListener('click', load);
  $('teacherProfileForm').addEventListener('submit', function (event) { event.preventDefault(); save(false); });
  $('profileSaveReturnBtn').addEventListener('click', function () { save(true); });
  load();
})(window);
