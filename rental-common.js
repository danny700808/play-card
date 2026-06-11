(function(global){
  'use strict';
  const Rental = {};
  function clean(v){ return String(v == null ? '' : v).trim(); }
  function num(v){ const n=Number(String(v==null?'':v).replace(/[^0-9.-]/g,'')); return Number.isFinite(n)?n:0; }
  function pad(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ if(!(d instanceof Date)) d=new Date(d); if(isNaN(d.getTime())) return ''; return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function addDays(dateText, days){ const d=new Date(clean(dateText)+'T00:00:00'); if(isNaN(d.getTime())) return ''; d.setDate(d.getDate()+Number(days||0)); return ymd(d); }
  function fmtMoney(v){ const n=num(v); return n ? n.toLocaleString('zh-TW')+' 元' : '0 元'; }
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
  function firebaseApp(){ const cfg=(global.APP_CONFIG&&global.APP_CONFIG.FIREBASE_CONFIG)||null; if(!cfg || !global.firebase) throw new Error('Firebase 尚未啟用'); return global.firebase.apps && global.firebase.apps.length ? global.firebase.app() : global.firebase.initializeApp(cfg); }
  function db(){ firebaseApp(); return global.firebase.firestore(); }
  function projectId(){ const cfg=(global.APP_CONFIG&&global.APP_CONFIG.FIREBASE_CONFIG)||{}; return clean(cfg.projectId || 'youzi-c1b74'); }
  function functionUrl(name){ return 'https://us-central1-'+projectId()+'.cloudfunctions.net/'+name; }
  async function call(name, payload){ const res=await fetch(functionUrl(name), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload||{})}); const text=await res.text(); let json={}; try{ json=text?JSON.parse(text):{}; }catch(e){ json={ok:false,message:text||'回傳不是 JSON'}; } if(!res.ok || json.ok===false) throw new Error(json.message || json.error || ('API '+name+' '+res.status)); return json; }
  async function all(collection, limit){ const snap=await db().collection(collection).limit(limit||500).get(); const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id}, doc.data()||{}))); return rows; }
  async function get(collection,id){ if(!id) return null; const doc=await db().collection(collection).doc(clean(id)).get(); return doc.exists?Object.assign({__id:doc.id},doc.data()||{}):null; }
  async function set(collection,id,data,merge=true){ await db().collection(collection).doc(clean(id)).set(data||{}, {merge}); }
  function nowText(){ const d=new Date(); return ymd(d)+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds()); }
  function contractStatus(row){ return clean(row.status || row.contractStatus || '草稿'); }
  function applicationStatus(row){ return clean(row.status || '待店家確認'); }
  function rentalTypeLabel(t){ t=clean(t); if(t==='digitalPiano') return '電鋼琴'; if(t==='electronicDrum') return '電子鼓'; if(t==='other') return '其他設備'; return t||'未選擇'; }
  function defaultIncludedItems(type){ if(type==='digitalPiano') return '電鋼琴主機 / 依實際出貨內容填寫\n琴椅 / 依實際出貨內容填寫'; if(type==='electronicDrum') return '電子鼓主機與支架 / 依實際出貨內容填寫\n音箱與線材 / 依實際出貨內容填寫'; return ''; }
  function defaultTitle(type){ if(type==='digitalPiano') return '電鋼琴設備租賃契約書'; if(type==='electronicDrum') return '電子鼓器材設備租賃契約書'; return '設備租賃契約書'; }
  function calcEndDate(startDate, periods, type, days){ const n=Math.max(1, Number(days || (Number(periods||1)*90) || 90)); return addDays(startDate, n-1); }
  function signUrl(contract){ const id=clean(contract.contractId||contract.__id); const token=clean(contract.signToken||contract.token); const base=location.origin+location.pathname.replace(/[^\/]*$/,''); return base+'rental-sign.html?contractId='+encodeURIComponent(id)+'&token='+encodeURIComponent(token); }
  function myContractUrl(contract){ const id=clean(contract.contractId||contract.__id); const token=clean(contract.customerToken||contract.signToken||contract.token); const base=location.origin+location.pathname.replace(/[^\/]*$/,''); return base+'rental-my-contract.html?contractId='+encodeURIComponent(id)+'&token='+encodeURIComponent(token); }
  function parseEquipmentItems(contract){
    if(Array.isArray(contract.equipmentItems) && contract.equipmentItems.length) return contract.equipmentItems.map(x=>({name:clean(x.name||x.equipmentName), note:clean(x.note||x.remark)})).filter(x=>x.name||x.note);
    const text=clean(contract.includedItems||contract.equipmentList);
    if(text) return text.split(/\n+/).map(line=>{ const parts=line.split(/\s*\/\s*/); return {name:clean(parts[0]), note:clean(parts.slice(1).join(' / '))}; }).filter(x=>x.name||x.note);
    const first=clean(contract.equipmentName||contract.modelName||contract.itemName);
    return first?[{name:first,note:clean(contract.serialNo||contract.machineCode)}]:[];
  }
  function equipmentText(contract){ const items=parseEquipmentItems(contract); if(!items.length) return '依正式租賃資料填寫'; return items.map((x,i)=>`${i+1}. ${esc(x.name || '設備')}${x.note?' / '+esc(x.note):''}`).join('<br>'); }
  function buildPeriodRows(contract){
    let rows=[];
    if(Array.isArray(contract.periodRecords) && contract.periodRecords.length){
      rows=contract.periodRecords.map(x=>({method:clean(x.method||x.rentalMethod||'線上續租'),start:clean(x.startDate),end:clean(x.endDate),days:clean(x.days||x.periodDays||''),note:clean(x.note||x.remark||'')}));
    }else{
      const start=clean(contract.startDate); const periods=Math.max(1,Math.min(10,Number(contract.periods||contract.rentalPeriods||1))); const days=periods*90; const end=clean(contract.endDate)||calcEndDate(start,periods,contract.rentalType,days);
      rows.push({method:clean(contract.rentalMethod||'實體租用'),start,end,days: start&&end ? String(days) : '',note: periods>1?`一次確認 ${periods} 期，每期 90 天`:''});
    }
    while(rows.length<14) rows.push({method:'',start:'',end:'',days:'',note:''});
    return rows.slice(0,18).map(x=>`<tr><td>${esc(x.method)}</td><td>${esc(x.start||'　年　月　日')}</td><td>${esc(x.end||'　年　月　日')}</td><td>${esc(x.days)}</td><td>${esc(x.note)}</td></tr>`).join('');
  }
  function renderContractHtml(contract, opts){
    contract=contract||{}; opts=opts||{};
    const type=clean(contract.rentalType||contract.type);
    const title=clean(contract.contractTitle)||defaultTitle(type);
    const partyAName=clean(contract.customerName||contract.partyAName||contract.companyName);
    const identity=clean(contract.customerIdNumber||contract.customerTaxId||contract.taxId);
    const customerAddress=clean(contract.customerAddress||contract.address);
    const customerPhone=clean(contract.customerPhone||contract.phone);
    const equipment=clean(contract.equipmentName||contract.modelName||contract.itemName);
    const serial=clean(contract.serialNo||contract.machineCode);
    const periods=Math.max(1, Math.min(10, Number(contract.periods||contract.rentalPeriods||1)));
    const start=clean(contract.startDate);
    const end=clean(contract.endDate)||calcEndDate(start,periods,type,periods*90);
    const rent=fmtMoney(contract.rentFee||contract.rentalFee);
    const ship=fmtMoney(contract.shippingFee);
    const dateText=clean(contract.contractDate)||ymd(new Date());
    const sig=clean(contract.customerSignatureDataUrl || contract.signatureDataUrl);
    const typeLine = type==='other' ? `租賃設備：${esc(equipment || '__________')}` : `租賃${esc(rentalTypeLabel(type))}品牌 / 型號：${esc(equipment || '__________')}　機碼編號：${esc(serial || '__________')}`;
    const sealHtml = `<div class="official-stamps-rental"><img class="seal-company-rental" src="company_seal_contract_transparent.png" onerror="this.style.display='none'"><img class="seal-owner-rental" src="red_stamp_transparent.png" onerror="this.style.display='none'"></div>`;
    return `
      <style>
        .rental-contract-sheet{page-break-after:always;break-after:page;position:relative;overflow:hidden;background:#fff;color:#111827;width:210mm;min-height:297mm;margin:0 auto 16px;padding:12mm;box-sizing:border-box;border:1px solid #d1d5db;box-shadow:0 8px 20px rgba(0,0,0,.05);font-size:14px;line-height:1.85}.rental-contract-sheet h1{text-align:center;font-size:25px;margin:0 0 6mm;letter-spacing:2px}.party-line{font-weight:800;margin-bottom:3mm;position:relative}.clauses{padding-left:22px}.clauses li{margin-bottom:2.6mm}.sign-grid{display:grid;grid-template-columns:1.18fr .92fr;gap:12px;margin-top:6mm}.sign-card{border:1px solid #94a3b8;border-radius:12px;padding:12px;min-height:58mm}.sig-box{margin-top:12px;border-top:1px solid #64748b;padding-top:6px;min-height:32mm}.sig-img{max-width:100%;max-height:100px}.contract-date{text-align:center;margin-top:8mm;font-weight:800}.period-table{width:100%;border-collapse:collapse;margin-top:8mm;font-size:13px}.period-table th,.period-table td{border:1px solid #333;padding:7px;text-align:center;height:32px}.period-table th{background:#f3f4f6}.official-stamps-rental{position:relative;height:34mm;margin-top:4mm}.seal-company-rental{position:absolute;left:0;top:0;width:34mm;height:28mm;object-fit:contain}.seal-owner-rental{position:absolute;left:38mm;top:12mm;width:16mm;height:16mm;object-fit:contain}.rental-page-no{position:absolute;right:12mm;bottom:8mm;font-size:11px;color:#64748b}@media print{.rental-contract-sheet{width:210mm!important;min-height:297mm!important;border:none!important;box-shadow:none!important;margin:0!important;page-break-after:always!important;break-after:page!important}}
      </style>
      <div class="rental-contract-sheet">
        <h1>${esc(title)}</h1>
        <div class="party-line">立契約書人：${esc(partyAName || '__________')}（以下簡稱甲方）</div>
        <div class="party-line">立契約書人：尚品樂器行（以下簡稱乙方）</div>
        <p class="intro">甲方向乙方租賃設備，雙方同意簽訂本契約，條款如下：</p>
        <ol class="clauses">
          <li>${typeLine}<br>租賃期間：詳如第二頁「租賃期間明細表」。一期固定 90 天，續租起日為上一筆租賃到期日之隔日。<br>租賃租金費用：${esc(rent)}。</li>
          <li>運費：${esc(ship)}。運送方式：${esc(contract.shippingMethod||'依雙方確認')}。</li>
          <li>乙方提供設備包括：<br>${equipmentText(contract)}</li>
          <li>退租需提早告知；未告知超過 3 天，視同原簽約方案續約。</li>
          <li>租約使用開始後，若提早退租，全數不退款。</li>
          <li>運費為一次性收費；續約租用不再次收費，特殊地區或特殊搬運另依雙方確認。</li>
          <li>因設備老舊或線材磨損造成損壞，由乙方吸收；但因人為破壞須賠償，破壞判斷依原廠認定。</li>
          <li>續租方式：線上續租、轉帳付款，請保留相關截圖。</li>
          <li>如雙方發生有關事項之爭議或訴訟，雙方以臺中地方法院為第一審管轄法院。</li>
          <li>本契約壹式貳份，雙方各執乙份為憑；線上簽署及 PDF 留存具同等效力。</li>
        </ol>
        <div class="sign-grid"><div class="sign-card"><b>甲方</b><br>姓名 / 公司：${esc(partyAName)}<br>身分證字號 / 統編：${esc(identity)}<br>地址：${esc(customerAddress)}<br>電話：${esc(customerPhone)}<br><div class="sig-box">${sig?`<img src="${sig}" class="sig-img">`:'簽名：____________________________'}</div></div><div class="sign-card"><b>乙方</b><br>公司名稱：尚品樂器行<br>負責人：黃銘廷<br>地址：台中市豐原區圓環東路 347 號 4 樓<br>電話：04-2522-7893<br>統一編號：99680937<br>${sealHtml}</div></div>
        <div class="contract-date">中華民國 ${esc(dateText)}</div><div class="rental-page-no">第 1 頁 / 共 2 頁</div>
      </div>
      <div class="rental-contract-sheet period-sheet"><h1>租賃期間明細表</h1><div class="party-line">契約名稱：${esc(title)}</div><div class="party-line">承租人：${esc(partyAName || '__________')}　設備：${esc(equipment || '__________')}</div><div class="party-line">起租日：${esc(start || '____年__月__日')}　目前到期日：${esc(end || '____年__月__日')}　一期：90 天</div><table class="period-table"><thead><tr><th style="width:120px">租用方式</th><th>起租日</th><th>到期日</th><th style="width:80px">天數</th><th>備註</th></tr></thead><tbody>${buildPeriodRows(contract)}</tbody></table><div class="contract-date">中華民國 ${esc(dateText)}</div><div class="rental-page-no">第 2 頁 / 共 2 頁</div></div>`;
  }
  Rental.clean=clean; Rental.num=num; Rental.ymd=ymd; Rental.addDays=addDays; Rental.fmtMoney=fmtMoney; Rental.esc=esc; Rental.qs=qs; Rental.val=val; Rental.checked=checked; Rental.setVal=setVal; Rental.show=show; Rental.hide=hide; Rental.toast=toast; Rental.user=user; Rental.isManager=isManager; Rental.requireManager=requireManager; Rental.db=db; Rental.call=call; Rental.all=all; Rental.get=get; Rental.set=set; Rental.nowText=nowText; Rental.contractStatus=contractStatus; Rental.applicationStatus=applicationStatus; Rental.rentalTypeLabel=rentalTypeLabel; Rental.defaultIncludedItems=defaultIncludedItems; Rental.defaultTitle=defaultTitle; Rental.calcEndDate=calcEndDate; Rental.signUrl=signUrl; Rental.myContractUrl=myContractUrl; Rental.renderContractHtml=renderContractHtml; Rental.functionUrl=functionUrl; Rental.parseEquipmentItems=parseEquipmentItems;
  global.YZRental = Rental;
})(window);
