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
    assert.match(source, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/);
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

  for (const file of ['index.html', 'login.html']) {
    const source = read(file);
    assert.match(source, /btn\.dataset\.resumeTarget = target/);
    assert.match(source, /redirectAfterLogin\(r\.user\)/);
    assert.match(source, /progress\.reset\('進入系統'\)/);
    assert.doesNotMatch(source, /setTimeout\(\(\) => redirectAfterLogin/);
  }
});

test('login pages group all public portals under other entries', () => {
  for (const file of ['index.html', 'login.html']) {
    const source = read(file);
    assert.match(source, /href="student-course-portal\.html"[^>]*>學生／家長入口</);
    assert.match(source, /href="room-booking\.html"[^>]*>教室租用入口</);
    assert.match(source, /href="teacher-course-portal\.html"[^>]*>老師入口</);
    assert.match(source, /href="teacher-apply\.html"[^>]*>應聘履歷投遞</);
    assert.match(source, /href="rental-order\.html"[^>]*>設備租賃申請</);
    assert.match(source, /class="external-entry-grid"/);
  }
});
