(function(global){
  'use strict';
  const Rental = {};
  function clean(v){ return String(v == null ? '' : v).trim(); }
  function num(v){ const n=Number(String(v==null?'':v).replace(/[^0-9.-]/g,'')); return Number.isFinite(n)?n:0; }
  function pad(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ if(!(d instanceof Date)) d=new Date(d); if(isNaN(d.getTime())) return ''; return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function rocDate(dateText){ const d=new Date(clean(dateText)+'T00:00:00'); if(isNaN(d.getTime())) return clean(dateText)||'　年　月　日'; return `民國 ${d.getFullYear()-1911} 年 ${d.getMonth()+1} 月 ${d.getDate()} 日`; }
  function addDays(dateText, days){ const d=new Date(clean(dateText)+'T00:00:00'); if(isNaN(d.getTime())) return ''; d.setDate(d.getDate()+Number(days||0)); return ymd(d); }
  function fmtMoney(v){ const n=num(v); return n ? n.toLocaleString('zh-TW')+' 元' : '0 元'; }
  function normalizeDeliveryMethod(value) {
    const raw = clean(value);
    if (/自取|自運|自行|自己/.test(raw)) return '自取自運';
    if (/到府|安裝|配送|運送|宅配|送達/.test(raw)) return '到府安裝';
    return raw || '到府安裝';
  }
  function esc(s){ return clean(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function qs(id){ return document.getElementById(id); }
  function val(id){ const el=qs(id); return el ? clean(el.value) : ''; }
  function checked(id){ const el=qs(id); return !!(el && el.checked); }
  function setVal(id,v){ const el=qs(id); if(el) el.value = v == null ? '' : v; }
  function show(el, display='block'){ if(typeof el==='string') el=qs(el); if(el) el.style.display=display; }
  function hide(el){ if(typeof el==='string') el=qs(el); if(el) el.style.display='none'; }
  function toast(msg, ok=true){ const el=qs('msg') || qs('statusMsg'); if(el){ el.textContent=msg; el.className=ok?'msg ok':'msg bad'; } else alert(msg); }
  function user(){ try{return JSON.parse(localStorage.getItem('employeeUser')||'null')||{};}catch(e){return{};} }
  function isManager(u=user()){ const role=clean(u.role).toLowerCase(); return !!(u && (u.showSettingsZone || role==='admin' || role==='manager' || role==='主管')); }
  function requireManager(){ const u=user(); if(!u || !clean(u.id||u.employeeId||u.email)){ location.href='index.html'; return null; } if(!isManager(u)){ location.href='dashboard.html'; return null; } return u; }
  function firebaseApp(){
    const cfg=(global.APP_CONFIG&&global.APP_CONFIG.FIREBASE_CONFIG)||null;
    if(!cfg || !global.firebase) throw new Error('Firebase 尚未啟用');
    return global.firebase.apps && global.firebase.apps.length ? global.firebase.app() : global.firebase.initializeApp(cfg);
  }
  function db(){ firebaseApp(); return global.firebase.firestore(); }
  function projectId(){ const cfg=(global.APP_CONFIG&&global.APP_CONFIG.FIREBASE_CONFIG)||{}; return clean(cfg.projectId || 'youzi-c1b74'); }
  function functionUrl(name){ return 'https://us-central1-'+projectId()+'.cloudfunctions.net/'+name; }
  async function call(name, payload){
    const res=await fetch(functionUrl(name), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload||{})});
    const text=await res.text(); let json={};
    try{ json=text?JSON.parse(text):{}; }catch(e){ json={ok:false,message:text||'回傳不是 JSON'}; }
    if(!res.ok || json.ok===false) throw new Error(json.message || json.error || ('API '+name+' '+res.status));
    return json;
  }
  async function all(collection, limit){ const snap=await db().collection(collection).limit(limit||500).get(); const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id}, doc.data()||{}))); return rows; }
  async function get(collection,id){ if(!id) return null; const doc=await db().collection(collection).doc(clean(id)).get(); return doc.exists?Object.assign({__id:doc.id},doc.data()||{}):null; }
  async function set(collection,id,data,merge=true){ await db().collection(collection).doc(clean(id)).set(data||{}, {merge}); }
  function nowText(){ const d=new Date(); return ymd(d)+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds()); }
  function contractStatus(row){ return clean(row.status || row.contractStatus || '草稿'); }
  function applicationStatus(row){ return clean(row.status || '新申請'); }
  function rentalTypeLabel(t){ t=clean(t); if(t==='digitalPiano') return '電鋼琴'; if(t==='electronicDrum') return '電子鼓'; if(t==='other') return '其他設備'; return t||'未選擇'; }
  function defaultIncludedItems(type){
    if(type==='digitalPiano') return '電鋼琴主機\n譜架\n原廠腳架\n電鋼琴電源線\n電鋼琴椅子';
    if(type==='electronicDrum') return '大鼓感應 X1\n小鼓 X1\nHIHAT X1\nHIHAT 腳踏 X1\nTOM1 X1\nTOM2 X1\n落地鼓 X1\n鈸片 1 X1\n鈸片 2 X1\n操作主機 X1\n電子鼓支架 X1\n連接線 X1\n鼓鎖 X1\n音箱 X1\n音箱導線 X1';
    return '';
  }
  function parseEquipmentItems(contract){
    contract=contract||{};
    if(Array.isArray(contract.equipmentItems) && contract.equipmentItems.length){
      return contract.equipmentItems.map(x=>({name:clean(x.name||x.equipmentName||x.title), note:clean(x.note||x.remark||x.memo)})).filter(x=>x.name||x.note);
    }
    const lines=clean(contract.includedItems).split(/\n|、|,|，/).map(clean).filter(Boolean);
    if(lines.length) return lines.map(x=>{ const parts=x.split(/\s\/\s/); return {name:clean(parts[0]), note:clean(parts.slice(1).join(' / '))}; });
    const t=clean(contract.rentalType||contract.type);
    const defaults=defaultIncludedItems(t).split(/\n/).map(clean).filter(Boolean);
    if(defaults.length) return defaults.map(x=>({name:x,note:''}));
    const n=clean(contract.equipmentName||contract.modelName||contract.itemName);
    return n?[{name:n,note:clean(contract.serialNo||contract.machineCode)}]:[];
  }
  function defaultTitle(type){ if(type==='digitalPiano') return '電鋼琴設備租賃契約書'; if(type==='electronicDrum') return '電子鼓器材設備租賃契約書'; return '設備租賃契約書'; }
  function calcEndDate(startDate, periods, type, days){ if(clean(type)==='other') return ''; return addDays(startDate, Math.max(1, Number(days || (Math.max(1, Number(periods||1))*90)))-1); }
  function signUrl(contract){
    const id=clean(contract.contractId||contract.__id); const token=clean(contract.signToken||contract.token);
    const base=location.origin+location.pathname.replace(/[^\/]*$/,'');
    return base+'rental-sign.html?contractId='+encodeURIComponent(id)+'&token='+encodeURIComponent(token);
  }
  function myContractUrl(contract){
    const id=clean(contract.contractId||contract.__id); const token=clean(contract.customerToken||contract.signToken||contract.token);
    const base=location.origin+location.pathname.replace(/[^\/]*$/,'');
    return base+'rental-my-contract.html?contractId='+encodeURIComponent(id)+'&token='+encodeURIComponent(token);
  }
  function officialContractUrl(contract){
    const id=clean(contract.contractId||contract.__id); const token=clean(contract.officialContractToken||contract.customerToken||contract.signToken||contract.token);
    const base=location.origin+location.pathname.replace(/[^\/]*$/,'');
    return base+'rental-contract.html?contractId='+encodeURIComponent(id)+'&token='+encodeURIComponent(token);
  }

  function notificationPreference(value, hasEmail){
    const v=clean(value).toLowerCase();
    if(['email','email_only','mail','email-only','只用email','只用 email','只用信箱','信箱'].includes(v)) return 'email';
    if(['line','line_only','line-only','只用line','只用 line'].includes(v)) return 'line';
    if(['both','line_email','line+email','line + email','all','雙軌','line 與 email','line和email'].includes(v)) return 'both';
    return hasEmail ? 'both' : 'line';
  }
  function notificationPreferenceLabel(value, hasEmail){
    const p=notificationPreference(value, hasEmail);
    if(p==='email') return '只用 Email';
    if(p==='line') return '只用 LINE';
    return 'LINE + Email';
  }
  function wantsLine(value, hasEmail){ const p=notificationPreference(value, hasEmail); return p==='line'||p==='both'; }
  function wantsEmail(value, hasEmail){ const p=notificationPreference(value, hasEmail); return p==='email'||p==='both'; }
  function emailVerified(row){ row=row||{}; return row.emailVerified===true || clean(row.emailLinkStatus).toLowerCase()==='verified' || clean(row.emailVerifiedAtText); }


  function isOfficialContract(contract) {
    const status = clean(contract && contract.status);
    return !!(contract && (contract.officialConfirmedAt || contract.officialContractUrl || status === '租賃中' || status === '待歸還' || status === '已退租'));
  }

  function deliveryLabelPair(contract) {
    contract = contract || {};
    const methodType = clean(contract.deliveryMethodType || contract.shippingMethodType);
    const customMethod = clean(contract.deliveryMethodOtherText || contract.shippingMethodOtherText || contract.otherDeliveryMethod || contract.otherShippingMethod);
    const rawMethod = clean(contract.deliveryMethod || contract.shippingMethod || contract.deliveryType || contract.delivery || contract.preferredDeliveryMethod);
    const method = methodType === '其他' ? (customMethod || rawMethod || '其他') : normalizeDeliveryMethod(rawMethod);
    if (method === '自取自運') {
      return {
        method,
        dateLabel: '自取時間',
        actionLabel: '自取'
      };
    }
    if (method === '到府安裝') {
      return {
        method: '到府安裝',
        dateLabel: '安裝時間',
        actionLabel: '安裝'
      };
    }
    return {
      method: method || '其他',
      dateLabel: '交付日期',
      actionLabel: '交付'
    };
  }

  function renderContractHtml(contract, opts){
    contract=contract||{}; opts=opts||{};
    const type=clean(contract.rentalType||contract.type);
    const isOtherRental=type==='other';
    const title=clean(contract.contractTitle)||defaultTitle(type);
    const partyAName=clean(contract.customerName||contract.partyAName||contract.companyName);
    const identity=clean(contract.customerIdNumber||contract.customerTaxId||contract.taxId);
    const customerAddress=clean(contract.customerAddress||contract.address);
    const customerPhone=clean(contract.customerPhone||contract.phone);
    const items=parseEquipmentItems(contract);
    const equipment=clean(contract.equipmentName||contract.modelName||contract.itemName||items[0]?.name);
    const serial=clean(contract.serialNo||contract.machineCode||items[0]?.note);
    const periods=Math.max(1, Math.min(10, Number(contract.periods||contract.rentalPeriods||1)));
    const periodDays=Math.max(1, Number(contract.periodDays||90));
    const start=clean(contract.startDate);
    const explicitRentDays=Number(contract.rentDays||contract.totalDays||0);
    const end=clean(contract.endDate)||(isOtherRental?'':calcEndDate(start, periods, type, Number(contract.rentDays||periods*periodDays)));
    const rent=fmtMoney(contract.rentFee||contract.rentalFee);
    const ship=fmtMoney(contract.shippingFee);
    const deposit=fmtMoney(contract.depositFee);
    const deliveryText=clean(contract.deliveryDate||contract.confirmedDeliveryDate||contract.deliveryDateTime||'').slice(0,10);
    const deliveryMethod=normalizeDeliveryMethod(contract.shippingMethod||contract.deliveryMethod);
    const deliveryInfo = deliveryLabelPair(contract);
    const isSelfPickup=deliveryInfo.method==='自取自運';
    const status=clean(contract.status||contract.contractStatus);
    const hasFormalData=!!(contract.customerSubmittedFormalAt || contract.customerSignatureUrl || contract.signatureUrl || contract.customerIdImageUrl || contract.idImageUrl || contract.idCardImageUrl || contract.customerSignatureDataUrl || contract.signatureDataUrl || contract.customerIdImageWatermarkedDataUrl || contract.idImageWatermarkedDataUrl || contract.customerIdImageDataUrl || contract.idImageDataUrl);
    const isOfficial=!!(opts.officialView || contract._officialPreview || hasFormalData || contract.officialPdfUrl || contract.officialConfirmedAt || contract.officialStartDate || ['租賃中','已退租','待歸還','續約詢問中','續約待付款','續約待確認'].includes(status));
    const deliveryLabel = deliveryInfo.dateLabel;
    const preliminaryNote='';
    const dateText=clean(contract.contractDate)||ymd(new Date());
    const sig=clean(contract.customerSignatureUrl || contract.signatureUrl || contract.customerSignatureDataUrl || contract.signatureDataUrl || contract.signDataUrl);
    const idImage=clean(contract.customerIdImageUrl||contract.idImageUrl||contract.idCardImageUrl||contract.customerIdImageWatermarkedDataUrl||contract.idImageWatermarkedDataUrl||contract.customerIdImageDataUrl||contract.idImageDataUrl||contract.idCardImageDataUrl);
    const otherDateRange = start && end ? `${start} 至 ${end}` : (start ? `${start} 起` : (end ? `至 ${end}` : ''));
    const otherPeriodDisplay = otherDateRange ? `${otherDateRange}（依雙方確認之租用期間為準）` : '依雙方確認之租用期間為準';
    const typeLine = type==='other'
      ? `租賃設備：${esc(equipment || '__________')}。租用期間：${esc(otherPeriodDisplay)}。`
      : `租賃${esc(rentalTypeLabel(type))}：${esc(equipment || '__________')}${serial?'　編號：'+esc(serial):''}`;
    const itemHtml = items.length ? `<ol class="equipment-list-contract equipment-list-contract--twocol">${items.map(x=>`<li>${esc(x.name)}${x.note?`<span class="eq-note-contract">（${esc(x.note)}）</span>`:''}</li>`).join('')}</ol>` : '依雙方確認設備清單';
    function periodRows(){
      const rows=[];
      const periodEntries=Array.isArray(contract.periodEntries)?contract.periodEntries:[];
      const renewalEntries=Array.isArray(contract.renewalEntries)?contract.renewalEntries:[];
      if(isOtherRental){
        const dateDays = (start && end) ? String(Math.max(1, Math.round((new Date(end+'T00:00:00')-new Date(start+'T00:00:00'))/86400000)+1))+' 天' : '';
        const explicitDaysText = explicitRentDays ? explicitRentDays+' 天' : '';
        rows.push({ method:clean(contract.rentalMethod||'其他設備租用'), start:start, end:end, days:explicitDaysText || dateDays, note:(start||end)?'依雙方確認期間':'依雙方確認之租用期間為準' });
      }else if(start){
        const totalDays=Number(contract.rentDays || contract.totalDays || (periods*periodDays));
        rows.push({ method:clean(contract.rentalMethod||'實體租用'), start:start, end:end, days:(totalDays ? totalDays+' 天' : ''), note:periods>1 ? `初次租用 ${periods} 期（${totalDays} 天）` : '初次租用' });
      }
      if(periodEntries.length){
        periodEntries.forEach(p=>{
          const ps=clean(p.startDate); const pe=clean(p.endDate);
          if(ps===start && pe===end) return;
          const pd=clean(p.days || p.rentDays || (ps && pe ? String(Math.max(1, Math.round((new Date(pe+'T00:00:00')-new Date(ps+'T00:00:00'))/86400000)+1))+' 天' : ''));
          rows.push({method:clean(p.method||p.rentalMethod||'線上續租'), start:ps, end:pe, days:pd, note:clean(p.note||p.remark)});
        });
      }
      renewalEntries.forEach((p,i)=>{
        const ps=clean(p.startDate); const pe=clean(p.endDate);
        const pd=clean(p.days || p.rentDays || (ps && pe ? String(Math.max(1, Math.round((new Date(pe+'T00:00:00')-new Date(ps+'T00:00:00'))/86400000)+1))+' 天' : ''));
        const fee=p.rentFee?`續約租金 ${fmtMoney(p.rentFee)}`:'';
        const memo=clean(p.note||p.remark);
        rows.push({method:clean(p.method||`第 ${p.renewalNo||i+1} 次續約`), start:ps, end:pe, days:pd, note:[fee,memo].filter(Boolean).join('；')});
      });
      const pending=contract.pendingRenewal||{};
      if(pending && pending.startDate && pending.endDate){
        const ps=clean(pending.startDate); const pe=clean(pending.endDate);
        const pd=clean(pending.days || pending.rentDays || (ps && pe ? String(Math.max(1, Math.round((new Date(pe+'T00:00:00')-new Date(ps+'T00:00:00'))/86400000)+1))+' 天' : ''));
        const fee=pending.rentFee?`續約金額 ${fmtMoney(pending.rentFee)}`:'';
        const memo=clean(pending.adminNote||pending.note||pending.remark);
        rows.push({method:`續約申請待確認${pending.periods?`（${clean(pending.periods)} 期）`:''}`, start:ps, end:pe, days:pd, note:[fee,'待店家確認',memo].filter(Boolean).join('；')});
      }
      while(rows.length<12) rows.push({method:'',start:'',end:'',days:'',note:''});
      return rows.slice(0,16).map(r=>`<tr><td>${esc(r.method)}</td><td>${esc(r.start)}</td><td>${esc(r.end)}</td><td>${esc(r.days)}</td><td>${esc(r.note)}</td></tr>`).join('');
    }
    const sealHtml = `<div class="official-stamps-rental"><img class="seal-company-rental" src="company_seal_contract_transparent.png" onerror="this.style.display='none'"><img class="seal-owner-rental" src="red_stamp_transparent.png" onerror="this.style.display='none'"></div>`;
    const idCardBlock = `<div class="id-card-block"><div class="id-card-title">甲方身分證資料備查</div><div class="id-card-meta">身分證字號 / 統編：${esc(identity || '客人正式填寫後顯示')}</div><div class="id-card-body">${idImage?`<img class="id-card-img" src="${esc(idImage)}" alt="身分證證明圖片">`:`<div class="id-placeholder">客人正式填寫連結上傳身分證證明後，此處會顯示加浮水印後的圖片。</div>`}</div></div>`;
    return `
      <style>
        .rental-contract-sheet{page-break-after:always;break-after:page;position:relative;overflow:hidden;background:#fff;color:#111827;width:210mm;height:297mm;min-height:297mm;margin:0 auto 10mm;padding:9mm 11mm;box-sizing:border-box;border:1px solid #d1d5db;box-shadow:0 8px 20px rgba(0,0,0,.05);font-size:12.2px;line-height:1.48}.rental-contract-sheet h1{text-align:center;font-size:21px;margin:0 0 4mm;letter-spacing:2px}.party-line{font-weight:800;margin-bottom:1.3mm;position:relative}.intro{margin:2mm 0}.clauses{padding-left:18px;margin:0}.clauses li{margin-bottom:1.15mm}.equipment-list-contract{margin:1mm 0 0 0;padding-left:18px}.equipment-list-contract--twocol{display:grid;grid-template-columns:1fr 1fr;column-gap:16mm;row-gap:.45mm;padding-left:0;list-style-position:inside}.equipment-list-contract li{margin:.25mm 0;break-inside:avoid}.eq-note-contract{color:#475569}.sign-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:8px;margin-top:3mm}.sign-card{border:1px solid #94a3b8;border-radius:12px;padding:8px;min-height:40mm;position:relative}.sign-card.party-a{min-height:43mm}.party-a-line{display:block;margin:1.4mm 0}.wide-line{display:block;margin-top:1.2mm;min-height:7mm}.sig-box{margin-top:2mm;min-height:14mm;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sig-label{font-weight:900;white-space:nowrap}.sig-img{max-width:105px;max-height:52px;object-fit:contain}.official-stamps-rental{position:relative;height:24mm;margin-top:1mm}.seal-company-rental{position:absolute;left:0;top:0;width:27mm;height:22mm;object-fit:contain}.seal-owner-rental{position:absolute;left:30mm;top:7mm;width:14mm;height:14mm;object-fit:contain}.contract-date{text-align:center;margin-top:3mm;font-weight:800}.rental-page-no{position:absolute;right:11mm;bottom:6mm;font-size:10.5px;color:#64748b}.rental-contract-sheet.period-sheet h1{text-align:center}.period-table{width:100%;border-collapse:collapse;margin-top:3mm;font-size:12px}.period-table th,.period-table td{border:1px solid #333;padding:3px;text-align:center;height:7mm}.period-table th{background:#f3f4f6}.period-bottom{position:absolute;left:11mm;right:11mm;bottom:11mm;display:grid;grid-template-columns:1.15fr .85fr;gap:8mm;align-items:end}.id-card-block{border:1px solid #94a3b8;border-radius:12px;padding:7px;min-height:42mm}.id-card-title{font-weight:950;margin-bottom:1.6mm}.id-card-meta{font-size:11.5px;margin-bottom:1.6mm}.id-card-body{height:29mm;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px}.id-card-img{max-width:100%;max-height:29mm;object-fit:contain;filter:grayscale(100%)}.id-placeholder{font-size:11.5px;color:#64748b;text-align:center;padding:3mm}.period-stamp-block{border:1px solid #94a3b8;border-radius:12px;padding:7px;min-height:42mm}.period-stamp-title{font-weight:950;margin-bottom:1.6mm}
        @media(max-width:840px){.rental-contract-sheet{width:210mm!important;height:297mm!important;min-height:297mm!important;padding:9mm 11mm!important}.sign-grid{display:grid!important;grid-template-columns:1.1fr .9fr!important}.period-bottom{position:absolute!important;left:11mm!important;right:11mm!important;bottom:11mm!important;display:grid!important;grid-template-columns:1.15fr .85fr!important}.rental-page-no{position:absolute!important;right:11mm!important;bottom:6mm!important;text-align:left!important;margin-top:0!important}}
        @media print{.rental-contract-sheet{width:210mm!important;height:297mm!important;min-height:297mm!important;border:none!important;box-shadow:none!important;margin:0!important;page-break-after:always!important;break-after:page!important}.period-bottom{position:absolute!important;left:12mm!important;right:12mm!important;bottom:12mm!important;grid-template-columns:1.15fr .85fr!important}@page{size:A4;margin:0}}
      </style>
      <div class="rental-contract-sheet">
        <h1>${esc(title)}</h1>
        <div class="party-line">立契約書人：${esc(partyAName || '__________')}（以下簡稱甲方）</div>
        <div class="party-line">立契約書人：尚品樂器行（以下簡稱乙方）</div>
        <p class="intro">甲方向乙方租賃設備，雙方同意簽訂本契約，條款如下：</p>
        <ol class="clauses">
          <li>${typeLine}</li>
          <li>租金：${esc(rent)}。押金：${esc(deposit)}。運費：${esc(ship)}。交付方式：${esc(deliveryInfo.method)}。${esc(deliveryInfo.dateLabel)}：${esc(deliveryText || '依店家最後確認')}。${preliminaryNote?`<br><b>${esc(preliminaryNote)}</b>`:''}</li>
          <li>租用設備明細：${itemHtml}</li>
          <li>退租需提早告知；未告知超過 3 天，視同原簽約方案續約。</li>
          <li>租約使用開始後，若提早退租，全數不退款。</li>
          <li>運費為一次性收費；續約租用不再次收費，特殊地區或特殊搬運另依雙方確認。</li>
          <li>因設備老舊或電腦相關線材磨損造成損壞，由乙方吸收；但因人為破壞須賠償，破壞判斷依原廠認定。</li>
          <li>續租方式：線上續租、轉帳付款，請保留相關截圖。</li>
          <li>如雙方發生有關事項之爭議或訴訟，雙方以臺中地方法院為第一審管轄法院。</li>
          <li>本契約壹式貳份，雙方各執乙份為憑；線上簽署及紙本留存具同等效力。</li>
        </ol>
        <div class="sign-grid">
          <div class="sign-card party-a"><b>甲方</b><br><span class="party-a-line">姓名 / 公司：${esc(partyAName)}</span><span class="party-a-line">身分證字號 / 統編：${esc(identity)}</span><span class="wide-line">地址：${esc(customerAddress)}</span><span class="party-a-line">電話：${esc(customerPhone)}</span><div class="sig-box"><span class="sig-label">甲方簽名：</span>${sig?`<img src="${esc(sig)}" class="sig-img" alt="甲方簽名">`:'<span class="sig-empty">尚未簽名</span>'}</div></div>
          <div class="sign-card"><b>乙方</b><br>公司名稱：尚品樂器行<br>負責人：黃銘廷<br>地址：台中市豐原區圓環東路 347 號 4 樓<br>電話：04-2522-7893<br>統一編號：99680937<br>${sealHtml}</div>
        </div>
        <div class="contract-date">中華民國 ${esc(dateText)}</div><div class="rental-page-no">第 1 頁 / 共 2 頁</div>
      </div>
      <div class="rental-contract-sheet period-sheet">
        <h1>租賃期間明細表</h1>
        <div class="party-line">契約名稱：${esc(title)}</div>
        <div class="party-line">租賃設備：${esc(equipment || '__________')}</div>
        <table class="period-table"><thead><tr><th style="width:26%">租用方式</th><th>起租日</th><th>到期日</th><th style="width:72px">天數</th><th>備註</th></tr></thead><tbody>${periodRows()}</tbody></table>
        <div class="period-bottom"><div>${idCardBlock}</div><div class="period-stamp-block"><div class="period-stamp-title">乙方簽章</div>${sealHtml}</div></div>
        <div class="contract-date">中華民國 ${esc(dateText)}</div><div class="rental-page-no">第 2 頁 / 共 2 頁</div>
      </div>`;
  }
  Object.assign(Rental,{clean,num,ymd,rocDate,addDays,fmtMoney,normalizeDeliveryMethod,esc,qs,val,checked,setVal,show,hide,toast,user,isManager,requireManager,db,call,all,get,set,nowText,contractStatus,applicationStatus,rentalTypeLabel,defaultIncludedItems,parseEquipmentItems,defaultTitle,calcEndDate,signUrl,myContractUrl,officialContractUrl,renderContractHtml,deliveryLabelPair,functionUrl,notificationPreference,notificationPreferenceLabel,wantsLine,wantsEmail,emailVerified});
  global.YZRental = Rental;
})(window);
