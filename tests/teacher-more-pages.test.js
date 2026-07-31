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
    assert.match(source, /teacher-more-auth-bridge\.js\?v=20260730-teacher-more-v1/);
    assert.match(source, /data-teacher-utility-root/);
    assert.match(source, /blockIfPortalOnly/);
  }

  const bridge = read('teacher-more-auth-bridge.js');
  assert.match(bridge, /youzi\.coursePortal\.teacher\.session\.v1/);
  assert.match(bridge, /使用既有 Email／密碼/);
  assert.match(bridge, /不會自動建立、合併或偽造舊員工登入/);
  assert.doesNotMatch(bridge, /setItem\s*\(\s*['"]employeeUser['"]/);
  new vm.Script(bridge, { filename: 'teacher-more-auth-bridge.js' });
});

test('LINE-only teacher sessions are blocked without manufacturing legacy authorization', () => {
  const bridge = read('teacher-more-auth-bridge.js');
  const storage = {
    'youzi.coursePortal.teacher.session.v1': 'teacher-session-token'
  };
  const rootNode = { innerHTML: '' };
  const bodyClasses = new Set();
  const window = {
    localStorage: {
      getItem(key) {
        return Object.hasOwn(storage, key) ? storage[key] : null;
      }
    },
    location: { pathname: '/task.html' }
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
    }
  };
  const context = vm.createContext({ window, document, encodeURIComponent });
  new vm.Script(bridge, { filename: 'teacher-more-auth-bridge.js' }).runInContext(context);

  assert.equal(window.YZTeacherMoreAuth.blockIfPortalOnly({ title: '協助事項' }), true);
  assert.match(rootNode.innerHTML, /需要原員工帳號/);
  assert.match(rootNode.innerHTML, /index\.html\?next=task\.html/);
  assert.equal(bodyClasses.has('teacher-portal-session-only'), true);
  assert.equal(storage.employeeUser, undefined);

  storage.employeeUser = JSON.stringify({ id: 'legacy-user' });
  rootNode.innerHTML = '';
  assert.equal(window.YZTeacherMoreAuth.blockIfPortalOnly({ title: '協助事項' }), false);
  assert.equal(rootNode.innerHTML, '');
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
