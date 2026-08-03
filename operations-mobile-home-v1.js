(function (global) {
  'use strict';

  var VERSION = 'approved-mobile-home-day-v3';
  var FORMAL_DB_NAME = 'youzi-course-scheduler';
  var FORMAL_DB_STORE = 'formalSnapshots';
  var FORMAL_DB_KEY = 'latest';
  var FORMAL_CACHE_KEY = 'youzi.courseScheduler.formalCache.v1';
  var snapshot = null;
  var productQuery = '';
  var observer = null;
  var scheduled = false;
  var scheduleWeekOffset = 0;
  var scheduleAnchorDate = '';

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

  function shiftDate(value, amount) {
    var date = new Date(dateKey(value) + 'T12:00:00');
    date.setDate(date.getDate() + numberOf(amount));
    return dateKey(date);
  }

  function weekStartKey(value) {
    var date = new Date(dateKey(value) + 'T12:00:00');
    var day = date.getDay();
    date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
    return dateKey(date);
  }

  function dateParts(value) {
    var date = new Date(dateKey(value) + 'T12:00:00');
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      weekday: '日一二三四五六'[date.getDay()] || ''
    };
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
    var sameDay = (snapshot.events || []).filter(function (event) {
      return dateKey(event.date || event.startDate) === targetDate;
    });
    var explicit = sameDay.filter(function (event) {
      return !['cancelled', 'canceled', 'voided', 'leave'].includes(clean(event.status).toLowerCase());
    });
    var explicitSeries = new Set(sameDay.map(function (event) { return clean(event.seriesId); }).filter(Boolean));
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
      return eventStartMinutes(left) - eventStartMinutes(right);
    });
  }

  function eventStartMinutes(event) {
    return timeToMinutes(event.start || event.startTime || event.time);
  }

  function eventDurationMinutes(event) {
    var duration = numberOf(event.duration || event.durationMinutes);
    if (duration > 0) return duration;
    var start = eventStartMinutes(event);
    var end = timeToMinutes(event.end || event.endTime);
    return end > start ? end - start : 60;
  }

  function eventLabel(event) {
    var studentIds = Array.isArray(event.studentIds) ? event.studentIds.slice() : [];
    if (event.studentId) studentIds.push(event.studentId);
    var studentNames = studentIds.map(function (id) {
      return clean(byId(snapshot && snapshot.students, id).name);
    }).filter(Boolean);
    var renter = clean(event.clientName || event.renterName || event.customerName || event.bookedByName || event.contactName);
    if (clean(event.type).toLowerCase() === 'rental') return renter || '教室租用';
    return studentNames.join('、') || renter || clean(event.studentName) || '未命名課程';
  }

  function eventClass(event) {
    var type = clean(event.type).toLowerCase();
    if (type === 'rental') return 'rental';
    if (type === 'trial') return 'trial';
    if (type === 'reschedule' || type === 'temporary' || type === 'makeup') return 'reschedule';
    return 'fixed';
  }

  function layoutDayEvents(events, startMinute, endMinute) {
    var rows = events.map(function (event) {
      var rawStart = eventStartMinutes(event);
      var rawEnd = rawStart + eventDurationMinutes(event);
      return {event: event, start: Math.max(startMinute, rawStart), end: Math.min(endMinute, rawEnd), lane: 0, laneCount: 1};
    }).filter(function (row) {
      return row.start < endMinute && row.end > startMinute;
    }).sort(function (left, right) {
      return left.start - right.start || left.end - right.end;
    });
    var components = [];
    var component = [];
    var componentEnd = -1;
    rows.forEach(function (row) {
      if (component.length && row.start >= componentEnd) {
        components.push(component);
        component = [];
        componentEnd = -1;
      }
      component.push(row);
      componentEnd = Math.max(componentEnd, row.end);
    });
    if (component.length) components.push(component);
    components.forEach(function (items) {
      var laneEnds = [];
      items.forEach(function (item) {
        var lane = laneEnds.findIndex(function (end) { return end <= item.start; });
        if (lane < 0) lane = laneEnds.length;
        item.lane = lane;
        laneEnds[lane] = item.end;
      });
      items.forEach(function (item) { item.laneCount = Math.max(1, laneEnds.length); });
    });
    return rows;
  }

  function weekRangeLabel(start) {
    var first = dateParts(start);
    var last = dateParts(shiftDate(start, 6));
    return first.year + '/' + first.month + '/' + first.day + '－' + last.month + '/' + last.day;
  }

  function scheduleHtml() {
    var anchor = selectedDate();
    if (scheduleAnchorDate !== anchor) {
      scheduleAnchorDate = anchor;
      scheduleWeekOffset = 0;
    }
    var startDate = shiftDate(weekStartKey(anchor), scheduleWeekOffset * 7);
    var days = Array.from({length: 7}, function (_, index) { return shiftDate(startDate, index); });
    var settings = snapshot && snapshot.settings ? snapshot.settings : {};
    var startHour = Math.max(0, Math.min(23, numberOf(settings.startHour) || 10));
    var endHour = Math.max(startHour + 1, Math.min(24, numberOf(settings.endHour) || 22));
    var slotCount = (endHour - startHour) * 2;
    var startMinute = startHour * 60;
    var endMinute = endHour * 60;
    var initialDay = scheduleWeekOffset === 0 ? Math.max(0, days.indexOf(anchor)) : 0;

    if (!snapshot) {
      return '<section class="ops-card ops-approved-schedule-card"><div class="ops-card-head"><div><h2>全體週課表</h2></div><button type="button" class="ops-approved-link-button" data-nav="course-calendar">完整課表</button></div><div class="ops-approved-schedule-empty">課表資料正在載入；也可以按「完整課表」查看。</div></section>';
    }

    var html = '<section class="ops-card ops-approved-schedule-card"><div class="ops-card-head"><div><h2>全體週課表</h2></div><button type="button" class="ops-approved-link-button" data-nav="course-calendar">完整課表</button></div>';
    html += '<div class="ops-approved-week-nav"><button type="button" data-approved-week-step="-1">← 上週</button><button type="button" class="current" data-approved-week-step="0">' + esc(weekRangeLabel(startDate)) + '</button><button type="button" data-approved-week-step="1">下週 →</button></div>';
    html += '<div class="ops-approved-week-scroll" data-approved-one-day-viewport data-initial-day="' + initialDay + '"><div class="ops-approved-week-grid" style="--slot-count:' + slotCount + '">';
    html += '<div class="ops-approved-week-corner" style="grid-column:1;grid-row:1">時間</div>';
    days.forEach(function (day, index) {
      var parts = dateParts(day);
      var classes = 'ops-approved-week-head snap-start' + (day === anchor ? ' selected' : '') + (parts.weekday === '一' ? ' closed' : '');
      html += '<div class="' + classes + '" data-day-index="' + index + '" style="grid-column:' + (index + 2) + ';grid-row:1"><b>' + parts.month + '/' + parts.day + '（' + parts.weekday + '）</b>' + (parts.weekday === '一' ? '<small>公休</small>' : '') + '</div>';
    });
    for (var slot = 0; slot < slotCount; slot += 1) {
      var row = slot + 2;
      var minute = startMinute + slot * 30;
      var half = slot % 2 ? ' half' : '';
      html += '<div class="ops-approved-week-time' + half + '" style="grid-column:1;grid-row:' + row + '">' + (slot % 2 ? '' : minutesToTime(minute)) + '</div>';
      days.forEach(function (day, dayIndex) {
        var closed = dateParts(day).weekday === '一' ? ' closed' : '';
        html += '<div class="ops-approved-week-cell' + half + closed + '" style="grid-column:' + (dayIndex + 2) + ';grid-row:' + row + '"></div>';
      });
    }
    days.forEach(function (day, dayIndex) {
      html += '<div class="ops-approved-week-events" style="grid-column:' + (dayIndex + 2) + ';grid-row:2 / span ' + slotCount + '">';
      layoutDayEvents(scheduleEvents(day), startMinute, endMinute).forEach(function (layout) {
        var event = layout.event;
        var top = ((layout.start - startMinute) / (endMinute - startMinute)) * 100;
        var height = ((layout.end - layout.start) / (endMinute - startMinute)) * 100;
        var width = 100 / layout.laneCount;
        var left = width * layout.lane;
        var teacher = clean(event.teacherName || byId(snapshot.teachers, event.teacherId).name);
        var subject = clean(event.subjectName || byId(snapshot.subjects, event.subjectId).name);
        var detail = [subject, teacher].filter(Boolean).join(' · ') || (clean(event.type).toLowerCase() === 'rental' ? '租用' : '課程');
        html += '<button type="button" class="ops-approved-week-event ' + eventClass(event) + '" data-nav="course-calendar" style="top:' + top.toFixed(4) + '%;height:' + Math.max(height, 2.2).toFixed(4) + '%;left:' + left.toFixed(4) + '%;width:' + width.toFixed(4) + '%" title="' + attr(eventLabel(event) + '｜' + detail) + '">';
        html += '<b>' + esc(eventLabel(event)) + '</b><span>' + esc(detail) + '</span></button>';
      });
      html += '</div>';
    });
    html += '</div></div><p class="ops-approved-week-hint">左右滑動，每次查看一天；左側時間固定。</p></section>';
    return html;
  }

  function updateApprovedWeekViewport(resetPosition) {
    var scroll = document.querySelector('[data-approved-one-day-viewport]');
    if (!scroll) return;
    var grid = scroll.querySelector('.ops-approved-week-grid');
    if (!grid) return;
    var timeWidth = 48;
    var previousDayWidth = numberOf(scroll.dataset.dayWidth);
    var currentDay = previousDayWidth > 0
      ? Math.max(0, Math.min(6, Math.round(scroll.scrollLeft / previousDayWidth)))
      : Math.max(0, Math.min(6, numberOf(scroll.dataset.initialDay)));
    var dayWidth = Math.max(180, scroll.clientWidth - timeWidth);
    grid.style.setProperty('--overview-time-column', timeWidth + 'px');
    grid.style.setProperty('--overview-day-width', dayWidth + 'px');
    scroll.dataset.dayWidth = String(dayWidth);
    if (resetPosition || !scroll.dataset.positioned || Math.abs(previousDayWidth - dayWidth) > 0.5) {
      scroll.dataset.positioned = '1';
      var initialDay = resetPosition ? Math.max(0, Math.min(6, numberOf(scroll.dataset.initialDay))) : currentDay;
      var target = initialDay * dayWidth;
      scroll.scrollLeft = Math.min(target, Math.max(0, scroll.scrollWidth - scroll.clientWidth));
    }
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
    return '<section class="ops-card ops-approved-products-card"><div class="ops-card-head"><div><h2>快速找商品</h2></div><button type="button" class="ops-approved-link-button" data-nav="products">全部商品</button></div>'
      + '<div class="ops-approved-product-search"><input id="opsApprovedProductSearch" type="search" autocomplete="off" placeholder="搜尋商品名稱、編號或條碼" value="' + attr(productQuery) + '"></div>'
      + '<div id="opsApprovedProductResults">' + productListHtml() + '</div></section>';
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
    content.insertAdjacentHTML('afterbegin', '<header class="ops-approved-mobile-head"><span class="mark">營</span><span class="copy"><h1>營運總覽</h1></span></header>');

    var profit = content.querySelector('.ops-mobile-profit-card');
    if (profit) {
      var profitHead = profit.querySelector('.ops-card-head');
      if (profitHead && !profitHead.querySelector('.ops-approved-report-button')) {
        profitHead.insertAdjacentHTML('beforeend', '<button type="button" class="ops-approved-report-button" data-action="mobile-overview-details">完整報表</button>');
      }
    }

    var quick = content.querySelector('.ops-mobile-direct-card');
    if (quick) {
      quick.insertAdjacentHTML('afterend', scheduleHtml() + productsHtml());
    } else {
      content.insertAdjacentHTML('beforeend', scheduleHtml() + productsHtml());
    }
    bindInjectedEvents();
    global.requestAnimationFrame(function () { updateApprovedWeekViewport(true); });
  }

  function bindInjectedEvents() {
    document.querySelectorAll('[data-approved-week-step]').forEach(function (button) {
      if (button.dataset.bound) return;
      button.dataset.bound = '1';
      button.addEventListener('click', function () {
        var step = numberOf(button.dataset.approvedWeekStep);
        scheduleWeekOffset = step === 0 ? 0 : scheduleWeekOffset + step;
        var card = button.closest('.ops-approved-schedule-card');
        if (card) card.outerHTML = scheduleHtml();
        bindInjectedEvents();
        global.requestAnimationFrame(function () { updateApprovedWeekViewport(true); });
      });
    });
    updateApprovedWeekViewport(false);
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
