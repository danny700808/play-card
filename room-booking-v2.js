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
  let pianoType = 'any';
  let allowGuzhengMove = false;
  let drumType = '';
  let pendingStart = '';
  let boardRequestId = 0;
  let roomRequestId = 0;
  const recordingUsageRates = Object.freeze({
    general_room: 100,
    studio_recording: 300
  });

  const bindView = document.getElementById('publicBindView');
  const bookingView = document.getElementById('bookingView');
  const confirmBackdrop = document.getElementById('rentalConfirmBackdrop');
  const initialParams = new URLSearchParams(location.search);
  const initialDate = clean(initialParams.get('date'));
  const initialDuration = Number(initialParams.get('duration'));
  if (/^\d{4}-\d{2}-\d{2}$/.test(initialDate) && initialDate >= todayKey()) {
    selectedDate = initialDate;
    weekStart = initialDate;
  }
  if (/^\d{2}:\d{2}$/.test(clean(initialParams.get('start')))) {
    pendingStart = clean(initialParams.get('start')).slice(0, 5);
  }
  if ([30, 60, 90, 120, 150, 180, 210, 240, 270, 300].includes(initialDuration)) {
    durationMinutes = initialDuration;
  }
  if (clean(initialParams.get('use'))) selectedUse = clean(initialParams.get('use'));

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

  function renderWelcomeName(value) {
    const name = clean(value).normalize('NFKC');
    const digits = name.replace(/\D/g, '');
    const sensitive = name.length > 60 ||
      /[@\r\n]/.test(name) ||
      /[\p{Cc}\p{Cf}]/u.test(name) ||
      digits.length >= 8;
    document.getElementById('rentalHeaderTitle').textContent =
      name && !sensitive ? `教室租用｜歡迎 ${name}` : '教室租用';
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

  function renderUses(items) {
    items = Array.isArray(items) ? items : [];
    if (!items.some((row) => row.id === selectedUse) && items[0]) selectedUse = items[0].id;
    document.getElementById('rentalUseGrid').innerHTML = items.map((row) => {
      const priceRange = clean(row.priceRangeText) ||
        (row.id === 'recording' ? 'NT$100–300／小時' : '');
      return `
      <button class="rental-use-card ${row.id === selectedUse ? 'active' : ''}" type="button" data-use="${P.escapeHtml(row.id)}">
        <span>${P.escapeHtml(row.icon || iconFor(row))}</span>
        <b>${P.escapeHtml(row.name)}</b>
        ${priceRange ? `<small class="rental-use-price">${P.escapeHtml(priceRange)}</small>` : ''}
        ${row.description ? `<small>${P.escapeHtml(row.description)}</small>` : ''}
      </button>
    `;
    }).join('') || '<div class="rental-empty">目前沒有可租用途。</div>';
    renderPreference();
  }

  function showRentalLoadFailure(error) {
    const raw = clean(error && error.message);
    const message = raw && raw !== 'internal'
      ? raw
      : '租用資料暫時無法讀取，請按「重新讀取」。';
    document.getElementById('rentalUseGrid').innerHTML = `
      <button class="btn soft" type="button" data-retry-rental>重新讀取租用資料</button>
    `;
    document.getElementById('rentalBoard').innerHTML =
      '<div class="rental-empty">登入已完成，租用資料尚未載入。</div>';
    P.toast(message, 'error');
  }

  function isAuthError(error) {
    return /登入|綁定|權限|到期|session|unauthenticated/i.test(clean(error && error.message));
  }

  async function loadRentalData() {
    try {
      await loadBoard();
    } catch (error) {
      if (isAuthError(error)) throw error;
      showRentalLoadFailure(error);
    }
  }

  function resetPreference() {
    pianoType = 'any';
    allowGuzhengMove = false;
    drumType = '';
  }

  function preferencePayload() {
    return {
      pianoType,
      excludeDigitalPiano: pianoType === 'exclude_digital',
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
        <div class="rental-preference-options piano-options">
          <label><input type="radio" name="pianoType" value="any" ${pianoType === 'any' ? 'checked' : ''}> 不指定</label>
          <label><input type="radio" name="pianoType" value="exclude_digital" ${pianoType === 'exclude_digital' ? 'checked' : ''}> 排除電鋼琴</label>
          <label><input type="radio" name="pianoType" value="grand_piano" ${pianoType === 'grand_piano' ? 'checked' : ''}> 指定平台鋼琴</label>
          <label><input type="radio" name="pianoType" value="upright_piano" ${pianoType === 'upright_piano' ? 'checked' : ''}> 指定直立鋼琴</label>
        </div>
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
        <div class="rental-preference-options drum-options">
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
      const unavailable = day.closed || day.past;
      return `
        <button class="btn date-chip ${day.date === selectedDate ? 'active' : ''} ${day.past ? 'is-past' : ''}" type="button" data-date="${day.date}" ${unavailable ? 'disabled' : ''}>
          <strong>週${weekday}</strong>
          <small>${date.getMonth() + 1}/${date.getDate()}</small>
          ${day.closed ? '<em>公休</em>' : (day.past ? '<em>已過</em>' : '')}
        </button>
      `;
    }).join('');
    document.getElementById('prevRentalWeek').disabled = weekStart <= todayKey();
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
    const rows = (day.slots || []).filter((slot) => !slot.past && slot.availableCount > 0);
    node.innerHTML = rows.map((slot) => `
      <button class="rental-slot ${slot.startTime === selectedStart ? 'selected' : ''} ${slot.past ? 'is-past' : ''}" type="button" data-slot="${slot.startTime}" ${slot.past ? 'disabled' : ''}>
        <strong>${P.escapeHtml(slot.startTime)}～${P.escapeHtml(slot.endTime)}</strong>
        ${slot.past ? '<small>已過時間</small>' : ''}
      </button>
    `).join('') || '<div class="rental-empty">這一天沒有符合的連續時段。</div>';
  }

  async function loadBoard() {
    const requestId = ++boardRequestId;
    roomRequestId += 1;
    const requestedStart = pendingStart;
    pendingStart = '';
    selectedStart = '';
    selectedRoom = null;
    document.getElementById('roomStep').classList.add('hidden');
    document.getElementById('rentalBoard').innerHTML = '<div class="rental-empty">正在檢查可用時段…</div>';
    try {
      boardData = await P.call('coursePortalRentalWeekBoard', Object.assign({
        sessionToken: token,
        startDate: weekStart,
        useType: selectedUse,
        durationMinutes
      }, preferencePayload()));
      if (requestId !== boardRequestId) return;
      role = boardData.role || role;
      renderWelcomeName(boardData.displayName);
      weekStart = boardData.startDate || weekStart;
      selectedUse = boardData.selectedUseType || selectedUse;
      renderUses(boardData.useOptions || []);
      if (!(boardData.days || []).some((day) => day.date === selectedDate && !day.closed && !day.past)) {
        selectedDate = ((boardData.days || []).find((day) => !day.closed && !day.past) || {}).date || todayKey();
      }
      const selectedDay = (boardData.days || []).find((day) => day.date === selectedDate);
      if (requestedStart && selectedDay && (selectedDay.slots || []).some((slot) =>
        slot.startTime === requestedStart && !slot.past && slot.availableCount > 0
      )) {
        selectedStart = requestedStart;
      }
      renderDates();
      renderSlots();
      renderRateChoice();
      if (selectedStart) await loadRooms();
    } catch (error) {
      if (isAuthError(error)) throw error;
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
        <strong class="rental-room-price">${selectedUse === 'recording' ? 'NT$100–300／小時' : P.money(room.price)}</strong>
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
    const requestId = ++roomRequestId;
    document.getElementById('roomStep').classList.remove('hidden');
    document.getElementById('roomGrid').innerHTML = '<div class="rental-empty">正在確認教室…</div>';
    try {
      roomData = await P.call('coursePortalRentalAvailability', Object.assign({
        sessionToken: token,
        date: selectedDate,
        startTime: selectedStart,
        durationMinutes,
        useType: selectedUse,
        studentDiscountRequested: false
      }, preferencePayload()));
      if (requestId !== roomRequestId) return;
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

  function renderRateChoice() {
    const recording = selectedUse === 'recording';
    const student = role === 'student';
    document.getElementById('rentalRateSection').classList.toggle('hidden', recording && !student);
    document.getElementById('studentRateLabel').classList.toggle('hidden', role !== 'student');
    document.getElementById('rentalRateHeading').textContent =
      recording ? '學生折扣（選填）' : '租用價格';
    document.getElementById('generalRateText').textContent =
      recording ? '不使用學生折扣' : '一般租用';
  }

  function selectedRecordingUsage() {
    const selected = document.querySelector('input[name="recordingUsage"]:checked');
    return selectedUse === 'recording' && selected ? clean(selected.value) : '';
  }

  function estimatePrice() {
    if (!selectedRoom) return 0;
    const recordingUsage = selectedRecordingUsage();
    if (selectedUse === 'recording' && !recordingUsage) return null;
    const unitFee = selectedUse === 'recording'
      ? Number(recordingUsageRates[recordingUsage] || 0)
      : Number(selectedRoom.unitFee || 0);
    const rate = rateIsStudent()
      ? Number(roomData && roomData.studentDiscountRate || 0.5)
      : 1;
    return Math.round(unitFee * durationMinutes / 60 * rate);
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
    const price = estimatePrice();
    document.getElementById('confirmPrice').textContent =
      price == null ? '請先選擇錄音室使用方式' : P.money(price);
  }

  function openConfirm(room) {
    selectedRoom = room;
    document.querySelector('input[name="rentalRate"][value="general"]').checked = true;
    document.querySelectorAll('input[name="recordingUsage"]').forEach((node) => {
      node.checked = false;
    });
    document.getElementById('recordingUsageChoice').classList.toggle('hidden', selectedUse !== 'recording');
    renderRateChoice();
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
        <span>${P.escapeHtml(row.roomName || '教室')}${row.useName ? `・${P.escapeHtml(row.useName)}` : ''}${row.recordingUsageName ? `（${P.escapeHtml(row.recordingUsageName)}）` : ''}</span>
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
    } catch (error) {
      if (isAuthError(error)) throw error;
      document.getElementById('myBookingList').innerHTML = '<div class="rental-empty">讀取失敗。</div>';
    }
  }

  async function openBooking(nextRole, nextToken) {
    role = nextRole;
    token = nextToken;
    showBooking(true);
    renderDurations();
    renderRateChoice();
    await Promise.all([loadRentalData(), loadBookings()]);
  }

  P.installAuth({ role: 'renter', authViewId: 'publicBindView' });

  document.getElementById('rentalUseGrid').addEventListener('click', (event) => {
    const retry = event.target.closest('[data-retry-rental]');
    if (retry) {
      loadRentalData();
      return;
    }
    const button = event.target.closest('[data-use]');
    if (!button) return;
    selectedUse = button.dataset.use;
    resetPreference();
    renderPreference();
    document.querySelectorAll('[data-use]').forEach((node) => node.classList.toggle('active', node === button));
    loadBoard();
  });

  document.getElementById('rentalPreference').addEventListener('change', (event) => {
    if (event.target.matches('input[name="pianoType"]')) {
      pianoType = event.target.value;
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
  document.querySelectorAll('input[name="recordingUsage"]').forEach((node) => {
    node.addEventListener('change', updateConfirm);
  });
  document.getElementById('closeRentalConfirm').addEventListener('click', closeConfirm);
  confirmBackdrop.addEventListener('click', (event) => {
    if (event.target === confirmBackdrop) closeConfirm();
  });

  document.getElementById('confirmBookingBtn').addEventListener('click', async (event) => {
    if (!selectedRoom) return;
    const recordingUsage = selectedRecordingUsage();
    if (selectedUse === 'recording' && !recordingUsage) {
      P.toast('請先選擇一般教室使用或錄音室錄音使用。', 'error');
      const firstChoice = document.querySelector('input[name="recordingUsage"]');
      if (firstChoice) firstChoice.focus();
      return;
    }
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
        recordingUsage,
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
    const previous = P.addDays(weekStart, -7);
    weekStart = previous < todayKey() ? todayKey() : previous;
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
