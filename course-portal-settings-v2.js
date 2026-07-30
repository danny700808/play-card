(function (global) {
  'use strict';

  const P = global.CoursePortal;
  let rooms = [];
  let items = [];
  let policy = { businessHours: {}, studentDiscountRate: .5, maxDurationMinutes: 300 };
  const dayNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function iconFor(row) {
    const text = `${clean(row.id)} ${clean(row.name)}`.toLowerCase();
    if (/guzheng|古箏/.test(text)) return '🪕';
    if (/record|錄音/.test(text)) return '🎙️';
    if (/piano|鋼琴/.test(text)) return '🎹';
    if (/drum|鼓/.test(text)) return '🥁';
    if (/band|團練/.test(text)) return '🎸';
    return '🎵';
  }

  function defaultHours() {
    return {
      '0': { closed: false, start: '10:00', end: '21:00' },
      '1': { closed: true, start: '', end: '' },
      '2': { closed: false, start: '12:30', end: '21:00' },
      '3': { closed: false, start: '12:30', end: '21:00' },
      '4': { closed: false, start: '12:30', end: '21:00' },
      '5': { closed: false, start: '12:30', end: '21:00' },
      '6': { closed: false, start: '10:00', end: '21:00' }
    };
  }

  function renderHours() {
    const hours = Object.assign(defaultHours(), policy.businessHours || {});
    document.getElementById('businessRows').innerHTML = Object.keys(hours)
      .sort((left, right) => Number(left) - Number(right))
      .map((day) => {
        const row = hours[day] || {};
        return `
          <div class="business-row">
            <strong>${dayNames[Number(day)]}</strong>
            <label><input type="checkbox" data-day-closed="${day}" ${row.closed ? 'checked' : ''}> 公休</label>
            <input type="time" data-day-start="${day}" value="${row.start || ''}" ${row.closed ? 'disabled' : ''}>
            <input type="time" data-day-end="${day}" value="${row.end || ''}" ${row.closed ? 'disabled' : ''}>
          </div>
        `;
      }).join('');
  }

  function renderRooms() {
    document.getElementById('roomRows').innerHTML = rooms.map((room, index) => `
      <div class="room-setting-row">
        <strong>${P.escapeHtml(room.name)}</strong>
        <select data-room-kind="${index}">
          <option value="normal" ${room.kind === 'normal' ? 'selected' : ''}>一般教室</option>
          <option value="video" ${room.kind === 'video' ? 'selected' : ''}>視訊教室</option>
          <option value="holding" ${room.kind === 'holding' ? 'selected' : ''}>不定時教室</option>
        </select>
        <label>鋼琴設備
          <select data-room-piano="${index}">
            <option value="" ${!room.pianoType ? 'selected' : ''}>無鋼琴</option>
            <option value="digital_piano" ${room.pianoType === 'digital_piano' ? 'selected' : ''}>電鋼琴</option>
            <option value="grand_piano" ${room.pianoType === 'grand_piano' ? 'selected' : ''}>平台鋼琴</option>
            <option value="upright_piano" ${room.pianoType === 'upright_piano' ? 'selected' : ''}>直立鋼琴</option>
          </select>
        </label>
        <label>每小時 <input type="number" min="0" step="50" data-room-fee="${index}" value="${Number(room.rentalFee || 0)}" style="width:72px"></label>
        <label><input type="checkbox" data-room-rentable="${index}" ${room.rentable ? 'checked' : ''}> 可租用</label>
        <label><input type="checkbox" data-room-teacher="${index}" ${room.teacherSchedulable !== false ? 'checked' : ''}> 可排課</label>
      </div>
    `).join('');
  }

  function renderUses() {
    document.getElementById('useRows').innerHTML = items.map((row, index) => `
      <article class="use-setting-row">
        <input data-use-icon="${index}" value="${P.escapeHtml(row.icon || iconFor(row))}" aria-label="圖示">
        <input data-use-name="${index}" value="${P.escapeHtml(row.name)}" aria-label="用途名稱">
        <button class="btn danger" type="button" data-remove-use="${index}">刪除</button>
        <div class="use-extra-fields">
          <label>用途說明
            <input data-use-description="${index}" value="${P.escapeHtml(row.description || '')}" placeholder="顯示在租用選項下方">
          </label>
          <label>每小時固定費用
            <input type="number" min="0" step="50" data-use-rate="${index}" value="${row.hourlyRate == null ? '' : Number(row.hourlyRate)}" placeholder="未填＝教室原價">
          </label>
        </div>
        <div class="use-room-choices">
          ${rooms.filter((room) => room.kind === 'normal').map((room) => {
            const checked = (row.roomIds || []).includes(room.id);
            return `
              <label class="use-room-choice">
                <input type="checkbox" data-use-room="${index}|${P.escapeHtml(room.id)}" ${checked ? 'checked' : ''}>
                ${P.escapeHtml(room.name)}
              </label>
            `;
          }).join('')}
        </div>
      </article>
    `).join('') || '<p class="muted">尚未設定。</p>';
  }

  function collect() {
    policy.businessHours = {};
    document.querySelectorAll('[data-day-closed]').forEach((node) => {
      const day = node.dataset.dayClosed;
      policy.businessHours[day] = {
        closed: node.checked,
        start: (document.querySelector(`[data-day-start="${day}"]`) || {}).value || '',
        end: (document.querySelector(`[data-day-end="${day}"]`) || {}).value || ''
      };
    });

    rooms.forEach((room, index) => {
      room.kind = document.querySelector(`[data-room-kind="${index}"]`).value;
      room.pianoType = document.querySelector(`[data-room-piano="${index}"]`).value;
      room.rentalFee = Number(document.querySelector(`[data-room-fee="${index}"]`).value || 0);
      room.rentable = document.querySelector(`[data-room-rentable="${index}"]`).checked;
      room.teacherSchedulable = document.querySelector(`[data-room-teacher="${index}"]`).checked;
    });

    items.forEach((row, index) => {
      row.name = document.querySelector(`[data-use-name="${index}"]`).value;
      row.icon = document.querySelector(`[data-use-icon="${index}"]`).value;
      row.description = document.querySelector(`[data-use-description="${index}"]`).value;
      const rate = document.querySelector(`[data-use-rate="${index}"]`).value;
      row.hourlyRate = rate === '' ? null : Number(rate);
      row.roomIds = [...document.querySelectorAll(`[data-use-room^="${index}|"]:checked`)]
        .map((node) => node.dataset.useRoom.split('|')[1]);
      row.active = true;
    });
  }

  async function loadSettings() {
    const pin = document.getElementById('pin').value.trim();
    if (!pin) {
      P.toast('請先輸入管理密碼。', 'error');
      return;
    }
    const result = await P.call('coursePortalAdminRentalSettingsData', { adminPin: pin });
    rooms = result.rooms || [];
    items = result.items || [];
    policy = Object.assign({
      businessHours: defaultHours(),
      studentDiscountRate: .5,
      maxDurationMinutes: 300
    }, result.policy || {});
    renderHours();
    renderRooms();
    renderUses();
  }

  async function saveSettings() {
    const pin = document.getElementById('pin').value.trim();
    if (!pin) {
      P.toast('請先輸入管理密碼。', 'error');
      return;
    }
    collect();
    const button = document.getElementById('saveSettings');
    P.loading(button, true, '儲存中…');
    try {
      await P.call('coursePortalAdminSaveRentalSettings', { adminPin: pin, items, policy, rooms });
      P.toast('設定已儲存。');
      await loadSettings();
    } catch (error) {
      P.toast(error.message, 'error');
    } finally {
      P.loading(button, false);
    }
  }

  async function loadRequests() {
    const pin = document.getElementById('pin').value.trim();
    if (!pin) {
      P.toast('請先輸入管理密碼。', 'error');
      return;
    }
    const result = await P.call('coursePortalAdminBonusRequests', { adminPin: pin });
    const rows = result.requests || [];
    document.getElementById('requests').innerHTML = rows.map((row) => `
      <article class="list-row bonus-admin-row">
        <div><strong>${P.escapeHtml(row.teacherName || '老師')}／${P.escapeHtml(row.studentName || '學生')}</strong><span>${P.escapeHtml(row.createdAtText || '')}</span></div>
        <div><span>${P.escapeHtml(row.description || '')}</span>${row.photoData ? `<img src="${row.photoData}" alt="申請照片">` : ''}</div>
        <div>${row.status === 'approved'
          ? `<span class="badge">已核定 ${P.money(row.approvedAmount)}</span>`
          : `<input type="number" min="1" placeholder="獎金" data-amount="${row.id}" style="width:90px"><button class="btn primary" type="button" data-approve="${row.id}">核定</button>`}
        </div>
      </article>
    `).join('') || '<p class="muted">沒有申請。</p>';
  }

  document.getElementById('loadSettings').addEventListener('click', loadSettings);
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('addUse').addEventListener('click', () => {
    items.push({
      id: `use-${Date.now()}`,
      name: '新用途',
      icon: '🎵',
      description: '',
      roomIds: [],
      hourlyRate: null,
      active: true
    });
    renderUses();
  });
  document.getElementById('useRows').addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-use]');
    if (!button) return;
    items.splice(Number(button.dataset.removeUse), 1);
    renderUses();
  });
  document.getElementById('businessRows').addEventListener('change', (event) => {
    if (!event.target.matches('[data-day-closed]')) return;
    const day = event.target.dataset.dayClosed;
    document.querySelector(`[data-day-start="${day}"]`).disabled = event.target.checked;
    document.querySelector(`[data-day-end="${day}"]`).disabled = event.target.checked;
  });
  document.getElementById('loadRequests').addEventListener('click', loadRequests);
  document.getElementById('requests').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-approve]');
    if (!button) return;
    const input = document.querySelector(`[data-amount="${button.dataset.approve}"]`);
    P.loading(button, true, '核定中…');
    try {
      await P.call('coursePortalAdminApproveBonus', {
        adminPin: document.getElementById('pin').value.trim(),
        id: button.dataset.approve,
        amount: input.value
      });
      P.toast('已核定並寫入老師薪資。');
      await loadRequests();
    } catch (error) {
      P.toast(error.message, 'error');
    } finally {
      P.loading(button, false);
    }
  });
})(window);
