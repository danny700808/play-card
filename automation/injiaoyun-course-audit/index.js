'use strict';

const admin = require('firebase-admin');
const { chromium } = require('playwright');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const API_ROOT = 'https://api.injiaoyun.com/v1';
const LOGIN_URL = 'https://www.injiaoyun.com/dashboard/#/login/signin';
const CALENDAR_URL = 'https://www.injiaoyun.com/dashboard/#/app/roomCalendar/day';
const TIME_ZONE = process.env.TZ || 'Asia/Taipei';
const START_DATE = process.env.AUDIT_START_DATE || '2026-07-23';
const END_DATE = process.env.AUDIT_END_DATE || '2026-07-24';
const VERSION = '2026.09.07-v5-validated-calendar';
const RUNS = db.collection('opsInjiaoyunCourseAuditV3Runs');

const SOURCES = [
  { key: 'student-payment-details', path: '' },
  { key: 'student-payments-all', path: '/students/payments/all' },
  { key: 'student-payments-open', path: '/students/payments/not/finish' },
  { key: 'fixed-course', path: '/fixCourses/', calendar: true },
  { key: 'adjusted-course', path: '/tempCourses/', calendar: true },
  { key: 'leave', path: '/leaves/', calendar: true },
  { key: 'rental', path: '/rentSpaces/', calendar: true },
  { key: 'checkin-skip', path: '/checkins/skips', calendar: true },
  { key: 'checkin-leave', path: '/checkins/leaves', calendar: true },
  { key: 'room', path: '/rooms' },
  { key: 'student', path: '/students/' },
  { key: 'teacher', path: '/teachers/' },
  { key: 'subject', path: '/subjects' },
  { key: 'charge', path: '/Charges' },
  { key: 'leave-reason', path: '/leaves/reason' }
];

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function objectId(value) {
  const candidate = clean(value);
  return /^[a-f0-9]{24}$/i.test(candidate) ? candidate : '';
}

function idOf(value) {
  if (value && typeof value === 'object') return clean(value.id || value._id);
  return clean(value);
}

function nameOf(value) {
  if (Array.isArray(value)) return value.map(nameOf).filter(Boolean).join('、');
  if (value && typeof value === 'object') {
    return clean(value.name || value.title || value.label || value.clientName);
  }
  return clean(value);
}

function objectIdFrom(value) {
  if (!value) return '';
  if (typeof value !== 'object') return objectId(value);
  const candidates = [
    value._id,
    value.id,
    value.studioId,
    value.studio_id,
    value.studio && value.studio._id,
    value.studio && value.studio.id
  ];
  for (const candidate of candidates) {
    const found = objectId(candidate);
    if (found) return found;
  }
  return '';
}

function hash(value) {
  let result = 2166136261;
  const input = clean(value);
  for (let index = 0; index < input.length; index += 1) {
    result ^= input.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function safe(value) {
  return JSON.parse(JSON.stringify(value == null ? null : value));
}

const PRIVATE_KEY_PATTERN = /password|token|secret|phone|email|line_user|line_notify|authorization/i;

function sanitize(value, seen = new WeakSet()) {
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[循環資料]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, seen));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (PRIVATE_KEY_PATTERN.test(key)) continue;
    output[key] = sanitize(item, seen);
  }
  return output;
}

function validDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(clean(value));
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function localTime(value) {
  const raw = clean(value);
  if (/^\d{1,2}(?:\.\d+)?$/.test(raw)) {
    const decimal = Number(raw);
    if (Number.isFinite(decimal) && decimal >= 0 && decimal < 24) {
      const hours = Math.floor(decimal);
      const minutes = Math.round((decimal - hours) * 60);
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  }
  const plain = raw.match(/(?:T|\s)(\d{2}):(\d{2})/);
  if (plain) return `${plain[1]}:${plain[2]}`;
  const short = raw.match(/^(\d{1,2}):(\d{2})/);
  if (short) return `${short[1].padStart(2, '0')}:${short[2]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function dateAtNoon(dateKey) {
  return new Date(`${dateKey}T12:00:00+08:00`);
}

function rangeDateKeys() {
  if (!validDateKey(START_DATE) || !validDateKey(END_DATE) || START_DATE > END_DATE) {
    throw new Error('AUDIT_START_DATE / AUDIT_END_DATE 格式錯誤。');
  }
  const keys = [];
  const cursor = dateAtNoon(START_DATE);
  const end = dateAtNoon(END_DATE);
  while (cursor <= end && keys.length < 32) {
    keys.push(localDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

function strictDateKey(sourceKey, row) {
  if (!row || typeof row !== 'object') return '';
  if (sourceKey === 'leave') return localDateKey(row.date || row.leaveDate);
  if (sourceKey === 'rental') return localDateKey(row.startDate || row.date);
  if (sourceKey === 'adjusted-course') return localDateKey(row.startDate || row.date);
  if (sourceKey === 'checkin-skip' || sourceKey === 'checkin-leave') {
    return localDateKey(row.date || row.checkinDate || row.leaveDate);
  }
  return localDateKey(row.date || row.startDate);
}

function inRange(sourceKey, row) {
  const key = strictDateKey(sourceKey, row);
  return Boolean(key && key >= START_DATE && key <= END_DATE);
}

function isActiveFixedCourse(row, dateKey) {
  const seed = localDateKey(row.startDate || row.startsAt || row.created);
  if (!seed || seed > dateKey) return false;
  // 經 2026-07-24 實際日表核對：
  // fixedCourses.end === false 表示這筆固定課已停用；
  // 學生的 end === true 表示該生已結束這個固定課。
  if (row.end === false) return false;
  const students = Array.isArray(row.students) ? row.students : [row.student].filter(Boolean);
  if (students.length && students.every((student) => {
    return student && typeof student === 'object' && student.end === true;
  })) return false;
  // 音教雲 fixedCourses 的 `end` 是布林值，不是日期。
  // 若把 true 當日期會變成 1970-01-01，導致歷史固定課全部被誤刪。
  const stopped = localDateKey(row.endDate || row.stoppedAt || row.cancelledAt);
  if (stopped && stopped < dateKey) return false;
  if (dateAtNoon(seed).getDay() !== dateAtNoon(dateKey).getDay()) return false;

  const frequency = clean(row.frequency).toLowerCase();
  if (frequency.includes('隔') || frequency.includes('bi') || frequency === '2') {
    const days = Math.round((dateAtNoon(dateKey) - dateAtNoon(seed)) / 86400000);
    return Math.floor(days / 7) % 2 === 0;
  }
  return true;
}

function recordsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['data', 'rows', 'items', 'results', 'records']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [payload];
}

function lookupName(value, lookup) {
  const direct = nameOf(value);
  const id = idOf(value);
  if (id && lookup && lookup.has(id)) return lookup.get(id);
  return direct && direct !== id ? direct : '';
}

function buildNameLookup(records) {
  const result = new Map();
  for (const record of records || []) {
    const id = idOf(record);
    const name = nameOf(record);
    if (id && name && name !== id) result.set(id, name);
  }
  return result;
}

function calendarRows(sourceKey, records, dateKeys, lookups) {
  const rows = [];
  for (const record of records) {
    const targets = sourceKey === 'fixed-course'
      ? dateKeys.filter((dateKey) => isActiveFixedCourse(record, dateKey))
      : [strictDateKey(sourceKey, record)].filter(
          (dateKey) => dateKey && dateKey >= START_DATE && dateKey <= END_DATE
        );

    for (const dateKey of targets) {
      const students = record.students || record.student;
      const client = record.client;
      const studentList = (Array.isArray(students) ? students : [students]).filter(Boolean);
      rows.push({
        sourceType: sourceKey,
        sourceId: idOf(record) || hash(JSON.stringify(record)),
        dateKey,
        startsAt: localTime(record.startsAt || record.startTime || record.time),
        endsAt: localTime(record.endsAt || record.endTime),
        roomId: idOf(record.room),
        roomName: lookupName(record.room, lookups.room),
        studentIds: studentList.map(idOf),
        studentNames: studentList.map((item) => lookupName(item, lookups.student)).filter(Boolean).join('、'),
        clientName: nameOf(client),
        teacherId: idOf(record.teacher),
        teacherName: lookupName(record.teacher, lookups.teacher),
        subjectId: idOf(record.subject),
        subjectName: lookupName(record.subject, lookups.subject),
        createdAtSource: clean(record.created || record.createdAt),
        updatedAtSource: clean(record.updated || record.updatedAt),
        endedFlag: typeof record.end === 'boolean' ? record.end : null,
        cancel: Boolean(record.cancel),
        alreadyCheckin: Boolean(record.alreadyCheckin),
        deductLesson: sourceKey !== 'rental'
      });
    }
  }
  return rows;
}

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        if (await locator.isVisible()) return locator;
      } catch (_) {}
    }
  }
  return null;
}

async function readLoginState(page) {
  return page.evaluate(() => {
    function parse(raw) {
      if (raw == null) return null;
      try { return JSON.parse(raw); } catch (_) { return String(raw).replace(/^"|"$/g, ''); }
    }
    function find(key) {
      const candidates = [`ngStorage-${key}`, key];
      for (let index = 0; index < localStorage.length; index += 1) {
        const current = localStorage.key(index);
        if (current && current.toLowerCase().endsWith(key.toLowerCase()) && !candidates.includes(current)) {
          candidates.push(current);
        }
      }
      for (const candidate of candidates) {
        const raw = localStorage.getItem(candidate);
        if (raw != null) return parse(raw);
      }
      return null;
    }
    return { token: find('token'), studio: find('studio') };
  });
}

async function enterOnlyStudio(page) {
  const state = await readLoginState(page);
  if (objectIdFrom(state.studio)) return;
  const enterButton = await firstVisible(page, [
    'button:has-text("進入")',
    'a:has-text("進入")',
    'input[type="button"][value*="進入"]',
    'input[type="submit"][value*="進入"]',
    '[ng-click*="enter" i]',
    '[ng-click*="studio" i]'
  ]);
  if (!enterButton) return;
  await enterButton.click();
  await page.waitForTimeout(1800);
}

async function signIn() {
  const email = clean(process.env.INJIAOYUN_EMAIL);
  const password = clean(process.env.INJIAOYUN_PASSWORD);
  if (!email || !password) throw new Error('尚未設定 INJIAOYUN_EMAIL 或 INJIAOYUN_PASSWORD。');

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox']
  });
  const context = await browser.newContext({
    locale: 'zh-TW',
    timezoneId: TIME_ZONE,
    viewport: { width: 1365, height: 900 }
  });
  const page = await context.newPage();

  try {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);
    let state = await readLoginState(page);

    if (!clean(state.token)) {
      const emailInput = await firstVisible(page, [
        'input[type="email"]',
        'input[name="email"]',
        'input[ng-model*="email" i]',
        'input[placeholder*="信箱"]',
        'input[placeholder*="帳號"]',
        'input[type="text"]'
      ]);
      const passwordInput = await firstVisible(page, [
        'input[type="password"]',
        'input[name="password"]',
        'input[ng-model*="password" i]',
        'input[placeholder*="密碼"]'
      ]);
      if (!emailInput || !passwordInput) throw new Error('找不到音教雲登入欄位。');
      await emailInput.fill(email);
      await passwordInput.fill(password);

      const loginButton = await firstVisible(page, [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("登入")',
        'a:has-text("登入")',
        '[ng-click*="login" i]'
      ]);
      if (!loginButton) throw new Error('找不到音教雲登入按鈕。');
      await loginButton.click();
      await page.waitForFunction(() => {
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index) || '';
          if (key.toLowerCase().endsWith('token') && localStorage.getItem(key)) return true;
        }
        return false;
      }, null, { timeout: 60000 });
      await page.waitForTimeout(1200);
    }

    await enterOnlyStudio(page);
    state = await readLoginState(page);
    const token = clean(state.token);
    let studioId = objectId(process.env.INJIAOYUN_STUDIO_ID) || objectIdFrom(state.studio);
    if (!studioId) {
      studioId = await page.evaluate(() => {
        const entries = performance.getEntriesByType('resource').slice().reverse();
        for (const entry of entries) {
          const match = String(entry && entry.name || '').match(/\/v1\/studios\/([a-f0-9]{24})(?:\/|$)/i);
          if (match) return match[1];
        }
        return '';
      });
    }
    if (!token) throw new Error('登入後找不到權杖。');
    if (!studioId) throw new Error('登入後找不到機構編號；可設定 INJIAOYUN_STUDIO_ID。');
    return { browser, context, page, token, studioId, studioName: nameOf(state.studio) };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function apiGet(studioId, token, suffix, label) {
  const response = await fetch(`${API_ROOT}/studios/${encodeURIComponent(studioId)}${suffix}`, {
    method: 'GET',
    headers: {
      Authorization: token,
      Accept: 'application/json'
    }
  });
  const text = await response.text();
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${label}讀取失敗：登入失效或權限不足。`);
  }
  if (!response.ok) throw new Error(`${label}讀取失敗（HTTP ${response.status}）。`);
  if (!text.trim()) return [];
  const payload = JSON.parse(text);
  return payload && payload.data != null ? payload.data : payload;
}

