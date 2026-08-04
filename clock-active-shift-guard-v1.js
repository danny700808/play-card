(function (global) {
  'use strict';

  if (global.__YZ_CLOCK_ACTIVE_SHIFT_GUARD_V1__) return;
  global.__YZ_CLOCK_ACTIVE_SHIFT_GUARD_V1__ = true;

  const ACTIVE_SHIFT_GRACE_MINUTES = 5;

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function localDateText(date) {
    const d = date instanceof Date ? date : new Date();
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('-');
  }

  function timeToMinutes(value) {
    const match = clean(value).slice(0, 5).match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
  }

  function firstValue() {
    for (let i = 0; i < arguments.length; i += 1) {
      const value = clean(arguments[i]);
      if (value) return value;
    }
    return '';
  }

  function issueDate(issue) {
    issue = issue || {};
    const schedule = issue.schedule || issue.scheduleSnapshot || {};
    return firstValue(issue.date, issue.scheduleDate, issue.correctDate, schedule.date, schedule.scheduleDate);
  }

  function issueEndTime(issue) {
    issue = issue || {};
    const schedule = issue.schedule || issue.scheduleSnapshot || {};
    return firstValue(issue.endTime, issue.scheduleEndTime, schedule.endTime, schedule.scheduleEndTime);
  }

  function isActiveTodayShift(issue) {
    const date = issueDate(issue);
    const endMinute = timeToMinutes(issueEndTime(issue));
    if (!date || endMinute == null || date !== localDateText(new Date())) return false;
    const now = new Date();
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    return nowMinute < endMinute + ACTIVE_SHIFT_GRACE_MINUTES;
  }

  function hasPendingRequest(issue) {
    issue = issue || {};
    const status = clean(issue.statusLabel || issue.status);
    return !!(
      issue.pendingCorrection ||
      issue.pendingLeave ||
      issue.pendingSpecialClock ||
      status.includes('待主管審核') ||
      status.includes('待審核')
    );
  }

  function filterCompletionIssues(result) {
    if (!result || !Array.isArray(result.rows)) return result;

    const rows = result.rows.map(function (issue) {
      if (!issue || hasPendingRequest(issue) || !isActiveTodayShift(issue)) return issue;

      const oldActions = Array.isArray(issue.missingActions) ? issue.missingActions : [];
      const nextActions = oldActions.filter(function (action) {
        const text = clean(action);
        return !text.includes('上班') && !text.includes('下班');
      });

      if (nextActions.length === oldActions.length) return issue;
      if (!nextActions.length && !issue.canEarlyLeaveRetro) return null;

      return Object.assign({}, issue, {
        missingActions: nextActions,
        activeShiftClockRequired: true,
        supplementBlockedReason: '班段仍在進行中，請使用正常打卡；補打卡只在班段結束後開放。'
      });
    }).filter(Boolean);

    return Object.assign({}, result, { rows: rows });
  }

  function shouldBlockSupplement(payload) {
    payload = payload || {};
    if (clean(payload.requestKind) !== 'missingClock') return false;
    const action = clean(payload.correctAction);
    if (!action.includes('上班') && !action.includes('下班')) return false;
    return isActiveTodayShift({
      date: payload.scheduleDate || payload.correctDate,
      endTime: payload.scheduleEndTime || payload.endTime,
      scheduleSnapshot: payload.scheduleSnapshot || {}
    });
  }

  function blockedMessage(payload) {
    const action = clean(payload && payload.correctAction);
    if (action.includes('上班')) {
      return '這個班段仍在進行中，不能使用補上班卡。請立即使用「標準打卡」，系統會記錄實際到班時間與遲到分鐘；若因網路或外出等特殊原因無法正常打卡，請改用「特殊打卡」送主管審核。';
    }
    return '這個班段仍在進行中，不能使用補下班卡。請在班段結束時使用正常下班打卡；若有特殊狀況，請依特殊打卡或請假流程處理。';
  }

  function installApiGuard() {
    const original = global.api;
    if (typeof original !== 'function') return false;
    if (original.__activeShiftSupplementGuardV1) return true;

    const wrapped = async function (action, payload) {
      if (action === 'submitClockCorrection' && shouldBlockSupplement(payload)) {
        return {
          ok: false,
          activeShiftClockRequired: true,
          message: blockedMessage(payload)
        };
      }

      const result = await original.apply(this, arguments);
      if (action === 'getClockCompletionIssues') return filterCompletionIssues(result);
      return result;
    };

    wrapped.__activeShiftSupplementGuardV1 = true;
    wrapped.__originalApi = original;
    global.api = wrapped;
    return true;
  }

  function updateHelpCopy() {
    const note = document.querySelector('.missing-clock-note');
    if (note) {
      note.textContent = '系統會檢查今日與昨日班表。班段進行中若遲到，請直接使用標準打卡，系統會記錄實際到班時間；補打卡只在班段結束後、確定漏打時開放，並送主管審核。';
    }

    const helpItems = Array.from(document.querySelectorAll('.help-box li'));
    const target = helpItems.find(function (item) {
      return clean(item.textContent).includes('如果已經有打卡紀錄但時間錯誤');
    });
    if (target) {
      target.innerHTML = '<strong>遲到仍要正常打卡：</strong>系統會照實記錄到班時間與遲到分鐘；有異議再提出修正。只有班段結束後確定漏打，才可從「待處理事項」提出補打卡。';
    }
  }

  installApiGuard();
  const apiTimer = global.setInterval(function () {
    if (installApiGuard()) global.clearInterval(apiTimer);
  }, 250);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateHelpCopy, { once: true });
  } else {
    updateHelpCopy();
  }
  global.addEventListener('pageshow', updateHelpCopy);
})(window);
