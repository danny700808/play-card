(function () {
  'use strict';

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function roomKind(text) {
    text = clean(text);
    if (/不定時/.test(text)) return 'holding';
    if (/視訊/.test(text)) return 'video';
    return 'normal';
  }

  function warningText(kind, roomText, subjectText) {
    const messages = [];
    if (kind === 'video') {
      messages.push('視訊教室不是實體教室，老師需自行安排實際上課地點。');
    }
    if (kind === 'holding') {
      messages.push('不定時教室只供暫時放置，之後仍需重新安排正式教室。');
    }
    if (/電鋼琴/.test(roomText)) messages.push('此教室配備電鋼琴。');
    if (/平台鋼琴/.test(roomText)) messages.push('此教室配備平台鋼琴。');
    if (/直立鋼琴/.test(roomText)) messages.push('此教室配備直立鋼琴。');
    if (/古箏/.test(subjectText) && /展演/.test(roomText)) {
      messages.push('展演空間已有古箏，可直接使用。');
    }
    if (/古箏/.test(subjectText) && /kawai|卡哇伊/i.test(roomText)) {
      messages.push('需自行從展演空間搬古箏到 KAWAI 教室，使用後請放回原位。');
    }
    return messages.join(' ');
  }

  function ensureWarning() {
    const select = document.getElementById('actionRoom');
    if (!select) return null;
    let node = document.getElementById('teacherRoomWarning');
    if (!node) {
      node = document.createElement('div');
      node.id = 'teacherRoomWarning';
      node.className = 'teacher-room-warning';
      select.closest('.field').appendChild(node);
    }
    return node;
  }

  function updateWarning() {
    const select = document.getElementById('actionRoom');
    const subject = document.getElementById('actionSubject');
    const node = ensureWarning();
    if (!select || !node) return;
    const roomText = select.options[select.selectedIndex] && select.options[select.selectedIndex].textContent || '';
    const subjectText = subject && subject.options[subject.selectedIndex] && subject.options[subject.selectedIndex].textContent || '';
    const kind = roomKind(roomText);
    const message = warningText(kind, roomText, subjectText);
    node.className = `teacher-room-warning${message ? ` show ${kind}` : ''}`;
    node.textContent = message;
    select.dataset.specialKind = kind;
    select.dataset.specialConfirmed = '';
    select.dataset.requiresMoveConfirm = String(/古箏/.test(subjectText) && /kawai|卡哇伊/i.test(roomText));
    select.dataset.moveConfirmed = '';
  }

  function minutes(value) {
    const parts = clean(value).split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }

  function allowedWindow(date, start, end) {
    const value = new Date(`${date}T12:00:00`);
    const day = value.getDay();
    const startMinutes = minutes(start);
    const endMinutes = minutes(end);
    if (day === 1) return false;
    const open = day === 0 || day === 6 ? 600 : 750;
    return startMinutes >= open && endMinutes <= 1260;
  }

  function applyHours() {
    document.querySelectorAll('#weekGrid [data-empty]').forEach((button) => {
      const parts = button.dataset.empty.split('|');
      if (parts.length < 3 || allowedWindow(parts[0], parts[1], parts[2])) return;
      const span = document.createElement('span');
      span.className = 'closed-by-hours';
      span.textContent = new Date(`${parts[0]}T12:00:00`).getDay() === 1 ? '公休' : '未營業';
      button.replaceWith(span);
    });
  }

  function start() {
    const select = document.getElementById('actionRoom');
    const subject = document.getElementById('actionSubject');
    const form = document.getElementById('actionForm');
    const grid = document.getElementById('weekGrid');
    if (select) {
      select.addEventListener('change', updateWarning);
      new MutationObserver(updateWarning).observe(select, { childList: true, subtree: true });
      updateWarning();
    }
    if (subject) {
      subject.addEventListener('change', updateWarning);
      new MutationObserver(updateWarning).observe(subject, { childList: true, subtree: true });
    }
    if (form) {
      form.addEventListener('submit', function (event) {
        const kind = select && select.dataset.specialKind || 'normal';
        const requiresMove = select && select.dataset.requiresMoveConfirm === 'true';
        if (
          (kind === 'normal' || select.dataset.specialConfirmed === kind) &&
          (!requiresMove || select.dataset.moveConfirmed === 'true')
        ) return;
        const message = requiresMove
          ? '使用 KAWAI 教室上古箏課，需要自行從展演空間搬運古箏，使用後再放回原位。\n\n確定可以自行搬運嗎？'
          : `${warningText(kind, '', '')}\n\n確定要使用這個教室嗎？`;
        if (!confirm(message)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        select.dataset.specialConfirmed = kind;
        select.dataset.moveConfirmed = String(requiresMove);
      }, true);
    }
    if (grid) {
      new MutationObserver(applyHours).observe(grid, { childList: true, subtree: true });
      applyHours();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
