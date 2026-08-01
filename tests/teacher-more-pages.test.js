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
    assert.match(source, /teacher-more-pages\.css\?v=20260730-teacher-more-v1/);
    assert.match(source, /teacher-more-auth-bridge\.js\?v=20260801-teacher-session-v2/);
    assert.match(source, /data-teacher-utility-root/);
    assert.match(source, /blockIfPortalOnly/);
  }

  const bridge = read('teacher-more-auth-bridge.js');
  assert.match(bridge, /youzi\.coursePortal\.teacher\.session\.v1/);
  assert.match(bridge, /coursePortalTeacherUtilitySession/);
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
              return async (payload) => ({
                data: {
                  ok: true,
                  profileComplete: false,
                  missingProfileFields: ['緊急聯絡人'],
                  user: { employeeId: 'EMP-007', id: 'EMP-007', name: '測試老師', identityType: 'external' },
                  payload
                }
              });
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
  const context = vm.createContext({ window, document, encodeURIComponent, Date, Math, JSON, String, Object, Set, Promise });
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
});

test('teacher utility pages keep inline scripts valid and static local assets present', () => {
  for (const file of [...pages, 'index.html', 'login.html']) {
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

test('outer login presents LINE first and legacy Email password second', () => {
  const app = read('app.js');
  assert.match(app, /function requireLogin\(\).*location\.href='index\.html'/);
  assert.match(app, /function logout\(\).*location\.href='index\.html'/);

  for (const file of ['index.html', 'login.html']) {
    const source = read(file);
    const methods = [...source.matchAll(/data-primary-login-method="([^"]+)"/g)]
      .map((match) => match[1]);
    assert.deepStrictEqual(methods, ['line', 'email-password']);
    assert.match(source, /data-primary-login-method="line" href="course-portal\.html"/);
    assert.doesNotMatch(source, /老師、學生／家長與教室租用/);
    assert.doesNotMatch(source, /管理者後台不使用此登入/);
    assert.doesNotMatch(source, /LINE 最快；既有管理者與員工帳號/);
    assert.match(source, /data-primary-login-method="email-password"/);
    assert.match(source, /管理者／員工登入/);
    assert.match(source, /api\('login'/);
    assert.match(source, /const requestedTarget = requestedLoginTarget\(\)/);
    assert.match(source, /const target = requestedTarget \|\| loginDestination\(r\.user\)/);
    assert.match(source, /redirectToLoginTarget\(target\)/);
    assert.match(source, /redirectAfterLogin\(r\.user\)/);
    assert.match(source, /const loginReturnPages = new Set/);
    assert.doesNotMatch(source, /employeeBindText|LINE 綁定文字/);
  }
});

test('media and inquiry regressions stay fixed', () => {
  const announcements = read('announcements.html');
  assert.match(announcements, /function usableAssets/);
  assert.match(announcements, /object-fit:cover/);
  assert.match(read('teacher-more-pages.css'), /body\.utility-announcements \.image-grid img[\s\S]*object-fit: contain/);

  const contractCss = read('teacher-more-pages.css');
  const contract = read('contract.html');
  assert.match(contractCss, /body\.utility-contract \.preview-page[\s\S]*overflow: visible/);
  assert.match(contractCss, /body\.utility-contract \.stamp-box img[\s\S]*object-fit: contain/);
  assert.match(contractCss, /body\.utility-contract \.seam-stamp-half img[\s\S]*max-width: none/);
  assert.doesNotMatch(contractCss, /body\.utility-contract \.seam-stamp-half\s*\{\s*display:\s*none/);
  assert.match(contract, /snapshot\.getContext\('2d'\)\.drawImage\(signCanvas,0,0\)/);
  assert.match(contract, /if\(snapshot\)ctx\.drawImage\(snapshot,0,0,rect\.width,rect\.height\)/);

  const goods = read('teacher-goods.html');
  assert.match(goods, /id="askNeedBy" type="date"/);
  assert.match(goods, /const indexed=rows\.map\(\(row,index\)=>\(\{row,index\}\)\)/);
  assert.match(goods, /teacherRecordCard_\(row,index,true\)/);
});
