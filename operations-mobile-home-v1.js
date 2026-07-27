(function (global) {
  'use strict';

  var VERSION = 'approved-mobile-home-v1';
  var FORMAL_DB_NAME = 'youzi-course-scheduler';
  var FORMAL_DB_STORE = 'formalSnapshots';
  var FORMAL_DB_KEY = 'latest';
  var FORMAL_CACHE_KEY = 'youzi.courseScheduler.formalCache.v1';
  var snapshot = null;
  var productQuery = '';
  var observer = null;
  var scheduled = false;

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function esc(value) {
    return clean(value).replace(/[&<>'"]/g, function (character) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[character];
    });
  }

  function attr(value) {
    return esc(value);
  }

  function numberOf(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function dateKey(value) {
    var date = value instanceof Date ? value : new Date(clean(value).slice(0, 10) + 'T12:00:00');
    if (!Number.isFinite(date.getTime())) return '';
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function todayKey() {
    return dateKey(new Date());
  }

  function timeToMinutes(value) {
    var parts = clean(value || '00:00').split(':');
    return numberOf(parts[0]) * 60 + numberOf(parts[1]);
  }

  function minutesToTime(value) {
    value = Math.max(0, numberOf(value));
    return pad(Math.floor(value / 60)) + ':' + pad(value % 60);
  }

  function currentView() {
    return (global.location.hash || '#overview').replace(/^#/, '').split('?')[0] || 'overview';
  }

  function operationsState() {
    return global.OperationsCenterV1 && global.OperationsCenterV1.state;
  }

  function selectedDate() {
    var state = operationsState() || {};
    return dateKey(state.overviewDate) || todayKey();
  }

  function byId(rows, id) {
    return (rows || []).find(function (row) { return clean(row && row.id) === clean(id); }) || {};
  }

  function openFormalDatabase() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      var request = global.indexedDB.open(FORMAL_DB_NAME, 1);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(FORMAL_DB_STORE)) db.createObjectStore(FORMAL_DB_STORE);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB open failed')); };
    });
  }

  async function readCourseSnapshot() {
    try {
      var db = await openFormalDatabase();
      var result = await new Promise(function (resolve, reject) {
        var transaction = db.transaction(FORMAL_DB_STORE, 'readonly');
        var request = transaction.objectStore(FORMAL_DB_STORE).get(FORMAL_DB_KEY);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error || new Error('IndexedDB read failed')); };
        transaction.oncomplete = function () { db.close(); };
      });
      if (result) return result;
    } catch (_) {}

    try {
      return JSON.parse(global.localStorage.getItem(FORMAL_CACHE_KEY) || 'null');
    } catch (_) {
      return null;
    }
  }

  function ruleOccursOn(rule, targetDate) {
    var start = dateKey(rule.startDate);
    var end = dateKey(rule.endDate);
    if (!start || targetDate < start || (end && targetDate > end) || rule.active === false) return false;
    var startDate = new Date(start + 'T12:00:00');
    var target = new Date(targetDate + 'T12:00:00');
    if (startDate.getDay() !== target.getDay()) return false;
    var weeks = Math.floor((target - startDate) / 604800000);
    return weeks >= 0 && weeks % Math.max(1, numberOf(rule.intervalWeeks) || 1) === 0;
  }

  function scheduleEvents(targetDate) {
    if (!snapshot) return [];
    var explicit = (snapshot.events || []).filter(function (event) {
      return dateKey(event.date) === targetDate && !['cancelled', 'canceled', 'voided', 'leave'].includes(clean(event.status).toLowerCase());
    });
    var explicitSeries = new Set(explicit.map(function (event) { return clean(event.seriesId); }).filter(Boolean));
    var recurring = (snapshot.recurringRules || []).filter(function (rule) {
      return ruleOccursOn(rule, targetDate) && !explicitSeries.has(clean(rule.id));
    }).map(function (rule) {
      return Object.assign({}, rule, {
        id: 'rule-' + clean(rule.id) + '-' + targetDate,
        seriesId: clean(rule.id),
        date: targetDate,
        status: 'scheduled'
      });
    });
    return explicit.concat(recurring).sort(function (left, right) {
      return timeToMinutes(left.start) - timeToMinutes(right.start);
    });
  }

  function eventLabel(event) {
    var studentNames = (event.studentIds || []).map(function (id) {
      return clean(byId(snapshot && snapshot.students, id).name);
    }).filter(Boolean);
    if (event.type === 'rental') return clean(event.clientName) || '教室租用';
    return studentNames.join('、') || clean(event.clientName) || '未命名課程';
  }

  function eventClass(event) {
    var type = clean(event.type).toLowerCase();
    if (type === 'rental') return 'rental';
    if (type === 'trial') return 'trial';
    if (type === 'reschedule' || type === 'temporary' || type === 'makeup') return 'reschedule';
    return 'fixed';
  }

  function scheduleHtml() {
    var date = selectedDate();
    var rooms = snapshot && Array.isArray(snapshot.rooms)
      ? snapshot.rooms.filter(function (room) { return room.active !== false; })
      : [];
    var settings = snapshot && snapshot.settings ? snapshot.settings : {};
    var startHour = Math.max(0, Math.min(23, numberOf(settings.startHour) || 10));
    var endHour = Math.max(startHour + 1, Math.min(24, numberOf(settings.endHour) || 22));
    var slotCount = (endHour - startHour) * 2;
    var events = scheduleEvents(date);

    if (!rooms.length) {
      return '<section class="ops-card ops-approved-schedule-card"><div class="ops-card-head"><div><h2>今日課表</h2><p>教室為直欄、時間為橫列；點課程可操作</p></div><button type="button" class="ops-approved-link-button" data-nav="course-calendar">完整課表</button></div><div class="ops-approved-schedule-empty">課表資料正在載入；也可以按「完整課表」查看。</div></section>';
    }

    var html = '<section class="ops-card ops-approved-schedule-card"><div class="ops-card-head"><div><h2>今日課表</h2><p>教室為直欄、時間為橫列；點課程可操作</p></div><button type="button" class="ops-approved-link-button" data-nav="course-calendar">完整課表</button></div>';
    html += '<div class="ops-approved-schedule-wrap"><div class="ops-approved-schedule-grid" style="--room-count:' + rooms.length + ';--slot-count:' + slotCount + '">';
    html += '<div class="ops-approved-schedule-corner" style="grid-column:1;grid-row:1">時間</div>';
    rooms.forEach(function (room, index) {
      html += '<div class="ops-approved-schedule-room" style="grid-column:' + (index + 2) + ';grid-row:1">' + esc(room.name || ('教室 ' + (index + 1))) + '</div>';
    });
    for (var slot = 0; slot < slotCount; slot += 1) {
      var row = slot + 2;
      var minute = startHour * 60 + slot * 30;
      var half = slot % 2 ? ' half' : '';
      html += '<div class="ops-approved-schedule-time' + half + '" style="grid-column:1;grid-row:' + row + '">' + (slot % 2 ? '' : minutesToTime(minute)) + '</div>';
      rooms.forEach(function (_, roomIndex) {
        html += '<div class="ops-approved-schedule-cell' + half + '" style="grid-column:' + (roomIndex + 2) + ';grid-row:' + row + '"></div>';
      });
    }
    events.forEach(function (event) {
      var roomIndex = rooms.findIndex(function (room) { return clean(room.id) === clean(event.roomId); });
      var eventStart = timeToMinutes(event.start);
      if (roomIndex < 0 || eventStart < startHour * 60 || eventStart >= endHour * 60) return;
      var startSlot = Math.floor((eventStart - startHour * 60) / 30);
      var span = Math.max(1, Math.ceil((numberOf(event.duration) || 60) / 30));
      var teacher = clean(byId(snapshot.teachers, event.teacherId).name);
      var subject = clean(byId(snapshot.subjects, event.subjectId).name);
      html += '<button type="button" class="ops-approved-schedule-event ' + eventClass(event) + '" data-nav="course-calendar" style="grid-column:' + (roomIndex + 2) + ';grid-row:' + (startSlot + 2) + ' / span ' + Math.min(span, slotCount - startSlot) + '" title="' + attr(eventLabel(event)) + '">';
      html += '<b>' + esc(eventLabel(event)) + '</b><span>' + esc([subject, teacher].filter(Boolean).join(' · ') || (event.type === 'rental' ? '租用' : '課程')) + '</span></button>';
    });
    html += '</div></div></section>';
    return html;
  }

  function productImage(product) {
    var images = [];
    if (Array.isArray(product.images)) images = images.concat(product.images);
    if (Array.isArray(product.imageUrls)) images = images.concat(product.imageUrls);
    images.push(product.imageUrl, product.photoUrl, product.onlineImageUrl, product.storeImageUrl);
    return clean(images.find(function (value) { return clean(value); }));
  }

  function productName(product) {
    return clean(product.originalName || product.onlineName || product.name) || '未命名商品';
  }

  function productRows() {
    var state = operationsState() || {};
    var term = clean(productQuery).toLowerCase();
    return (state.catalog || []).filter(function (product) {
      if (!term) return true;
      return [productName(product), product.sku, product.barcode].some(function (value) {
        return clean(value).toLowerCase().includes(term);
      });
    }).slice(0, 6);
  }

  function productListHtml() {
    var rows = productRows();
    if (!rows.length) return '<div class="ops-approved-schedule-empty">找不到符合的商品。</div>';
    return '<div class="ops-approved-product-list">' + rows.map(function (product) {
      var image = productImage(product);
      var stock = numberOf(product.currentStock);
      return '<button type="button" class="ops-approved-product" data-approved-product="' + attr(product.id) + '" data-approved-sku="' + attr(product.sku) + '">'
        + (image ? '<img src="' + attr(image) + '" alt="">' : '<span class="placeholder">商品</span>')
        + '<span><b>' + esc(productName(product)) + '</b><span>' + esc((clean(product.sku) ? clean(product.sku) + ' · ' : '') + '庫存 ' + stock) + '</span></span></button>';
    }).join('') + '</div>';
  }

  function productsHtml() {
    return '<section class="ops-card ops-approved-products-card"><div class="ops-card-head"><div><h2>快速找商品</h2><p>圖片、售價與庫存一起確認</p></div><button type="button" class="ops-approved-link-button" data-nav="products">全部商品</button></div>'
      + '<div class="ops-approved-product-search"><input id="opsApprovedProductSearch" type="search" autocomplete="off" placeholder="搜尋商品名稱、編號或條碼" value="' + attr(productQuery) + '"></div>'
      + '<div id="opsApprovedProductResults">' + productListHtml() + '</div></section>';
  }

  function modeLabel() {
    if (snapshot && snapshot.dataMode === 'sandbox') return '測試模式';
    return '正式資料';
  }

  function enhanceMobileHome() {
    var content = document.getElementById('opsContent');
    var mobile = global.matchMedia ? global.matchMedia('(max-width: 820px)').matches : global.innerWidth <= 820;
    var overview = currentView() === 'overview';
    document.body.classList.toggle('ops-approved-mobile-home', mobile && overview);
    if (!content || !mobile || !overview) return;
    if (content.dataset.approvedMobileHome === VERSION && content.querySelector('.ops-approved-mobile-head')) {
      bindInjectedEvents();
      return;
    }
    if (content.querySelector('.ops-loading')) return;

    content.dataset.approvedMobileHome = VERSION;
    content.querySelectorAll('.ops-approved-mobile-head,.ops-approved-schedule-card,.ops-approved-products-card').forEach(function (node) {
      node.remove();
    });
    content.insertAdjacentHTML('afterbegin', '<header class="ops-approved-mobile-head"><span class="mark">營</span><span class="copy"><h1>營運總覽</h1><p>今天的營運狀況</p></span><span class="mode">' + esc(modeLabel()) + '</span></header>');

    var profit = content.querySelector('.ops-mobile-profit-card');
    if (profit) {
      var profitHead = profit.querySelector('.ops-card-head');
      if (profitHead && !profitHead.querySelector('.ops-approved-report-button')) {
        profitHead.insertAdjacentHTML('beforeend', '<button type="button" class="ops-approved-report-button" data-action="mobile-overview-details">完整報表</button>');
      }
    }

    var quick = content.querySelector('.ops-mobile-direct-card');
    var details = document.getElementById('opsMobileOverviewDetails');
    if (details) {
      details.insertAdjacentHTML('beforebegin', scheduleHtml() + productsHtml());
    } else if (quick) {
      quick.insertAdjacentHTML('afterend', scheduleHtml() + productsHtml());
    } else {
      content.insertAdjacentHTML('beforeend', scheduleHtml() + productsHtml());
    }
    bindInjectedEvents();
  }

  function bindInjectedEvents() {
    var search = document.getElementById('opsApprovedProductSearch');
    if (search && !search.dataset.bound) {
      search.dataset.bound = '1';
      search.addEventListener('input', function () {
        productQuery = search.value;
        var results = document.getElementById('opsApprovedProductResults');
        if (results) results.innerHTML = productListHtml();
      });
    }
    document.querySelectorAll('[data-approved-product]').forEach(function (button) {
      if (button.dataset.bound) return;
      button.dataset.bound = '1';
      button.addEventListener('click', function () {
        var state = operationsState();
        if (state) {
          state.productSearch = clean(button.dataset.approvedSku);
          state.productFilter = 'all';
          state.productSeries = 'all';
        }
        global.location.hash = 'products';
      });
    });
  }

  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    global.requestAnimationFrame(function () {
      scheduled = false;
      enhanceMobileHome();
    });
  }

  function start() {
    observer = new MutationObserver(scheduleEnhance);
    observer.observe(document.body, {childList: true, subtree: true});
    global.addEventListener('hashchange', scheduleEnhance);
    global.addEventListener('resize', scheduleEnhance);
    scheduleEnhance();
    readCourseSnapshot().then(function (value) {
      snapshot = value;
      var content = document.getElementById('opsContent');
      if (content) content.removeAttribute('data-approved-mobile-home');
      scheduleEnhance();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