function apiPath(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch (_) {
    return clean(url).slice(0, 500);
  }
}

function compactSanitizedRecord(record) {
  const cleaned = sanitize(record);
  const serialized = JSON.stringify(cleaned);
  if (serialized.length <= 300000) return cleaned;
  return {
    omittedBecauseTooLarge: true,
    byteLength: Buffer.byteLength(serialized),
    keys: cleaned && typeof cleaned === 'object' ? Object.keys(cleaned) : []
  };
}

async function displayedCalendarDate(page) {
  return page.evaluate(() => {
    const text = document.body ? document.body.innerText : '';
    const match = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (!match) return '';
    return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  });
}

async function markCalendarArrow(page, direction) {
  return page.evaluate((wanted) => {
    document.querySelectorAll('[data-course-audit-arrow]').forEach((node) => {
      node.removeAttribute('data-course-audit-arrow');
    });
    const visible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 15 && rect.height > 15;
    };
    const controls = [
      ...document.querySelectorAll('button, a, [ng-click], [data-ng-click], [onclick]')
    ].filter(visible);
    const explicit = controls.find((node) => {
      const marker = [
        node.innerText,
        node.getAttribute('title'),
        node.getAttribute('aria-label'),
        node.getAttribute('ng-click'),
        node.className,
        node.innerHTML
      ].join(' ').toLowerCase();
      return wanted === 'prev'
        ? /(^|\s)(<|‹)(\s|$)|prev|previous|chevron-left|angle-left|上一天|前一天/.test(marker)
        : /(^|\s)(>|›)(\s|$)|next|chevron-right|angle-right|下一天|後一天/.test(marker);
    });
    if (explicit) {
      explicit.setAttribute('data-course-audit-arrow', wanted);
      return true;
    }
    const chooser = controls.find((node) => (node.innerText || '').includes('選擇日期'));
    if (!chooser) return false;
    const chooserRect = chooser.getBoundingClientRect();
    const nearby = controls
      .filter((node) => {
        if (node === chooser) return false;
        const rect = node.getBoundingClientRect();
        return Math.abs(rect.top - chooserRect.top) < 30 &&
          rect.right <= chooserRect.left + 10 &&
          rect.left >= chooserRect.left - 220;
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    if (nearby.length < 2) return false;
    const target = wanted === 'prev' ? nearby[nearby.length - 2] : nearby[nearby.length - 1];
    target.setAttribute('data-course-audit-arrow', wanted);
    return true;
  }, direction);
}

async function tryDateChooser(page, dateKey) {
  const picker = page.locator('table.uib-daypicker:visible');
  if (!await picker.count()) await page.getByRole('button', { name: '選擇日期', exact: true }).click();
  await picker.waitFor({ state: 'visible', timeout: 10000 });
  const [year, month, day] = dateKey.split('-');
  const target = Number(year) * 12 + Number(month);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const title = await picker.locator('.uib-title').innerText();
    const match = title.match(/(\d{4})年\s*(\d{1,2})月/);
    if (!match) throw new Error('無法辨識日曆月份');
    const current = Number(match[1]) * 12 + Number(match[2]);
    if (current === target) {
      await picker.locator('td.uib-day button').filter({ has: page.locator('span:not(.text-muted)') }).filter({ hasText: new RegExp(`^${day}$`) }).click();
      await page.waitForFunction((wanted) => document.body.innerText.includes(`${wanted.slice(0,4)}年${wanted.slice(5,7)}月${wanted.slice(8,10)}日`), dateKey, { timeout: 15000 });
      return await displayedCalendarDate(page) === dateKey;
    }
    await picker.locator(current > target ? '.uib-left' : '.uib-right').click();
  }
  throw new Error(`日期選擇失敗：${dateKey}`);
}

