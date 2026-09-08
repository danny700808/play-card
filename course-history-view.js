(function(global) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = value => '$' + Number(value || 0).toLocaleString('zh-TW');
  global.CourseHistoryView = { mount(host, options) {
    let subject = '', payload = null, request = 0, activeFromDate = '';
    host.innerHTML = `<section class="course-history"><h2>${esc(options.name || '課程紀錄')}</h2><div class="history-controls"><label>學習科目<select data-history-subject aria-label="選擇學習科目"></select><span class="history-single-subject" data-history-single hidden></span></label><button type="button" data-history-toggle>查詢歷史課程</button></div><form data-history-form hidden><p class="history-query-help">歷史課程可查詢自 2026/7/21 起；更早資料請至實體上課證查詢。</p><label class="history-date-label">查詢日期<span class="history-date-box"><input type="date" min="2026-07-21" required aria-label="歷史查詢日期"></span></label><button type="submit">查詢</button></form><p data-history-notice role="status"></p><div data-history-cards></div></section>`;
    const cards = host.querySelector('[data-history-cards]'), notice = host.querySelector('[data-history-notice]');
    const select = host.querySelector('select'), form = host.querySelector('form');
    function card(period) {
      const rows = payload.lessons.filter(row => row.periodId === period.id);
      const lessons = rows.filter(row => ['attended', 'checked_in', 'present', 'normal'].includes(row.status));
      const labels = {attended:'已上課', checked_in:'已上課', present:'已上課', normal:'已上課', absent:'曠課', leave:'請假'};
      const slots = Array.from({length:Math.max(Number(period.lessonCount || 0),lessons.length)},(_,index)=>{
        const row = lessons[index];
        return row ? `<div class="lesson-slot used"><strong>第 ${index+1} 堂</strong><span>${esc(row.date)} ${esc(row.startTime || '')}</span><small>${esc(row.late ? '老師補簽到' : labels[row.status] || row.status || '上課紀錄')}${row.status === 'absent' ? '・扣一堂' : ''}</small></div>` : `<div class="lesson-slot${index < period.usedCount ? ' used' : ''}"><strong>第 ${index+1} 堂</strong><span>${index < period.usedCount ? '無簽到紀錄' : '未使用'}</span></div>`;
      }).join('');
      const paid = period.outstandingAmount <= 0;
      const payments = period.transactions.filter(row => row.type !== 'refund');
      const lastPayment = payments.slice().reverse().find(row => row.date);
      return `<article class="period-card"><div class="period-card-head"><div class="period-card-title"><strong>第 ${period.systemPeriodNo || period.periodNo} 期 · ${esc(period.subjectName || '課程')}</strong><small>已用 ${period.usedCount} / ${period.lessonCount} 堂</small></div><div class="period-payment ${paid ? 'paid' : 'unpaid'}"><div class="period-payment-amount"><span>本期學費</span><strong>${Number(period.expectedAmount).toLocaleString('zh-TW')}</strong><small>實收 ${money(period.paidAmount)}</small></div><div class="period-payment-state"><span class="badge ${paid ? '' : 'danger'}">${paid ? '已繳費' : period.paidAmount > 0 ? '部分繳費' : '尚未繳費'}</span>${!paid ? `<small>尚欠 ${money(period.outstandingAmount)}</small>` : ''}${lastPayment ? `<small>繳費日期：${esc(lastPayment.date)}</small>` : ''}</div></div></div>${period.partialHistory ? '<p class="history-warning">本期 7/21 之前紀錄未完整承接，請至實體上課證查詢。</p>' : ''}<div class="lesson-slot-grid">${slots}</div></article>`;
    }
    function render() {
      const rows = payload.periods.filter(row => row.subjectId === subject);
      rows.sort((a,b) => String(b.startDate || '').localeCompare(String(a.startDate || '')) || Number(b.systemPeriodNo || b.periodNo) - Number(a.systemPeriodNo || a.periodNo));
      cards.innerHTML = rows.map(card).join('') || '<p>此科目目前沒有期別紀錄。</p>';
      if (typeof options.onSubjectChange === 'function') options.onSubjectChange(subject);
    }
    async function load(fromDate) {
      const id = ++request;
      notice.textContent = '正在讀取課程紀錄…';
      try {
        const result = await options.call('coursePortalLessonHistory', { sessionToken:options.token, studentId:options.studentId, fromDate:fromDate || '' });
        if (id !== request || !host.isConnected) return;
        payload = result;
        result.subjects = [...new Map([...(result.subjects || []), ...(options.additionalSubjects || [])].map(row => [row.id, row])).values()];
        if (!result.subjects.some(row => row.id === subject)) subject = (result.subjects[0] || {}).id || '';
        select.innerHTML = result.subjects.map(row => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');
        select.value = subject;
        const single = host.querySelector('[data-history-single]');
        const onlyOne = result.subjects.length === 1;
        select.hidden = onlyOne; single.hidden = !onlyOne;
        single.textContent = onlyOne ? result.subjects[0].name : '';
        activeFromDate = fromDate || '';
        notice.textContent = fromDate ? `從包含 ${fromDate} 的期別顯示到最新一期` : '';
        render();
      } catch(error) {
        if (id === request) notice.textContent = error.message || '讀取失敗，請再試一次。';
      }
    }
    select.addEventListener('change', () => { subject = select.value; render(); });
    host.querySelector('[data-history-toggle]').addEventListener('click', () => { form.hidden = !form.hidden; if (form.hidden && activeFromDate) load(''); });
    form.addEventListener('submit', event => { event.preventDefault(); const day = form.querySelector('input').value; if (!day) {notice.textContent = '請先選擇查詢日期。';return;} if (day < '2026-07-21') { notice.textContent = '新系統未承接此日期之前的資料，請至實體上課證查詢。'; return; } load(day); });
    // Use our explicit message instead of the browser's generic minimum-date error.
    form.noValidate = true;
    load('');
  } };
})(window);
