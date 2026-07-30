(function (global) {
  'use strict';

  const P = global.CoursePortal;
  if (!P) throw new Error('CoursePortal 尚未載入。');

  let role = '';
  let token = '';
  let selectedUse = '';
  let durationMinutes = 60;
  let weekStart = todayKey();
  let selectedDate = todayKey();
  let selectedStart = '';
  let boardData = null;
  let roomData = null;
  let selectedRoom = null;
  let myBookings = [];
  let excludeDigitalPiano = false;
  let allowGuzhengMove = false;
  let drumType = '';

  const bindView = document.getElementById('publicBindView');
  const bookingView = document.getElementById('bookingView');
  const confirmBackdrop = document.getElementById('rentalConfirmBackdrop');

  function todayKey() {
    const date = new Date();
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function iconFor(row) {
    const text = `${clean(row && row.id)} ${clean(row && row.name)}`.toLowerCase();
    if (/guzheng|古箏/.test(text)) return '🪕';
    if (/record|錄音/.test(text)) return '🎙️';
    if (/piano|鋼琴|平台/.test(text)) return '🎹';
    if (/drum|鼓/.test(text)) return '🥁';
    if (/band|團練|展演/.test(text)) return '🎸';
    return '🎵';
  }

  function durationLabel(value) {
    value = Number(value || 0);
    if (value % 60 === 0) return `${value / 60} 小時`;
    return `${Math.floor(value / 60)} 小時 ${value % 60} 分`;
  }

  function showBooking(active) {
    bindView.classList.toggle('hidden', active);
    bookingView.classList.toggle('hidden', !active);
    document.getElementById('sessionLoading').classList.add('hidden');
    document.getElementById('logoutBtn').classList.toggle('hidden', !active);
  }

  function currentSession() {
    const params = new URLSearchParams(location.search);
    if (params.get('from') === 'student' && P.getSession('student')) {
      return { role: 'student', token: P.getSession('student') };
    }
    if (params.get('from') === 'teacher' && P.getSession('teacher')) {
      return { role: 'teacher', token: P.getSession('teacher') };
    }
    if (P.getSession('renter')) return { role: 'renter', token: P.getSession('renter') };
    if (P.getSession('student')) return { role: 'student', token: P.getSession('student') };
    if (P.getSession('teacher')) return { role: 'teacher', token: P.getSession('teacher') };
    return null;
  }

  async function loadUses() {
    const result = await P.call('coursePortalRentalUseSettings', {});
    const items = result.items || [];
    if (!selectedUse && items[0]) selectedUse = items[0].id;
    document.getElementById('rentalUseGrid').innerHTML = items.map((row) => `
      <button class="rental-use-card ${row.id === selectedUse ? 'active' : ''}" type="button" data-use="${P.escapeHtml(row.id)}">
        <span>${P.escapeHtml(row.icon || iconFor(row))}</span>
        <b>${P.escapeHtml(row.name)}</b>
        ${row.description ? `<small>${P.escapeHtml(row.description)}</small>` : ''}
      </button>
    `).join('') || '<div class="rental-empty">目前沒有可租用途。</div>';
    renderPreference();
  }

  function resetPreference() {
    excludeDigitalPiano = false;
    allowGuzhengMove = false;
    drumType = '';
  }

  function preferencePayload() {
    return {
      excludeDigitalPiano,
      allowGuzhengMove,
      drumType
    };
  }

  function renderPreference() {
    const node = document.getElementById('rentalPreference');
    let content = '';
    if (selectedUse === 'piano') {
      content = `
        <h3>鋼琴類型</h3>
        <label class="rental-preference-toggle">
          <input type="checkbox" data-preference="exclude-digital" ${excludeDigitalPiano ? 'checked' : ''}>
          <span><strong>排除電鋼琴</strong></span>
        </label>
      `;
    } else if (selectedUse === 'guzheng') {
      content = `
        <h3>古箏位置</h3>
        <label class="rental-preference-toggle">
          <input type="checkbox" data-preference="allow-guzheng-move" ${allowGuzhengMove ? 'checked' : ''}>
          <span><strong>我可以自行搬古箏（使用後搬回展演空間）</strong></span>
        </label>
      `;
    } else if (selectedUse === 'drums') {
      content = `
        <h3>是否指定鼓種？</h3>
        <div class="rental-preference-options">
          <label><input type="radio" name="drumType" value="" ${!drumType ? 'checked' : ''}> 不指定</label>
          <label><input type="radio" name="drumType" value="acoustic_drums" ${drumType === 'acoustic_drums' ? 'checked' : ''}> 傳統鼓</label>
          <label><input type="radio" name="drumType" value="electronic_drums" ${drumType === 'electronic_drums' ? 'checked' : ''}> 電子鼓</label>
        </div>
      `;
    }
    node.innerHTML = content;
    node.classList.toggle('hidden', !content);
  }

  function renderDurations() {
    const values = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300];
    document.getElementById('durationGrid').innerHTML = values.map((value) => `
      <button class="duration-chip ${value === durationMinutes ? 'active' : ''}" type="button" data-duration="${value}">
        ${durationLabel(value)}
      </button>
    `).join('');
  }

  function renderDates() {
    const days = boardData && boardData.days || [];
    document.getElementById('dateStrip').innerHTML = days.map((day) => {
      const date = new Date(`${day.date}T12:00:00`);
      const weekday = '日一二三四五六'[date.getDay()];
      return `
        <button class="btn date-chip ${day.date === selectedDate ? 'active' : ''}" type="button" data-date="${day.date}" ${day.closed ? 'disabled' : ''}>
          <strong>週${weekday}</strong>
          <small>${date.getMonth() + 1}/${date.getDate()}</small>
          <em>${day.closed ? '公休' : `${day.availableSlotCount} 個時段`}</em>
        </button>
      `;
    }).join('');
  }

  function renderSlots() {
    const node = document.getElementById('rentalBoard');
    const day = (boardData && boardData.days || []).find((row) => row.date === selectedDate);
    if (!day) {
      node.innerHTML = '<div class="rental-empty">沒有可選日期。</div>';
      return;
    }
    if (day.closed) {
      node.innerHTML = '<div class="notice">公休</div>';
      return;
    }
    const rows = (day.slots || []).filter((slot) => slot.availableCount > 0);
    node.innerHTML = rows.map((slot) => `
      <button class="rental-slot ${slot.startTime === selectedStart ? 'selected' : ''}" type="button" data-slot="${slot.startTime}">
        <strong>${P.escapeHtml(slot.startTime)}～${P.escapeHtml(slot.endTime)}</strong>
        <small>${slot.availableCount} 間可租</small>
      </button>
    `).join('') || '<div class="rental-empty">這一天沒有符合的連續時段。</div>';
  }

  async function loadBoard() {
    selectedStart = '';
    selectedRoom = null;
    document.getElementById('roomStep').classList.add('hidden');
    document.getElementById('rentalBoard').innerHTML = '<div class="rental-empty">讀取中…</div>';
    try {
      boardData = await P.call('coursePortalRentalWeekBoard', Object.assign({
        sessionToken: token,
        startDate: weekStart,
        useType: selectedUse,
        durationMinutes
      }, preferencePayload()));
      if (!(boardData.days || []).some((day) => day.date === selectedDate && !day.closed)) {
        selectedDate = ((boardData.days || []).find((day) => !day.closed) || {}).date || weekStart;
      }
      renderDates();
      renderSlots();
    } catch (error) {
      document.getElementById('rentalBoard').innerHTML = '<div class="rental-empty">讀取失敗。</div>';
      P.toast(error.message, 'error');
    }
  }

  function renderRooms() {
    const rows = (roomData && roomData.rooms || []).filter((row) => row.available);
    document.getElementById('roomGrid').innerHTML = rows.map((room) => {
      const equipment = roomEquipmentText(room);
      return `
      <button class="rental-room-card" type="button" data-room="${P.escapeHtml(room.id)}">
        <b>${P.escapeHtml(room.name)}</b>
        ${equipment ? `<span class="rental-room-equipment">${P.escapeHtml(equipment)}</span>` : ''}
        <strong class="rental-room-price">${P.money(room.price)}</strong>
      </button>
    `;
    }).join('') || '<div class="rental-empty">這段時間沒有符合條件的教室。</div>';
  }

  function roomEquipmentText(room) {
    if (selectedUse === 'piano') return clean(room.equipmentLabel);
    if (selectedUse === 'drums') {
      const equipment = room.equipment || [];
      if (equipment.includes('acoustic_drums') && equipment.includes('electronic_drums')) return '傳統鼓、電子鼓';
      if (equipment.includes('acoustic_drums')) return '傳統鼓';
      if (equipment.includes('electronic_drums')) return '電子鼓';
    }
    return '';
  }

  async function loadRooms() {
    if (!selectedStart) return;
    document.getElementById('roomStep').classList.remove('hidden');
    document.getElementById('roomGrid').innerHTML = '<div class="rental-empty">讀取中…</div>';
    try {
      roomData = await P.call('coursePortalRentalAvailability', Object.assign({
        sessionToken: token,
        date: selectedDate,
        startTime: selectedStart,
        durationMinutes,
        useType: selectedUse,
        studentDiscountRequested: false
      }, preferencePayload()));
      renderRooms();
      document.getElementById('roomStep').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      document.getElementById('roomGrid').innerHTML = '<div class="rental-empty">讀取失敗。</div>';
      P.toast(error.message, 'error');
    }
  }

  function rateIsStudent() {
    const selected = document.querySelector('input[name="rentalRate"]:checked');
    return Boolean(selected && selected.value === 'student');
  }

  function estimatePrice() {
    if (!selectedRoom) return 0;
    const rate = rateIsStudent() ? 0.5 : 1;
    return Math.round(Number(selectedRoom.unitFee || 0) * durationMinutes / 60 * rate);
  }

  function updateConfirm() {
    if (!selectedRoom) return;
    const use = (boardData && boardData.useOptions || []).find((row) => row.id === selectedUse) || {};
    document.getElementById('confirmUse').textContent = use.name || selectedUse;
    document.getElementById('confirmDate').textContent = selectedDate;
    document.getElementById('confirmTime').textContent = `${selectedStart}～${roomData && roomData.endTime || ''}`;
    const equipment = roomEquipmentText(selectedRoom);
    document.getElementById('confirmRoom').textContent = equipment
      ? `${selectedRoom.name}（${equipment}）`
      : selectedRoom.name;
    document.getElementById('confirmPrice').textContent = P.money(estimatePrice());
  }

  function openConfirm(room) {
    selectedRoom = room;
    document.querySelector('input[name="rentalRate"][value="general"]').checked = true;
    document.getElementById('bookingNote').value = '';
    updateConfirm();
    confirmBackdrop.classList.remove('hidden');
  }

  function closeConfirm() {
    confirmBackdrop.classList.add('hidden');
    selectedRoom = null;
  }

  function renderBookings() {
    const node = document.getElementById('myBookingList');
    node.innerHTML = myBookings.length ? myBookings.map((row) => `
      <article class="list-row rental-history-row">
        <strong>${P.escapeHtml(row.date)} ${P.escapeHtml(row.startTime)}～${P.escapeHtml(row.endTime)}</strong>
        <span>${P.escapeHtml(row.roomName || '教室')}${row.useName ? `・${P.escapeHtml(row.useName)}` : ''}</span>
        <strong>${P.money(row.amount)}</strong>
        <span>${row.canCancel ? `<button class="btn danger" type="button" data-cancel="${P.escapeHtml(row.id)}">取消</button>` : '已完成'}</span>
      </article>
    `).join('') : '<div class="rental-empty">目前沒有預約。</div>';
  }

  async function loadBookings() {
    try {
      const result = await P.call('coursePortalRentalMyBookings', { sessionToken: token });
      myBookings = result.bookings || [];
      renderBookings();
    } catch (_) {
      document.getElementById('myBookingList').innerHTML = '<div class="rental-empty">讀取失敗。</div>';
    }
  }

  async function openBooking(nextRole, nextToken) {
    role = nextRole;
    token = nextToken;
    const initialBookings = await P.call('coursePortalRentalMyBookings', { sessionToken: token });
    myBookings = initialBookings.bookings || [];
    showBooking(true);
    renderDurations();
    renderBookings();
    await loadUses();
    await loadBoard();
  }

  P.installAuth({ role: 'renter', authViewId: 'publicBindView' });

  document.getElementById('rentalUseGrid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-use]');
    if (!button) return;
    selectedUse = button.dataset.use;
    resetPreference();
    renderPreference();
    document.querySelectorAll('[data-use]').forEach((node) => node.classList.toggle('active', node === button));
    loadBoard();
  });

  document.getElementById('rentalPreference').addEventListener('change', (event) => {
    if (event.target.matches('[data-preference="exclude-digital"]')) {
      excludeDigitalPiano = event.target.checked;
    } else if (event.target.matches('[data-preference="allow-guzheng-move"]')) {
      allowGuzhengMove = event.target.checked;
    } else if (event.target.matches('input[name="drumType"]')) {
      drumType = event.target.value;
    } else {
      return;
    }
    loadBoard();
  });

  document.getElementById('durationGrid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-duration]');
    if (!button) return;
    durationMinutes = Number(button.dataset.duration);
    renderDurations();
    loadBoard();
  });

  document.getElementById('dateStrip').addEventListener('click', (event) => {
    const button = event.target.closest('[data-date]');
    if (!button) return;
    selectedDate = button.dataset.date;
    selectedStart = '';
    renderDates();
    renderSlots();
    document.getElementById('roomStep').classList.add('hidden');
  });

  document.getElementById('rentalBoard').addEventListener('click', (event) => {
    const button = event.target.closest('[data-slot]');
    if (!button) return;
    selectedStart = button.dataset.slot;
    renderSlots();
    loadRooms();
  });

  document.getElementById('roomGrid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-room]');
    if (!button || !roomData) return;
    const room = (roomData.rooms || []).find((row) => row.id === button.dataset.room);
    if (room) openConfirm(room);
  });

  document.querySelectorAll('input[name="rentalRate"]').forEach((node) => {
    node.addEventListener('change', updateConfirm);
  });
  document.getElementById('closeRentalConfirm').addEventListener('click', closeConfirm);
  confirmBackdrop.addEventListener('click', (event) => {
    if (event.target === confirmBackdrop) closeConfirm();
  });

  document.getElementById('confirmBookingBtn').addEventListener('click', async (event) => {
    if (!selectedRoom) return;
    const button = event.currentTarget;
    P.loading(button, true, '預約中…');
    try {
      const result = await P.call('coursePortalCreateRoomBooking', Object.assign({
        sessionToken: token,
        roomId: selectedRoom.id,
        date: selectedDate,
        startTime: selectedStart,
        durationMinutes,
        useType: selectedUse,
        studentDiscountRequested: rateIsStudent(),
        purpose: clean(document.getElementById('bookingNote').value)
      }, preferencePayload()));
      closeConfirm();
      P.toast(`預約完成，現場付款 ${P.money(result.booking.amount)}。`);
      await Promise.all([loadBoard(), loadBookings()]);
    } catch (error) {
      P.toast(error.message, 'error');
    } finally {
      P.loading(button, false);
    }
  });

  document.getElementById('prevRentalWeek').addEventListener('click', () => {
    weekStart = P.addDays(weekStart, -7);
    selectedDate = weekStart;
    loadBoard();
  });
  document.getElementById('nextRentalWeek').addEventListener('click', () => {
    weekStart = P.addDays(weekStart, 7);
    selectedDate = weekStart;
    loadBoard();
  });
  document.getElementById('reloadBookings').addEventListener('click', loadBookings);
  document.getElementById('myBookingList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-cancel]');
    if (!button || !confirm('確定取消這次預約嗎？')) return;
    P.loading(button, true, '取消中…');
    try {
      await P.call('coursePortalCancelRoomBooking', {
        sessionToken: token,
        bookingId: button.dataset.cancel
      });
      P.toast('預約已取消。');
      await Promise.all([loadBoard(), loadBookings()]);
    } catch (error) {
      P.toast(error.message, 'error');
    } finally {
      P.loading(button, false);
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    if (role === 'renter') P.setSession('renter', '');
    if (role === 'student') P.setSession('student', '');
    if (role === 'teacher') P.setSession('teacher', '');
    location.reload();
  });

  (async function init() {
    try {
      const params = new URLSearchParams(location.search);
      if (params.get('access')) {
        token = await P.exchangeAccess('renter');
        await openBooking('renter', token);
        return;
      }
      const saved = currentSession();
      if (saved) {
        try {
          await openBooking(saved.role, saved.token);
        } catch (error) {
          P.setSession(saved.role, '');
          throw error;
        }
        return;
      }
      showBooking(false);
    } catch (error) {
      P.toast(error.message, 'error');
      showBooking(false);
    }
  })();
})(window);