async function legacyDateChooserUnused(page, dateKey) {
  const chooser = page.getByText('選擇日期', { exact: false }).first();
  if (!await chooser.count()) return false;
  try {
    await chooser.click();
    await page.waitForTimeout(300);
    const dateInput = page.locator('input[type="date"]:visible').first();
    if (!await dateInput.count()) return false;
    await dateInput.fill(dateKey);
    await dateInput.dispatchEvent('change');
    const confirm = page.locator('button:visible, a:visible').filter({ hasText: /確定|套用/ }).last();
    if (await confirm.count()) await confirm.click();
    else await dateInput.press('Enter');
    await page.waitForTimeout(1000);
    return await displayedCalendarDate(page) === dateKey;
  } catch (_) {
    return false;
  }
}

async function goToCalendarDate(page, dateKey) {
  if (await displayedCalendarDate(page) === dateKey) return true;
  if (await tryDateChooser(page, dateKey)) return true;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = await displayedCalendarDate(page);
    if (current === dateKey) return true;
    if (!validDateKey(current)) return false;
    const direction = current > dateKey ? 'prev' : 'next';
    if (!await markCalendarArrow(page, direction)) return false;
    const arrow = page.locator(`[data-course-audit-arrow="${direction}"]`).first();
    if (!await arrow.count()) return false;
    await arrow.click();
    await page.waitForTimeout(550);
  }
  return await displayedCalendarDate(page) === dateKey;
}

