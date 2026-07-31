'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'teacher-course-portal.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'teacher-course-portal-v8.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'teacher-course-portal-v8.css'), 'utf8');

new vm.Script(source, { filename: 'teacher-course-portal-v8.js' });

const header = html.slice(html.indexOf('<header class="portal-head">'), html.indexOf('</header>'));
assert(header.includes('id="teacherWelcomeTitle"'), '老師頁首缺少可更新的歡迎標題');
assert(source.includes('`老師課務｜歡迎 ${name}老師`'), '老師頁首未顯示老師姓名');
assert(!/(手機|phone|email)/i.test(header), '老師登入後頁首不應顯示手機或 Email');

assert(!html.includes('id="weekPicker"'), '手機課表不應顯示日期／星期選擇器');
assert(!source.includes("getElementById('weekPicker')"), '老師課表仍保留日期跳轉邏輯');
assert(html.includes('id="prevWeek"') && html.includes('id="nextWeek"'), '老師課表需保留上一週／下一週');
assert(source.includes('addDays(weekStart, -7)') && source.includes('addDays(weekStart, 7)'), '前後週按鈕未以整週切換');

assert(html.includes('data-two-day-viewport'), '手機課表缺少兩日檢視容器');
assert(source.includes('scroll.clientWidth - stickyWidth') && source.includes('/ 2'), '手機課表未依可視寬度配置兩日欄');
assert(source.includes("dayIndex % 2 === 0 ? ' week-day-group-start'"), '課表未標示兩日群組起點');
assert(source.includes('const targets = [0, dayWidth * 2, dayWidth * 4, maxScroll]'), '課表滑動未限制於兩日群組邊界');
assert(source.includes("addEventListener('scrollend', snapWeekScrollToGroup)"), '課表滑動結束後未校正至兩日群組');
assert(source.includes('Math.floor(todayIndex / 2)'), '第一次載入未聚焦今天所在的兩日群組');
assert(source.includes('if (!priorWeek && todayIndex >= 0)'), '只有第一次載入才能自動聚焦今天');
assert(source.includes('scroll.scrollLeft = 0;'), '切換其他週後未回到週一／週二');
assert(css.includes('scroll-snap-type:x mandatory'), '手機課表未強制群組吸附');
assert(css.includes('.week-cell.head.week-day-group-start{scroll-snap-align:start;scroll-snap-stop:always}'), '兩日群組起點缺少強制吸附');
assert(css.includes('repeat(7,var(--teacher-day-width'), '手機課表未使用動態兩日欄寬');
assert(css.includes('.teacher-course-app .week-cell.time{position:sticky;left:0'), '時間欄未固定在左側');
assert(source.includes('minute += 30'), '課表不再使用 30 分鐘網格');
assert(css.includes('grid-auto-rows:30px'), '手機版 30 分鐘網格高度遺失');
assert(source.includes('continuousTeacherGapMinutes'), '手機課表未計算可連續使用的完整空檔');
assert(source.includes('data-unavailable-target'), '手機課表未阻擋只有半小時但課程需要一小時的位置');
assert(source.includes('可調入</span><small>${requiredMinutes} 分鐘'), '可調入位置未直接標示本堂所需分鐘數');
assert(css.includes('.empty-slot.unavailable-target'), '時段不足位置缺少紅色提示樣式');

assert(html.includes('id="rosterSearch"'), '學生頁缺少搜尋欄');
assert(html.includes('placeholder="搜尋學生或老師姓名"'), '學生搜尋提示不清楚');
assert(source.includes('function teacherRawName()'), '老師原始姓名未與頁首稱謂格式分離');
assert(source.includes("const normalizedTeacherName = rowTeacherName.replace(/老師$/, '')"), '老師姓名搜尋未兼容有無「老師」稱謂');
assert(source.includes('studentName.includes(query)') && source.includes('rowTeacherName.includes(query)'), '搜尋未同時比對學生與老師姓名');
assert(source.includes('找不到符合「${escapeHtml(rosterQuery)}」的學生或老師。'), '搜尋無結果時缺少清楚提示');
assert(html.includes('id="studentEditModal"'), '學生頁缺少姓名電話修改視窗');
assert(source.includes('coursePortalTeacherUpdateStudent'), '學生姓名電話修改沒有送到後端');
assert(html.includes('id="studentStopModal"') && html.includes('再次確認停課'), '學生停課缺少二次確認視窗');
assert(source.includes('coursePortalTeacherStopStudent') && source.includes('confirmed: true'), '學生停課沒有送出明確確認');
assert(html.includes('id="payrollMonth" type="month" min="2026-07"'), '薪資查詢未限制民國 115 年 7 月起');
assert(source.includes("PAYROLL_MIN_MONTH = '2026-07'"), '薪資月份前端沒有再次驗證最早月份');

const tabs = html.slice(html.indexOf('<nav class="tabs teacher-bottom-tabs"'), html.indexOf('</nav>'));
assert.strictEqual((tabs.match(/<(?:button|a)\b/g) || []).length, 5, '老師頁底部必須維持五個功能頁籤');
assert(html.includes('id="teacherFlowBanner"'), '原地課務操作狀態遺失');
assert(html.includes('id="teacherQuickBackdrop"'), '原地快速操作選單遺失');
assert(source.includes('data-student-action='), '學生頁原地加課操作遺失');

console.log('teacher course portal mobile tests passed');
