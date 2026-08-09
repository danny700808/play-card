(function (global) {
  'use strict';

  const P = global.CoursePortal;
  if (!P) throw new Error('CoursePortal 尚未載入。');

  let role = '';
  let studentDiscountEligible = false;
  let studentOptions = [];
  let selectedStudentId = '';
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
  let activeRoomPhotoName = '';
  let activeRoomPhotos = [];
  let activeRoomPhotoIndex = 0;
  let roomPhotoTouchStartX = 0;

  function maximumAdvanceDate() {
    const today = new Date(`${todayKey()}T12:00:00`);
    const day = today.getDate();
    today.setDate(1);
    today.setMonth(today.getMonth() + 2);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    today.setDate(Math.min(day, lastDay));
    return [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0')
    ].join('-');
  }
  const recordingUsageRates = Object.freeze({
    general_room: 100,
    studio_recording: 300
  });
  const immediateRentalUseOptions = Object.freeze([
    { id: 'piano', name: '彈鋼琴', icon: '🎹', description: '可選擇是否排除電鋼琴' },
    { id: 'drums', name: '練鼓', icon: '🥁', description: '可指定傳統鼓或電子鼓，也可不指定' },
    { id: 'band', name: '團練', icon: '🎸', description: '' },
    { id: 'guzheng', name: '古箏', icon: '🪕', description: '預設展演空間；可自行搬運時才加入 KAWAI 教室' },
    { id: 'recording', name: '錄音室', icon: '🎙️', description: '錄音用途每小時 NT$300；其他用途每小時 NT$100' },
    { id: 'other', name: '其他用途', icon: '🎵', description: '' }
  ]);
  const roomPhotoSets = Object.freeze([
    {
      match: /KAWAI.*直立|卡哇伊.*直立/i,
      images: [
        'https://cdn.store-assets.com/s/887148/f/10015248.png',
        'https://cdn.store-assets.com/s/887148/f/10015250.png',
        'https://cdn.store-assets.com/s/887148/f/10015251.png'
      ]
    },
    {
      match: /5\s*號.*鋼琴|5\s*號.*表演/i,
      images: [
        'https://cdn.store-assets.com/s/887148/f/14490247.png',
        'https://cdn.store-assets.com/s/887148/f/14490248.png',
        'https://cdn.store-assets.com/s/887148/f/14490251.png'
      ]
    },
    {
      match: /YAMAHA.*平台|山葉.*平台/i,
      images: [
        'https://cdn.store-assets.com/s/887148/f/10015252.png',
        'https://cdn.store-assets.com/s/887148/f/10015263.png',
        'https://cdn.store-assets.com/s/887148/f/10015254.png'
      ]
    },
    {
      match: /鼓教室.*電子鼓|電子鼓.*鼓教室/i,
      images: [
        'https://cdn.store-assets.com/s/887148/f/10015293.png',
        'https://cdn.store-assets.com/s/887148/f/10083689.png',
        'https://cdn.store-assets.com/s/887148/f/10015295.png'
      ]
    },
    {
      match: /錄音室|錄音教室/i,
      images: [
        'https://cdn.store-assets.com/s/887148/f/10302631.png',
        'https://cdn.store-assets.com/s/887148/f/10302622.png',
        'https://cdn.store-assets.com/s/887148/f/10302632.png'
      ]
    },
    {
      match: /吉他教室/i,
      images: [
        'https://cdn.store-assets.com/s/887148/f/10015300.png',
        'https://cdn.store-assets.com/s/887148/f/10015291.png',
        'https://cdn.store-assets.com/s/887148/f/10015297.png'
      ]
    },
    {
      match: /YAMAHA.*直立|山葉.*直立/i,
      images: [
        'https://cdn.store-assets.com/s/887148/f/14490311.png',
        'https://cdn.store-assets.com/s/887148/f/14490312.png',
        'https://cdn.store-assets.com/s/887148/f/14490313.png'
      ]
    },
    {
      match: /展演空間|展演.*電子鼓/i,
      images: [
        'https://cdn.store-assets.com/s/887148/f/10015264.png',
        'https://cdn.store-assets.com/s/887148/f/10015312.png',
        'https://cdn.store-assets.com/s/887148/f/10015276.png'
      ]
    },
    {
      match: /團練室.*傳統鼓|傳統鼓.*團練室/i,
      images: [
        'https://cdn.store-assets.com/s/887148/f/10015283.png',
        'https://cdn.store-assets.com/s/887148/f/10015311.png',
        'https://cdn.store-assets.com/s/887148/f/10015310.png'
      ]
    }
  ]);

  const bindView = document.getElementById('publicBindView');
  const bookingView = document.getElementById('bookingView');
  const confirmBackdrop = document.getElementById('rentalConfirmBackdrop');
  const photoBackdrop = document.getElementById('rentalPhotoBackdrop');
  const photoDialog = photoBackdrop.querySelector('.rental-photo-dialog');
  const photoImage = document.getElementById('rentalPhotoImage');
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

  function photosForRoom(room) {
    const name = clean(room && room.name);
    const photoSet = roomPhotoSets.find((row) => row.match.test(name));
    return photoSet ? photoSet.images.slice() : [];
  }

  function renderRoomPhoto() {
    if (!activeRoomPhotos.length) return;
    const total = activeRoomPhotos.length;
    activeRoomPhotoIndex = (activeRoomPhotoIndex + total) % total;
    document.getElementById('rentalPhotoTitle').textContent = activeRoomPhotoName || '教室照片';
    document.getElementById('rentalPhotoCounter').textContent = `${activeRoomPhotoIndex + 1} / ${total}`;
    photoImage.alt = `${activeRoomPhotoName}照片 ${activeRoomPhotoIndex + 1}`;
    photoImage.src = activeRoomPhotos[activeRoomPhotoIndex];
    document.getElementById('prevRentalPhoto').classList.toggle('hidden', total < 2);
    document.getElementById('nextRentalPhoto').classList.toggle('hidden', total < 2);
  }

  function moveRoomPhoto(step) {
    if (activeRoomPhotos.length < 2) return;
    activeRoomPhotoIndex += Number(step || 0);
    renderRoomPhoto();
  }

  function openRoomPhotos(room) {
    const images = photosForRoom(room);
    if (!images.length) {
      P.toast('這間教室目前沒有可顯示的照片。', 'error');
      return;
    }
    activeRoomPhotoName = clean(room && room.name) || '教室照片';
    activeRoomPhotos = images;
    activeRoomPhotoIndex = 0;
    renderRoomPhoto();
    photoBackdrop.classList.remove('hidden');
    photoBackdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('rental-photo-open');
    setTimeout(() => document.getElementById('closeRentalPhoto').focus(), 0);
  }

  function closeRoomPhotos() {
    photoBackdrop.classList.add('hidden');
    photoBackdrop.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('rental-photo-open');
    activeRoomPhotoName = '';
    activeRoomPhotos = [];
    activeRoomPhotoIndex = 0;
    photoImage.removeAttribute('src');
    photoImage.alt = '';
  }

  function showBooking(active) {
    bindView.classList.toggle('hidden', active);
    bookingView.classList.toggle('hidden', !active);
    document.getElementById('sessionLoading').classList.add('hidden');
    document.getElementById('logoutBtn').classList.toggle('hidden', !active);
  }

  function requestedRoomRole() {
    const params = new URLSearchParams(location.search);
    const requested = clean(params.get('from')).toLowerCase();
    return requested === 'teacher' || requested === 'student' ? requested : 'renter';
  }

  function currentSession() {
    const requested = requestedRoomRole();
    const currentToken = P.getSession(requested);
    return currentToken ? { role: requested, token: currentToken } : null;
  }

  function redirectToRoleLogin(requested, error, reason) {
    const loginParams = new URLSearchParams({ method: 'line', role: requested });
    if (reason) loginParams.set('reason', reason);
    else if (isAuthError(error)) loginParams.set('reason', 'session-expired');
    else loginParams.set('lineError', clean(error && error.message) || '登入狀態確認失敗，請重新登入。');
    location.replace(`course-portal.html?${loginParams.toString()}`);
  }

  function renderUses(items) {
    items = Array.isArray(items) ? items : [];
    if (!items.some((row) => row.id === selectedUse) && items[0]) selectedUse = items[0].id;
    document.getElementById('rentalUseGrid').innerHTML = items.map((row) => {
      const text = `${clean(row.id)} ${clean(row.name)}`.toLowerCase();
      const isGuzheng = /guzheng|古箏/.test(text);
      const priceRange = row.id === 'recording' ? '' : clean(row.priceRangeText);
      const icon = isGuzheng
        ? '<img class="rental-use-image" src="rental-guzheng.png?v=20260801-guzheng-v1" alt="">'
        : `<span>${P.escapeHtml(row.icon || iconFor(row))}</span>`;
      return `
      <button class="rental-use-card ${row.id === selectedUse ? 'active' : ''}" type="button" data-use="${P.escapeHtml(row.id)}">
        ${icon}
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
    if (!document.querySelector('#rentalUseGrid [data-use]')) renderUses(immediateRentalUseOptions);
    document.getElementById('rentalBoard').innerHTML = `
      <div class="rental-empty">
        <p>登入已完成，時段資料尚未載入。</p>
        <button class="btn soft" type="button" data-retry-rental>重新讀取時段</button>
      </div>
    `;
    P.toast(message, 'error');
  }

  function isAuthError(error) {
    return Boolean(P && typeof P.isSessionAuthError === 'function' && P.isSessionAuthError(error));
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
      const unavailable = day.closed || day.past || Number(day.availableSlotCount || 0) === 0;
      return `
        <button class="btn date-chip ${day.date === selectedDate ? 'active' : ''} ${day.past ? 'is-past' : ''}" type="button" data-date="${day.date}" ${unavailable ? 'disabled' : ''}>
          <strong>週${weekday}</strong>
          <small>${date.getMonth() + 1}/${date.getDate()}</small>
          ${day.closed ? '<em>公休</em>' : (day.past ? '<em>已過</em>' : (Number(day.availableSlotCount || 0) === 0 ? '<em>已滿</em>' : ''))}
        </button>
      `;
    }).join('');
    document.getElementById('prevRentalWeek').disabled = weekStart <= todayKey();
    document.getElementById('nextRentalWeek').disabled = P.addDays(weekStart, 7) > maximumAdvanceDate();
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
      studentDiscountEligible = boardData.studentDiscountEligible === true;
      studentOptions = Array.isArray(boardData.studentOptions) ? boardData.studentOptions : [];
      if (!studentOptions.some((row) => clean(row.id) === selectedStudentId)) {
        selectedStudentId = studentOptions.length === 1 ? clean(studentOptions[0].id) : '';
      }
      renderWelcomeName(boardData.displayName);
      weekStart = boardData.startDate || weekStart;
      selectedUse = boardData.selectedUseType || selectedUse;
      renderUses(boardData.useOptions || []);
      if (!(boardData.days || []).some((day) =>
        day.date === selectedDate && !day.closed && !day.past && Number(day.availableSlotCount || 0) > 0
      )) {
        selectedDate = ((boardData.days || []).find((day) =>
          !day.closed && !day.past && Number(day.availableSlotCount || 0) > 0
        ) || {}).date || todayKey();
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
      document.getElementById('rentalBoard').innerHTML = `
        <div class="rental-empty">
          <p>時段讀取失敗，用途仍可先選擇。</p>
          <button class="btn soft" type="button" data-retry-rental>重新讀取時段</button>
        </div>
      `;
      P.toast(error.message, 'error');
    }
  }

  function renderRooms() {
    const rows = (roomData && roomData.rooms || []).filter((row) => row.available);
    document.getElementById('roomGrid').innerHTML = rows.map((room) => {
      const equipment = roomEquipmentText(room);
      const photos = photosForRoom(room);
      return `
      <article class="rental-room-card">
        <button class="rental-room-select" type="button" data-room="${P.escapeHtml(room.id)}">
          <b>${P.escapeHtml(room.name)}</b>
          ${equipment ? `<span class="rental-room-equipment">${P.escapeHtml(equipment)}</span>` : ''}
          ${Number(room.capacity || 0) > 0 ? `<span class="rental-room-capacity">建議人數：${Number(room.capacity)} 人以內</span>` : ''}
          <strong class="rental-room-price">${selectedUse === 'recording' ? 'NT$100–300／小時' : P.money(room.price)}</strong>
          <span class="rental-room-select-hint">選擇這間</span>
        </button>
        ${photos.length ? `
          <button class="rental-room-photo-button" type="button" data-room-photo="${P.escapeHtml(room.id)}" aria-label="查看 ${P.escapeHtml(room.name)} 的照片">
            <span aria-hidden="true">📷</span> 看教室照片
          </button>
        ` : ''}
      </article>
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
    const student = role === 'student' && studentDiscountEligible;
    if (!student) {
      const generalRate = document.querySelector('input[name="rentalRate"][value="general"]');
      if (generalRate) generalRate.checked = true;
    }
    document.getElementById('rentalRateSection').classList.toggle('hidden', recording && !student);
    document.getElementById('studentRateLabel').classList.toggle('hidden', !student);
    document.getElementById('rentalRateHeading').textContent =
      recording ? '學生折扣（選填）' : '租用價格';
    document.getElementById('generalRateText').textContent =
      recording ? '不使用學生折扣' : '一般租用';
  }

  function selectedRecordingUsage() {
    const selected = document.querySelector('input[name="recordingUsage"]:checked');
    return selectedUse === 'recording' && selected ? clean(selected.value) : '';
  }

  function selectedStudent() {
    return studentOptions.find((row) => clean(row.id) === selectedStudentId) || null;
  }

  function renderBookingStudentChoice() {
    const field = document.getElementById('bookingStudentField');
    const select = document.getElementById('bookingStudent');
    const studentRole = role === 'student' && studentOptions.length > 0;
    field.classList.toggle('hidden', !studentRole);
    if (!studentRole) {
      select.innerHTML = '';
      return;
    }
    select.innerHTML = `${studentOptions.length > 1 ? '<option value="">請選擇學生</option>' : ''}${studentOptions.map((row) => `
      <option value="${P.escapeHtml(row.id)}" ${clean(row.id) === selectedStudentId ? 'selected' : ''}>${P.escapeHtml(row.name || '學生')}</option>
    `).join('')}`;
    select.disabled = studentOptions.length === 1;
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
    const student = selectedStudent();
    document.getElementById('confirmRenter').textContent =
      clean(student && student.name) ||
      (role === 'student' && studentOptions.length > 1 ? '請選擇學生' : clean(boardData && boardData.displayName)) ||
      '租用人';
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
    renderBookingStudentChoice();
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
        <span>${row.clientName ? `${P.escapeHtml(row.clientName)}・` : ''}${P.escapeHtml(row.roomName || '教室')}${row.useName ? `・${P.escapeHtml(row.useName)}` : ''}${row.recordingUsageName ? `（${P.escapeHtml(row.recordingUsageName)}）` : ''}</span>
        <strong>${P.money(row.amount)}</strong>
        <span>${row.canCancel
          ? `<button class="btn danger" type="button" data-cancel="${P.escapeHtml(row.id)}">取消</button>`
          : (row.status === 'cancelled' || row.active === false
            ? '已取消'
            : (new Date(`${row.date}T${row.endTime}:00+08:00`).getTime() <= Date.now()
              ? '已結束'
              : '進行中'))}</span>
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
    renderUses(immediateRentalUseOptions);
    showBooking(true);
    renderDurations();
    renderRateChoice();
    await Promise.all([loadRentalData(), loadBookings()]);
  }

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
    const retry = event.target.closest('[data-retry-rental]');
    if (retry) {
      loadRentalData();
      return;
    }
    const button = event.target.closest('[data-slot]');
    if (!button) return;
    selectedStart = button.dataset.slot;
    renderSlots();
    loadRooms();
  });

  document.getElementById('roomGrid').addEventListener('click', (event) => {
    const photoButton = event.target.closest('[data-room-photo]');
    if (photoButton && roomData) {
      const photoRoom = (roomData.rooms || []).find((row) => row.id === photoButton.dataset.roomPhoto);
      if (photoRoom) openRoomPhotos(photoRoom);
      return;
    }
    const button = event.target.closest('[data-room]');
    if (!button || !roomData) return;
    const room = (roomData.rooms || []).find((row) => row.id === button.dataset.room);
    if (room) openConfirm(room);
  });

  document.getElementById('closeRentalPhoto').addEventListener('click', closeRoomPhotos);
  document.getElementById('prevRentalPhoto').addEventListener('click', () => moveRoomPhoto(-1));
  document.getElementById('nextRentalPhoto').addEventListener('click', () => moveRoomPhoto(1));
  photoBackdrop.addEventListener('click', (event) => {
    if (event.target === photoBackdrop) closeRoomPhotos();
  });
  photoDialog.addEventListener('touchstart', (event) => {
    roomPhotoTouchStartX = event.changedTouches && event.changedTouches[0]
      ? event.changedTouches[0].clientX
      : 0;
  }, { passive: true });
  photoDialog.addEventListener('touchend', (event) => {
    const endX = event.changedTouches && event.changedTouches[0]
      ? event.changedTouches[0].clientX
      : roomPhotoTouchStartX;
    const distance = endX - roomPhotoTouchStartX;
    if (Math.abs(distance) >= 44) moveRoomPhoto(distance < 0 ? 1 : -1);
    roomPhotoTouchStartX = 0;
  }, { passive: true });
  document.addEventListener('keydown', (event) => {
    if (photoBackdrop.classList.contains('hidden')) return;
    if (event.key === 'Escape') closeRoomPhotos();
    else if (event.key === 'ArrowLeft') moveRoomPhoto(-1);
    else if (event.key === 'ArrowRight') moveRoomPhoto(1);
  });

  document.querySelectorAll('input[name="rentalRate"]').forEach((node) => {
    node.addEventListener('change', updateConfirm);
  });
  document.querySelectorAll('input[name="recordingUsage"]').forEach((node) => {
    node.addEventListener('change', updateConfirm);
  });
  document.getElementById('bookingStudent').addEventListener('change', (event) => {
    selectedStudentId = clean(event.target.value);
    updateConfirm();
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
    if (role === 'student' && studentOptions.length > 1 && !selectedStudentId) {
      P.toast('請先選擇本次使用教室的學生。', 'error');
      document.getElementById('bookingStudent').focus();
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
        studentId: selectedStudentId,
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
    const next = P.addDays(weekStart, 7);
    if (next > maximumAdvanceDate()) {
      P.toast(`租用日期最多只能選擇到 ${maximumAdvanceDate()}。`, 'error');
      return;
    }
    weekStart = next;
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
    const logoutRole = ['renter', 'student', 'teacher'].includes(role) ? role : requestedRoomRole();
    P.setSession(logoutRole, '');
    location.replace(`course-portal.html?method=line&role=${logoutRole}`);
  });

  (async function init() {
    try {
      const params = new URLSearchParams(location.search);
      if (params.get('access')) {
        const accessRole = requestedRoomRole();
        try {
          token = await P.exchangeAccess(accessRole);
          await openBooking(accessRole, token);
        } catch (error) {
          redirectToRoleLogin(accessRole, error);
        }
        return;
      }
      const saved = currentSession();
      if (saved) {
        try {
          await openBooking(saved.role, saved.token);
        } catch (error) {
          if (isAuthError(error)) {
            P.invalidateSession(saved.role, error);
            return;
          }
          showBooking(true);
          showRentalLoadFailure(error);
        }
        return;
      }
      redirectToRoleLogin(requestedRoomRole(), null, 'login-required');
    } catch (error) {
      const requested = requestedRoomRole();
      if (isAuthError(error)) {
        P.invalidateSession(requested, error);
        return;
      }
      showBooking(true);
      showRentalLoadFailure(error);
    }
  })();
})(window);
