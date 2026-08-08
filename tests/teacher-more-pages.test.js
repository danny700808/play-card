const fs = require('fs');
const path = require('path');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const pages = [
  'profile.html',
  'contract.html',
  'announcements.html',
  'task.html',
  'teacher-goods.html',
  'forms-hub.html'
];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function inlineScripts(source) {
  return [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((script) => script.trim());
}

function staticLocalTargets(source) {
  return [...source.matchAll(/\b(?:href|src)=["']([^"'#]+)["']/gi)]
    .map((match) => match[1].split(/[?#]/)[0])
    .filter((target) =>
      target &&
      !/^(?:https?:|data:|mailto:|tel:|javascript:|\/)/i.test(target) &&
      !/[${}]/.test(target)
    );
}

test('teacher other pages share the compact utility theme and explicit auth boundary', () => {
  for (const file of pages) {
    const source = read(file);
    assert.match(source, /class="[^"]*teacher-utility-page/);
    assert.match(source, /teacher-more-pages\.css\?v=20260808-announcement-layout-v1/);
    if (file === 'contract.html') {
      assert.match(source, /firebase-functions-compat\.js/);
      assert.match(source, /teacher-contract\.js\?v=20260808-contract-profile-gate-v1/);
      assert.doesNotMatch(source, /teacher-more-auth-bridge\.js|blockIfPortalOnly/);
    } else if (file === 'profile.html') {
      assert.match(source, /teacher-more-auth-bridge\.js\?v=20260806-external-teacher-reminder-v3/);
    } else if (file === 'task.html') {
      assert.match(source, /teacher-more-auth-bridge\.js\?v=20260808-external-work-v2/);
    } else {
      assert.match(source, /teacher-more-auth-bridge\.js\?v=20260806-external-teacher-canonical-v2/);
    }
    assert.match(source, /data-teacher-utility-root/);
    if (file !== 'contract.html') assert.match(source, /blockIfPortalOnly/);
  }

  const bridge = read('teacher-more-auth-bridge.js');
  assert.match(bridge, /youzi\.coursePortal\.teacher\.session\.v1/);
  assert.match(bridge, /coursePortalTeacherUtilitySession/);
  assert.match(bridge, /async function fetchUtilitySession\(\)/);
  assert.match(bridge, /saveAuthorizedUser/);
  assert.match(bridge, /portalSessionBridge:\s*true/);
  assert.doesNotMatch(bridge, /使用既有 Email／密碼|需要原員工帳號/);
  new vm.Script(bridge, { filename: 'teacher-more-auth-bridge.js' });
});

test('teacher portal session is revalidated before the six utility pages receive an employee identity', async () => {
  const bridge = read('teacher-more-auth-bridge.js');
  const storage = {
    'youzi.coursePortal.teacher.session.v1': 'teacher-session-token'
  };
  const rootNode = { innerHTML: '', querySelector() { return null; } };
  const bodyClasses = new Set();
  let reloads = 0;
  const window = {
    localStorage: {
      getItem(key) {
        return Object.hasOwn(storage, key) ? storage[key] : null;
      },
      setItem(key, value) {
        storage[key] = String(value);
      },
      removeItem(key) {
        delete storage[key];
      }
    },
    location: { pathname: '/task.html', reload() { reloads += 1; } },
    APP_CONFIG: { FIREBASE_CONFIG: { projectId: 'test-project' } }
  };
  const callableNames = [];
  const callablePayloads = [];
  window.firebase = {
    apps: [{}],
    functions() {},
    initializeApp() {},
    app() {
      return {
        functions() {
          return {
            httpsCallable(name) {
              callableNames.push(name);
              return async (payload) => {
                callablePayloads.push(payload);
                return ({ data: {
                  ok: true,
                  profileComplete: false,
                  missingProfileFields: ['緊急聯絡人'],
                  user: { employeeId: 'EMP-007', id: 'EMP-007', name: '測試老師', identityType: 'external' },
                  profile: { employeeId: 'EMP-007', name: '測試老師', idNumberMasked: 'A*****6789' }
                } });
              };
            }
          };
        }
      };
    }
  };
  const document = {
    body: {
      classList: {
        add(value) {
          bodyClasses.add(value);
        }
      }
    },
    querySelector(selector) {
      return selector === '[data-teacher-utility-root]' ? rootNode : null;
    },
    head: { appendChild() {} },
    createElement() { return {}; }
  };
  const context = vm.createContext({ window, document, encodeURIComponent, URLSearchParams, Date, Math, JSON, String, Object, Set, Promise });
  new vm.Script(bridge, { filename: 'teacher-more-auth-bridge.js' }).runInContext(context);

  assert.equal(window.YZTeacherMoreAuth.blockIfPortalOnly({ title: '協助事項' }), true);
  assert.match(rootNode.innerHTML, /正在確認協助事項/);
  assert.equal(bodyClasses.has('teacher-portal-session-only'), true);
  assert.equal(storage.employeeUser, undefined, '後端確認完成前不得建立員工身分');

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepStrictEqual(callableNames, ['coursePortalTeacherUtilitySession']);
  const bridgedUser = JSON.parse(storage.employeeUser);
  assert.equal(bridgedUser.employeeId, 'EMP-007');
  assert.equal(bridgedUser.portalSessionBridge, true);
  assert.equal(reloads, 1);
  assert.equal(window.YZTeacherMoreAuth.blockIfPortalOnly({ title: '協助事項' }), false);

  const secureResult = await window.YZTeacherMoreAuth.fetchUtilitySession({
    sessionToken: 'attacker-token',
    employeeId: 'OTHER-EMPLOYEE'
  });
  assert.equal(secureResult.profile.employeeId, 'EMP-007');
  assert.deepStrictEqual(callableNames, ['coursePortalTeacherUtilitySession', 'coursePortalTeacherUtilitySession']);
  assert.equal(JSON.stringify(callablePayloads), JSON.stringify([
    { sessionToken: 'teacher-session-token' },
    { sessionToken: 'teacher-session-token' }
  ]), '公開的安全方法只能使用當前裝置的老師 session token');
});

test('secure profile fetch clears bridged identity when the teacher session expires', async () => {
  const bridge = read('teacher-more-auth-bridge.js');
  const storage = {
    'youzi.coursePortal.teacher.session.v1': 'expired-token',
    employeeUser: JSON.stringify({ employeeId: 'EMP-007', portalSessionBridge: true }),
    employeeUserId: 'EMP-007',
    'youzi.teacherMore.authorization.v2': JSON.stringify({ employeeId: 'EMP-007' })
  };
  const window = {
    localStorage: {
      getItem(key) { return Object.hasOwn(storage, key) ? storage[key] : null; },
      setItem(key, value) { storage[key] = String(value); },
      removeItem(key) { delete storage[key]; }
    },
    location: { pathname: '/profile.html' },
    APP_CONFIG: { FIREBASE_CONFIG: { projectId: 'test-project' } },
    firebase: {
      apps: [{}],
      functions() {},
      initializeApp() {},
      app() {
        return {
          functions() {
            return {
              httpsCallable() {
                return async () => {
                  const error = new Error('登入狀態已到期，請重新登入。');
                  error.code = 'functions/unauthenticated';
                  throw error;
                };
              }
            };
          }
        };
      }
    }
  };
  const document = {
    querySelector() { return null; },
    head: { appendChild() {} },
    createElement() { return {}; }
  };
  const context = vm.createContext({ window, document, Date, Math, JSON, String, Object, Set, Promise, Error });
  new vm.Script(bridge, { filename: 'teacher-more-auth-bridge.js' }).runInContext(context);

  await assert.rejects(() => window.YZTeacherMoreAuth.fetchUtilitySession(), /登入狀態已到期/);
  assert.equal(storage['youzi.coursePortal.teacher.session.v1'], undefined);
  assert.equal(storage['youzi.teacherMore.authorization.v2'], undefined);
  assert.equal(storage.employeeUser, undefined);
  assert.equal(storage.employeeUserId, undefined);
});

test('teacher utility and external-manager pages keep inline scripts valid and static local assets present', () => {
  for (const file of [...pages, 'index.html', 'login.html', 'announcement-admin.html', 'teacher-hub.html']) {
    const source = read(file);
    inlineScripts(source).forEach((script, index) => {
      assert.doesNotThrow(
        () => new vm.Script(script, { filename: `${file}:inline-${index + 1}` })
      );
    });
    for (const target of staticLocalTargets(source)) {
      assert.ok(fs.existsSync(path.join(root, target)), `${file} links to missing ${target}`);
    }
  }
});

test('outer login presents LINE first and keeps manager password login available', () => {
  const app = read('app.js');
  assert.match(app, /function requireLogin\(\).*location\.href='index\.html'/);
  assert.match(app, /function logout\(\).*location\.href='index\.html'/);

  const gateway = read('index.html');
  assert.match(gateway, /class="login-primary-card" href="course-portal\.html\?method=line"/);
  assert.match(gateway, /class="service-email-link" href="course-portal\.html\?method=email"/);
  assert.match(gateway, /管理者／員工帳號登入/);
  assert.match(gateway, /api\('login'/);
  assert.match(gateway, /function finishInternalLogin\(user\)/);
  assert.match(gateway, /const target = requestedLoginTarget\(\) \|\| loginDestination\(user\)/);
  assert.doesNotMatch(gateway, /employeeBindText|LINE 綁定文字/);

  const legacyLogin = read('login.html');
  const methods = [...legacyLogin.matchAll(/data-primary-login-method="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepStrictEqual(methods, ['line', 'email-password']);
  assert.match(legacyLogin, /data-primary-login-method="line" href="course-portal\.html\?method=line"/);
  assert.match(legacyLogin, /data-primary-login-method="email-password"/);
  assert.match(legacyLogin, /管理者／員工登入/);
  assert.match(legacyLogin, /api\('login'/);
  assert.match(legacyLogin, /const requestedTarget = requestedLoginTarget\(\)/);
  assert.match(legacyLogin, /const target = requestedTarget \|\| loginDestination\(r\.user\)/);
  assert.match(legacyLogin, /redirectToLoginTarget\(target\)/);
  assert.match(legacyLogin, /redirectAfterLogin\(r\.user\)/);
  assert.match(legacyLogin, /const loginReturnPages = new Set/);
  assert.doesNotMatch(legacyLogin, /employeeBindText|LINE 綁定文字/);
});

test('media and inquiry regressions stay fixed', () => {
  const announcements = read('announcements.html');
  assert.match(announcements, /function usableAssets/);
  assert.match(announcements, /function linkifyText/);
  assert.match(announcements, /最近 14 天公告/);
  assert.match(announcements, /兩週前的歷史公告/);
  assert.match(announcements, /grid-template-columns:minmax\(0,1fr\)!important/);
  assert.match(announcements, /object-fit:cover/);
  assert.match(read('teacher-more-pages.css'), /body\.utility-announcements \.image-grid img[\s\S]*object-fit: contain/);

  const contractCss = read('teacher-more-pages.css');
  const contract = read('contract.html');
  const contractRuntime = read('teacher-contract.js');
  assert.match(contractCss, /body\.utility-contract \.preview-page[\s\S]*overflow: visible/);
  assert.match(contractCss, /body\.utility-contract \.stamp-box img[\s\S]*object-fit: contain/);
  assert.match(contractCss, /body\.utility-contract \.seam-stamp-half img[\s\S]*max-width: none/);
  assert.doesNotMatch(contractCss, /body\.utility-contract \.seam-stamp-half\s*\{\s*display:\s*none/);
  assert.match(contractRuntime, /snapshot\.getContext\('2d'\)\.drawImage\(canvas, 0, 0\)/);
  assert.match(contractRuntime, /if \(snapshot\) context\.drawImage\(snapshot, 0, 0, rect\.width, rect\.height\)/);

  const goods = read('teacher-goods.html');
  assert.match(goods, /id="askNeedBy" type="date"/);
  assert.match(goods, /const indexed=rows\.map\(\(row,index\)=>\(\{row,index\}\)\)/);
  assert.match(goods, /teacherRecordCard_\(row,index,true\)/);
});

test('teacher utility pages share one compact back and logout header', () => {
  [
    'announcements.html', 'task.html', 'teacher-goods.html', 'forms-hub.html',
    'teacher-profile.html', 'contract.html', 'gift-point-card.html',
    'employment-certificate.html', 'teaching-certificate.html'
  ].forEach((name) => {
    assert.match(read(name), /data-yz-teacher-nav/, `${name} 缺少老師統一頁首`);
  });
  const nav = read('global-nav.js');
  const css = read('global-nav.css');
  assert.match(nav, /back\.textContent='回老師課務'/);
  assert.match(nav, /course-portal\.html\?method=line&role=teacher/);
  assert.match(css, /\.yz-global-nav\.yz-teacher-nav/);
  assert.match(css, /min-height:40px/);
});

test('profile explains automatic LINE login and Email fallback without legacy notification choices', () => {
  const profile = read('profile.html');
  const client = read('firebase-client.js');

  assert.match(profile, /登入與通知方式/);
  assert.match(profile, /LINE[^。<]*(?:快速登入|優先通知)/);
  assert.match(profile, /(?:沒有(?:使用 )?LINE[^。<]*Email|Email[^。<]*備用)/);
  assert.doesNotMatch(profile, /name="notificationPreference"/);
  assert.doesNotMatch(profile, /請至少保留 LINE 或 Email/);
  assert.doesNotMatch(profile, />儲存通知設定</);
  assert.match(profile, /Array\.isArray\(p\.identityUrls\)/);
  assert.match(profile, /戶籍地址/);
  assert.match(profile, /通訊地址/);
  assert.match(profile, /補齊／更新外聘老師資料/);
  assert.match(profile, /url\.origin !== window\.location\.origin/);
  assert.match(profile, /external-teacher-onboarding\\\.html/);
  assert.match(profile, /請聯絡管理者退回補件/);
  assert.doesNotMatch(profile, /type="file"/, '我的資料頁不可繞過既有安全流程直接上傳證件');

  assert.match(profile, /user\.portalSessionBridge === true/);
  assert.match(profile, /window\.YZTeacherMoreAuth\.fetchUtilitySession\(\)/);
  const securePortalBranch = profile.slice(
    profile.indexOf('if(portalSessionBridge){'),
    profile.indexOf('}else{', profile.indexOf('if(portalSessionBridge){'))
  );
  assert.doesNotMatch(securePortalBranch, /firebaseOnly\(|getMyProfileFull|employeeId:user|email:user/,
    '老師 portal 資料不得 fallback 到前端人員編號查詢');
  assert.doesNotMatch(profile, /MY_PROFILE_FULL_CACHE|localStorage\.setItem\(/,
    '證件、薪資與補件 bearer 不得快取在 localStorage');
  assert.doesNotMatch(profile, /clearLineBinding|clearMyLineBindingWithFallback|clearLineBindBtn|>解除 LINE 綁定</);
  assert.match(profile, /更換或解除，請聯絡管理者處理/);
  assert.match(profile, /id="ensureLineBindBtn"[^>]*style="display:none"[^>]*disabled/);
  assert.match(profile, /id="copyLineBindBtn"[^>]*style="display:none"[^>]*disabled/);
  assert.match(profile, /id="contactChangeCard" style="display:none"/);
  assert.match(profile, /copyButton\.style\.display = portalSessionBridge \? 'none'/);
  assert.match(profile, /applyPortalSecureMode\(user\.portalSessionBridge === true\)/);
  assert.match(profile, /contactCard\.style\.display = enabled \? 'none'/);
  assert.match(profile, /請使用安全補件入口，或聯絡管理者更新授課項目/);
  assert.match(profile, /portalSessionBridge \? '目前沒有可用的 Email；請使用安全補件入口，或聯絡管理者更新/);
  assert.match(profile, /LINE 是選用的快速登入與即時提醒方式/);
  assert.match(profile, /Email 仍可獨立用於驗證登入/);

  const unifiedStart = client.indexOf('我的資料與通知設定整合 2026-06-29');
  const unifiedProfileClient = client.slice(unifiedStart);
  assert.ok(unifiedStart >= 0);
  assert.doesNotMatch(unifiedProfileClient, /externalTeacherProfiles|externalTeacherContracts|findExternalTeacherSources|findExternalTeacherRow/,
    '我的資料前端整合層不得直接讀寫外聘老師敏感 collection');
  assert.match(unifiedProfileClient, /localUser\(\)\.portalSessionBridge===true[\s\S]*老師課務登入請使用安全資料管道/);
  assert.match(unifiedProfileClient, /a==='clearMyLineBindingWithFallback'[\s\S]*請由管理者處理/);
  assert.match(unifiedProfileClient, /localUser\(\)\.portalSessionBridge===true[\s\S]*saveMyTeachingAbilities[\s\S]*submitProfileChangeRequest[\s\S]*安全補件入口/);
});
