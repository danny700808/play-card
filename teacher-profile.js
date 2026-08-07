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
  function lifecycle(profile, result) {
    const status = clean(profile && (profile.profileStatus || profile.status) || result && result.user && result.user.accountStatus).toLowerCase();
    if (['active', 'approved', 'confirmed', 'contract_effective'].includes(status)) {
      return { title: '已建立為外聘老師', text: '個人資料已由管理者確認；年度合約請到「其他 → 合約」查看。', mark: '✓', tone: 'complete' };
    }
    if (['pending_review', 'pending', 'submitted'].includes(status)) {
      return { title: '等待管理者確認', text: '資料已送出；仍可儲存補充內容，合約會另外處理。', mark: '…', tone: 'pending' };
    }
    if (['needs_revision', 'returned', 'rejected'].includes(status)) {
      return { title: '管理者退回補件', text: '請依管理者說明補齊資料，再重新送出確認。', mark: '!', tone: 'incomplete' };
    }
    if (['archived', 'inactive', 'disabled'].includes(status)) {
      return { title: '資料已封存', text: '目前無法送出；如需重新啟用，請聯絡管理者。', mark: '—', tone: 'incomplete' };
    }
    return { title: '資料填寫中', text: '可以先儲存，下次再繼續；填完後再送出管理者確認。', mark: '!', tone: 'incomplete' };
  }
  function addTeachingRow(value) {
    const list = $('profileTeachingList');
    if (!list || list.children.length >= 20) return;
    const source = value || {};
    const row = document.createElement('div');
    row.className = 'teaching-row';
    const subjectField = document.createElement('div');
    subjectField.className = 'field';
    const subjectLabel = document.createElement('label');
    subjectLabel.textContent = '授課項目';
    const subject = document.createElement('input');
    subject.className = 'teaching-subject';
    subject.maxLength = 80;
    subject.placeholder = '例如：鋼琴';
    subject.value = clean(source.item || source.name || source.subject);
    subjectField.append(subjectLabel, subject);
    const levelField = document.createElement('div');
    levelField.className = 'field';
    const levelLabel = document.createElement('label');
    levelLabel.textContent = '程度';
    const level = document.createElement('input');
    level.className = 'teaching-level';
    level.maxLength = 30;
    level.placeholder = '例如：初階～進階';
    level.value = clean(source.level || source.degree || source.proficiency);
    levelField.append(levelLabel, level);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', '刪除授課項目');
    remove.textContent = '×';
    remove.addEventListener('click', function () {
      row.remove();
      if (!list.children.length) addTeachingRow({});
    });
    row.append(subjectField, levelField, remove);
    list.appendChild(row);
  }
  function renderTeachingRows(values) {
    const list = $('profileTeachingList');
    if (!list) return;
    list.replaceChildren();
    const rows = Array.isArray(values) && values.length ? values : [{}];
    rows.slice(0, 20).forEach(addTeachingRow);
  }
  function teachingPayload() {
    return Array.from(document.querySelectorAll('#profileTeachingList .teaching-row')).map(function (row) {
      return {
        item: clean(row.querySelector('.teaching-subject') && row.querySelector('.teaching-subject').value),
        level: clean(row.querySelector('.teaching-level') && row.querySelector('.teaching-level').value)
      };
    }).filter((row) => row.item);
  }
  function render(result) {
    currentResult = result || {};
    const profile = profileOf(result);
    const missing = Array.isArray(result.missingProfileFields) ? result.missingProfileFields : [];
    $('profileName').value = clean(profile.name);
    $('profileMobile').value = clean(profile.mobilePhone);
    $('profileEmail').value = clean(profile.email);
    $('profileBirthDate').value = clean(profile.birthDate);
    $('profileHouseholdAddress').value = clean(profile.householdAddress);
    $('profileMailingAddress').value = clean(profile.mailingAddress);
    $('profileEmergencyContact').value = clean(profile.emergencyContact);
    $('profileEmergencyPhone').value = clean(profile.emergencyPhone);
    $('profileIdNumber').value = '';
    const masked = clean(profile.idNumberMasked);
    $('profileIdNumber').placeholder = masked ? '已留存；需要更換時再輸入' : '請輸入身分證字號';
    $('profileIdHint').textContent = masked ? `目前已留存：${masked}` : '';
    renderTeachingRows(profile.teachingAbilities);
    const fileCount = Math.max(0, Number(profile.identityFileCount || 0));
    $('profileFileState').textContent = fileCount ? `已安全留存 ${fileCount} 份附件` : '尚未上傳';
    const state = lifecycle(profile, result);
    $('profileStatusCard').classList.toggle('incomplete', state.tone === 'incomplete');
    $('profileStatusMark').textContent = state.mark;
    $('profileStatusTitle').textContent = state.title;
    $('profileStatusText').textContent = state.text + (missing.length ? ` 尚缺：${missing.map((row) => clean(row && row.label)).filter(Boolean).join('、')}。` : '');
    const lineOn = Boolean(clean(profile.lineUserId));
    const emailOn = Boolean(clean(profile.email));
    $('profileLineStatus').textContent = lineOn ? 'LINE 已綁定' : 'LINE 未綁定';
    $('profileLineStatus').classList.toggle('off', !lineOn);
    $('profileEmailStatus').textContent = emailOn ? 'Email 可使用' : 'Email 未設定';
    $('profileEmailStatus').classList.toggle('off', !emailOn);
    show($('profileLoadingCard'), false);
    show($('profileErrorCard'), false);
    show($('profileStatusCard'), true);
    show($('profileLoginCard'), true);
    show($('teacherProfileForm'), true);
  }
  function showFailure(error) {
    show($('profileLoadingCard'), false);
    show($('profileStatusCard'), false);
    show($('profileLoginCard'), false);
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
      birthDate: clean($('profileBirthDate').value),
      householdAddress: clean($('profileHouseholdAddress').value),
      mailingAddress: clean($('profileMailingAddress').value),
      emergencyContact: clean($('profileEmergencyContact').value),
      emergencyPhone: clean($('profileEmergencyPhone').value),
      teachingAbilities: teachingPayload()
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
    [$('profileSaveBtn'), $('profileSubmitBtn')].forEach(function (button) {
      if (!button) return;
      button.disabled = active;
    });
    $('profileSaveBtn').textContent = active ? '儲存中…' : '儲存，下次繼續';
  }
  async function save(submitForReview) {
    if (saving) return;
    setSaving(true);
    message('正在安全儲存…', false);
    try {
      const data = await payload();
      data.submitForReview = submitForReview === true;
      const result = await call('coursePortalTeacherSaveProfileDraft', data);
      $('profileIdentityFiles').value = '';
      render(result);
      message(submitForReview ? '已送出管理者確認。' : '已儲存目前內容，下次可繼續填寫。', false);
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
  $('profileCopyAddress').addEventListener('click', function () { $('profileMailingAddress').value = $('profileHouseholdAddress').value; });
  $('profileAddTeaching').addEventListener('click', function () { addTeachingRow({}); });
  $('teacherProfileForm').addEventListener('submit', function (event) { event.preventDefault(); save(false); });
  $('profileSubmitBtn').addEventListener('click', function () { save(true); });
  load();
})(window);