async function extractDaySnapshot(page, requestedDate) {
  return page.evaluate((requested) => {
    const bodyText = document.body ? document.body.innerText : '';
    const dateMatch = bodyText.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    const displayedDate = dateMatch
      ? `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`
      : '';
    const numberAfter = (label) => {
      const match = bodyText.match(new RegExp(`${label}\\s*[:：]?\\s*(\\d+)`));
      return match ? Number(match[1]) : null;
    };
    const cards = [];
    const seen = new Set();
    for (const node of document.querySelectorAll('div, td, li, a')) {
      const text = String(node.innerText || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 120 || !/[\u3400-\u9fff]/.test(text)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 45 || rect.height < 20 || rect.width > 500 || rect.height > 350) continue;
      const style = getComputedStyle(node);
      const background = style.backgroundColor;
      if (!background || background === 'transparent' || background === 'rgba(0, 0, 0, 0)' ||
          background === 'rgb(255, 255, 255)') continue;
      const signature = `${Math.round(rect.left)}|${Math.round(rect.top)}|${text}|${background}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      cards.push({
        text,
        background,
        opacity: style.opacity,
        className: String(node.className || '').slice(0, 300),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
    }
    return {
      requestedDate: requested,
      displayedDate,
      matchedRequestedDate: displayedDate === requested,
      headerCounts: {
        students: numberAfter('學生'),
        leaves: numberAfter('請假'),
        fixedCourses: numberAfter('固定')
      },
      visibleCards: cards.slice(0, 300)
    };
  }, requestedDate);
}

async function captureCalendarDays(page, dateKeys) {
  const state = { requestedDate: 'initial' };
  const captures = [];
  const pending = [];
  const listener = (response) => {
    const url = response.url();
    if (!url.startsWith(API_ROOT)) return;
    const path = apiPath(url);
    if (!/room|course|leave|rent|checkin|calendar|space/i.test(path)) return;
    const task = (async () => {
      const headers = await response.allHeaders();
      const contentType = clean(headers['content-type']);
      if (!contentType.includes('json') || !response.ok()) return;
      const payload = await response.json();
      const records = recordsFrom(payload && payload.data != null ? payload.data : payload);
      records.slice(0, 1500).forEach((record, index) => {
        captures.push({
          requestedDate: state.requestedDate,
          urlPath: path.slice(0, 800),
          responseStatus: response.status(),
          recordIndex: index,
          record: compactSanitizedRecord(record)
        });
      });
    })().catch(() => {});
    pending.push(task);
  };

  page.on('response', listener);
  const snapshots = [];
  try {
    await page.goto(CALENDAR_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1800);
    for (const dateKey of dateKeys) {
      state.requestedDate = dateKey;
      const reached = await goToCalendarDate(page, dateKey);
      if (!reached) throw new Error(`日表未切到 ${dateKey}，停止擷取`);
      await page.waitForTimeout(1200);
      const snapshot = await extractDaySnapshot(page, dateKey);
      snapshot.navigationSucceeded = reached;
      if (!snapshot.matchedRequestedDate || Object.values(snapshot.headerCounts).some(value => value === null)) {
        throw new Error(`日表 ${dateKey} 日期或頁面統計不完整，停止擷取`);
      }
      snapshots.push(snapshot);
      console.log(`VERIFIED_DAY ${dateKey} ${JSON.stringify(snapshot.headerCounts)}`);
    }
    await Promise.allSettled(pending);
  } finally {
    page.off('response', listener);
  }
  if (captures.length >= 5000) throw new Error('日表來源達到 5000 筆上限，請縮小日期範圍');
  return { snapshots, captures };
}

async function writeChunks(refs) {
  for (let index = 0; index < refs.length; index += 350) {
    const batch = db.batch();
    for (const item of refs.slice(index, index + 350)) {
      batch.set(item.ref, item.data, { merge: false });
    }
    await batch.commit();
  }
}

async function main() {
  const runId = `${START_DATE.replaceAll('-', '')}-${END_DATE.replaceAll('-', '')}-${Date.now()}`;
  const runRef = RUNS.doc(runId);
  const dateKeys = rangeDateKeys();
  let browser;

  await runRef.set({
    runId,
    version: VERSION,
    status: 'running',
    startDate: START_DATE,
    endDate: END_DATE,
    readOnly: true,
    productAndSalesExcluded: true,
    startedAt: FieldValue.serverTimestamp()
  });

  try {
    const session = await signIn();
    browser = session.browser;
    const sourceResults = {};

    for (const source of SOURCES.filter(source => source.path)) {
      console.log(`讀取 ${source.key} ...`);
      const payload = await apiGet(session.studioId, session.token, source.path, source.key);
      sourceResults[source.key] = recordsFrom(payload);
      console.log(`${source.key}: ${sourceResults[source.key].length}`);
    }

    const affectedStudents = new Set();
    const masterFloor = process.env.AUDIT_MASTER_START_DATE || '2026-07-21';
    for (const row of sourceResults['student-payments-all'] || []) {
      const dates = [row.created, row.updated, row.startDate, ...(row.payList || []).map(payment => payment.date)];
      if (dates.some(value => String(value || '').slice(0,10) >= masterFloor)) affectedStudents.add(idOf(row.student));
    }
    sourceResults['student-payment-details'] = [];
    for (const studentId of affectedStudents) {
      if (!studentId) continue;
      const payload = await apiGet(session.studioId, session.token, `/students/${encodeURIComponent(studentId)}/payments`, 'student-payment-details');
      sourceResults['student-payment-details'].push(...recordsFrom(payload).map(row => ({ ...row, student: row.student || studentId })));
    }

    console.log('逐日讀取課程日表畫面與實際課務回應 ...');
    const pageCapture = await captureCalendarDays(session.page, dateKeys);
    console.log(`日表畫面: ${pageCapture.snapshots.length}`);
    console.log(`日表課務回應紀錄: ${pageCapture.captures.length}`);

    const rawWrites = [];
    const candidateRows = [];
    const counts = {};
    const lookups = {
      room: buildNameLookup(sourceResults.room),
      subject: buildNameLookup(sourceResults.subject),
      teacher: buildNameLookup(sourceResults.teacher),
      student: buildNameLookup(sourceResults.student)
    };

    for (const source of SOURCES) {
      const records = sourceResults[source.key] || [];
      counts[source.key] = records.length;
      records.forEach((record, index) => {
        const sourceId = idOf(record) || `${index}-${hash(JSON.stringify(record))}`;
        rawWrites.push({
          ref: runRef.collection('rawRecords').doc(`${source.key}-${hash(sourceId)}`),
          data: {
            sourceType: source.key,
            sourceId,
            relevantToRange: source.key === 'fixed-course' ? true : inRange(source.key, record),
            raw: sanitize(record)
          }
        });
      });
      if (source.calendar) {
        candidateRows.push(...calendarRows(source.key, records, dateKeys, lookups));
      }
    }

    const candidateWrites = candidateRows.map((row, index) => ({
      ref: runRef.collection('calendarCandidates').doc(`${row.dateKey}-${hash(`${row.sourceType}-${row.sourceId}-${index}`)}`),
      data: safe(row)
    }));
    const snapshotWrites = pageCapture.snapshots.map((snapshot) => ({
      ref: runRef.collection('daySnapshots').doc(snapshot.requestedDate),
      data: safe(snapshot)
    }));
    const pageCaptureWrites = pageCapture.captures.map((capture, index) => ({
      ref: runRef.collection('pageRawRecords').doc(
        `${clean(capture.requestedDate).replaceAll('-', '')}-${hash(`${capture.urlPath}-${capture.recordIndex}-${index}`)}`
      ),
      data: safe(capture)
    }));

    await writeChunks(rawWrites);
    await writeChunks(candidateWrites);
    await writeChunks(snapshotWrites);
    await writeChunks(pageCaptureWrites);

    const daily = {};
    for (const dateKey of dateKeys) {
      const rows = candidateRows.filter((row) => row.dateKey === dateKey);
      daily[dateKey] = {
        totalCandidates: rows.length,
        fixedCourse: rows.filter((row) => row.sourceType === 'fixed-course').length,
        adjustedCourse: rows.filter((row) => row.sourceType === 'adjusted-course').length,
        leave: rows.filter((row) => row.sourceType === 'leave').length,
        rental: rows.filter((row) => row.sourceType === 'rental').length,
        displayedHeader: pageCapture.snapshots.find((snapshot) => snapshot.requestedDate === dateKey)?.headerCounts || null,
        displayedDateMatched: Boolean(
          pageCapture.snapshots.find((snapshot) => snapshot.requestedDate === dateKey)?.matchedRequestedDate
        )
      };
    }

    await runRef.set({
      status: 'success',
      studioId: session.studioId,
      studioName: session.studioName,
      sourceCounts: counts,
      rawRecordCount: rawWrites.length,
      calendarCandidateCount: candidateRows.length,
      daySnapshotCount: snapshotWrites.length,
      pageRawRecordCount: pageCaptureWrites.length,
      daily,
      notes: [
        '本次同時讀取課務端點及課程日表頁面的實際課務回應。',
        '租用只使用 startDate；請假只使用 date；單堂／調課只使用 startDate，不再以建立日或更新日冒充上課日。',
        'daySnapshots 保存每日畫面數量與彩色課程格；pageRawRecords 保存日表載入時的課務回應。',
        'rawRecords 已移除密碼、權杖、電話、Email 等不必要欄位。',
        'calendarCandidates 與 daySnapshots 均為唯讀核對，不會覆蓋正式課表。',
        '商品、銷售、庫存、進貨、供應商端點均未讀取。'
      ],
      completedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    console.log('DONE');
    console.log(`RUN_ID: ${runId}`);
    console.log(`RAW_RECORD_COUNT: ${rawWrites.length}`);
    console.log(`CALENDAR_CANDIDATE_COUNT: ${candidateRows.length}`);
    console.log(`DAY_SNAPSHOT_COUNT: ${snapshotWrites.length}`);
    console.log(`PAGE_RAW_RECORD_COUNT: ${pageCaptureWrites.length}`);
    console.log(`Firestore: opsInjiaoyunCourseAuditV3Runs/${runId}`);
  } catch (error) {
    await runRef.set({
      status: 'failed',
      error: clean(error && error.message).slice(0, 800),
      completedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  console.error(`課務核對失敗：${clean(error && error.message)}`);
  process.exitCode = 1;
});
