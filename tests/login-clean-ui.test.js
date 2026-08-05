const fs = require('fs');
const path = require('path');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function inlineScripts(source) {
  return [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((script) => script.trim());
}

test('both login entries keep secondary actions in one compact white row', () => {
  for (const file of ['index.html', 'login.html']) {
    const source = read(file);
    assert.match(source, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)(?:!important)?/);
    assert.match(source, /background:#fff!important/);
    assert.match(source, /color:#17252f!important/);
    assert.match(source, />忘記密碼</);
    assert.match(source, />重設密碼</);
    assert.match(source, />前往註冊</);
    assert.doesNotMatch(source, /前往註冊\s*\/\s*簽約/);
    for (const script of inlineScripts(source)) {
      assert.doesNotThrow(() => new vm.Script(script, { filename: file }));
    }
  }
});

test('successful login redirects immediately and exposes a retry navigation', () => {
  const app = read('app.js');
  assert.match(app, /function loginDestination\(user\)/);
  assert.match(app, /window\.location\.replace\(target\)/);

  const legacyLogin = read('login.html');
  assert.match(legacyLogin, /btn\.dataset\.resumeTarget = target/);
  assert.match(legacyLogin, /redirectAfterLogin\(r\.user\)/);
  assert.match(legacyLogin, /progress\.reset\('進入系統'\)/);
  assert.doesNotMatch(legacyLogin, /setTimeout\(\(\) => redirectAfterLogin/);

  const gateway = read('index.html');
  assert.match(gateway, /function finishInternalLogin\(user\)/);
  assert.match(gateway, /if \(redirecting\) return/);
  assert.match(gateway, /requestedLoginTarget\(\) \|\| loginDestination\(user\)/);
  assert.match(gateway, /window\.location\.replace\(target\)/);
  assert.match(gateway, /finishInternalLogin\(result\.user\)/);
  assert.doesNotMatch(gateway, /setTimeout\(\(\) => finishInternalLogin/);
});

test('public role login links all enter through the central role selector', () => {
  const gateway = read('index.html');
  assert.match(gateway, /href="course-portal\.html\?method=line"[^>]*id="lineGateway"/);
  assert.match(gateway, /href="course-portal\.html\?method=email"/);
  assert.doesNotMatch(gateway, /href="(?:student-course-portal|teacher-course-portal|room-booking)\.html"/);

  const legacyLogin = read('login.html');
  assert.match(legacyLogin, /href="course-portal\.html\?method=line"[^>]*data-primary-login-method="line"|data-primary-login-method="line"[^>]*href="course-portal\.html\?method=line"/);
  assert.match(legacyLogin, /href="course-portal\.html\?method=line&amp;role=student"[^>]*>學生／家長入口</);
  assert.match(legacyLogin, /href="course-portal\.html\?method=line&amp;role=renter"[^>]*>教室租用入口</);
  assert.match(legacyLogin, /href="course-portal\.html\?method=line&amp;role=teacher"[^>]*>老師入口</);
  assert.match(legacyLogin, /href="teacher-apply\.html"[^>]*>應聘履歷投遞</);
  assert.match(legacyLogin, /href="rental-order\.html"[^>]*>設備租賃申請</);
  assert.match(legacyLogin, /class="external-entry-grid"/);
  assert.doesNotMatch(legacyLogin, /href="(?:student-course-portal|teacher-course-portal|room-booking)\.html"/);
});
