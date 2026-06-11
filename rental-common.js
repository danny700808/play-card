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
  function calcEndDate(startDate, periods, type, days){ return addDays(startDate, Math.max(1, Number(days || (Math.max(1, Number(periods||1))*90)))-1); }
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
  function renderContractHtml(contract, opts){
    contract=contract||{}; opts=opts||{};
    const type=clean(contract.rentalType||contract.type);
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
    const end=clean(contract.endDate)||calcEndDate(start, periods, type, Number(contract.rentDays||periods*periodDays));
    const rent=fmtMoney(contract.rentFee||contract.rentalFee);
    const ship=fmtMoney(contract.shippingFee);
    const deposit=fmtMoney(contract.depositFee);
    const deliveryText=clean(contract.deliveryDateTime)||[clean(contract.deliveryDate), clean(contract.deliveryTime)].filter(Boolean).join(' ');
    const dateText=clean(contract.contractDate)||ymd(new Date());
    const sig=clean(contract.customerSignatureDataUrl || contract.signatureDataUrl);
    const idImage=clean(contract.customerIdImageWatermarkedDataUrl||contract.idImageWatermarkedDataUrl||contract.customerIdImageDataUrl||contract.idImageDataUrl||contract.idCardImageDataUrl||contract.customerIdImageUrl||contract.idImageUrl);
    const typeLine = type==='other'
      ? `租賃設備：${esc(equipment || '__________')}`
      : `租賃${esc(rentalTypeLabel(type))}：${esc(equipment || '__________')}${serial?'　編號：'+esc(serial):''}`;
    const itemHtml = items.length ? `<ol class="equipment-list-contract">${items.map(x=>`<li>${esc(x.name)}${x.note?`<span class="eq-note-contract">（${esc(x.note)}）</span>`:''}</li>`).join('')}</ol>` : '依雙方確認設備清單';
    function periodRows(){
      const rows=[];
      let s=start;
      const periodEntries=Array.isArray(contract.periodEntries)?contract.periodEntries:[];
      if(periodEntries.length){
        periodEntries.forEach(p=>rows.push({method:clean(p.method||p.rentalMethod||'線上續租'), start:clean(p.startDate), end:clean(p.endDate), days:clean(p.days||periodDays), note:clean(p.note||p.remark)}));
      }else if(s){
        for(let i=1;i<=periods;i++){
          const e=addDays(s, periodDays-1);
          rows.push({method:i===1?clean(contract.rentalMethod||'實體租用'):'線上續租', start:s, end:e, days:periodDays+' 天', note:i===1?'初次租用':''});
          s=addDays(e,1);
        }
      }
      while(rows.length<12) rows.push({method:'',start:'',end:'',days:'',note:''});
      return rows.slice(0,16).map(r=>`<tr><td>${esc(r.method)}</td><td>${esc(r.start)}</td><td>${esc(r.end)}</td><td>${esc(r.days)}</td><td>${esc(r.note)}</td></tr>`).join('');
    }
    const sealHtml = `<div class="official-stamps-rental"><img class="seal-company-rental" src="company_seal_contract_transparent.png" onerror="this.style.display='none'"><img class="seal-owner-rental" src="red_stamp_transparent.png" onerror="this.style.display='none'"></div>`;
    const idCardBlock = `<div class="id-card-block"><div class="id-card-title">身分證資料備查</div><div class="id-card-meta">身分證字號 / 統編：${esc(identity || '客人正式填寫後顯示')}</div><div class="id-card-body">${idImage?`<img class="id-card-img" src="${esc(idImage)}" alt="身分證證明圖片">`:`<div class="id-placeholder">客人正式填寫連結上傳身分證證明後，此處會顯示加浮水印後的圖片。</div>`}</div></div>`;
    return `
      <style>
        .rental-contract-sheet{page-break-after:always;break-after:page;position:relative;overflow:hidden;background:#fff;color:#111827;width:210mm;min-height:297mm;margin:0 auto 10mm;padding:11mm 12mm;box-sizing:border-box;border:1px solid #d1d5db;box-shadow:0 8px 20px rgba(0,0,0,.05);font-size:13.5px;line-height:1.75}.rental-contract-sheet h1{text-align:center;font-size:24px;margin:0 0 6mm;letter-spacing:2px}.party-line{font-weight:800;margin-bottom:2mm;position:relative}.intro{margin:3mm 0}.clauses{padding-left:20px;margin:0}.clauses li{margin-bottom:2.4mm}.equipment-list-contract{margin:2mm 0 0 0;padding-left:20px}.equipment-list-contract li{margin:1mm 0}.eq-note-contract{color:#475569}.sign-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:10px;margin-top:5mm}.sign-card{border:1px solid #94a3b8;border-radius:12px;padding:11px;min-height:49mm;position:relative}.sign-card.party-a{min-height:54mm}.party-a-line{display:block;margin:3mm 0}.wide-line{display:block;margin-top:2mm;min-height:11mm}.sig-box{margin-top:4mm;border-top:1px solid #64748b;padding-top:2mm;min-height:20mm}.sig-img{max-width:100%;max-height:80px}.official-stamps-rental{position:relative;height:32mm;margin-top:2mm}.seal-company-rental{position:absolute;left:0;top:0;width:34mm;height:27mm;object-fit:contain}.seal-owner-rental{position:absolute;left:37mm;top:10mm;width:16mm;height:16mm;object-fit:contain}.contract-date{text-align:center;margin-top:5mm;font-weight:800}.rental-page-no{position:absolute;right:12mm;bottom:7mm;font-size:11px;color:#64748b}.rental-contract-sheet.period-sheet h1{text-align:center}.period-table{width:100%;border-collapse:collapse;margin-top:4mm;font-size:12.5px}.period-table th,.period-table td{border:1px solid #333;padding:5px;text-align:center;height:8mm}.period-table th{background:#f3f4f6}.period-bottom{position:absolute;left:12mm;right:12mm;bottom:12mm;display:grid;grid-template-columns:1.15fr .85fr;gap:10mm;align-items:end}.id-card-block{border:1px solid #94a3b8;border-radius:12px;padding:8px;min-height:45mm}.id-card-title{font-weight:950;margin-bottom:2mm}.id-card-meta{font-size:12px;margin-bottom:2mm}.id-card-body{height:31mm;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px}.id-card-img{max-width:100%;max-height:31mm;object-fit:contain;filter:grayscale(100%)}.id-placeholder{font-size:12px;color:#64748b;text-align:center;padding:4mm}.period-stamp-block{border:1px solid #94a3b8;border-radius:12px;padding:8px;min-height:45mm}.period-stamp-title{font-weight:950;margin-bottom:2mm}
        @media(max-width:840px){.rental-contract-sheet{width:100%;min-height:auto;padding:16px}.sign-grid,.period-bottom{grid-template-columns:1fr;position:static}.rental-page-no{position:static;text-align:right;margin-top:8px}}
        @media print{.rental-contract-sheet{width:210mm!important;min-height:297mm!important;border:none!important;box-shadow:none!important;margin:0!important;page-break-after:always!important;break-after:page!important}.period-bottom{position:absolute!important;left:12mm!important;right:12mm!important;bottom:12mm!important;grid-template-columns:1.15fr .85fr!important}@page{size:A4;margin:0}}
      </style>
      <div class="rental-contract-sheet">
        <h1>${esc(title)}</h1>
        <div class="party-line">立契約書人：${esc(partyAName || '__________')}（以下簡稱甲方）</div>
        <div class="party-line">立契約書人：尚品樂器行（以下簡稱乙方）</div>
        <p class="intro">甲方向乙方租賃設備，雙方同意簽訂本契約，條款如下：</p>
        <ol class="clauses">
          <li>${typeLine}<br>租賃期間：詳如第二頁「租賃期間明細表」。一期固定 ${esc(periodDays)} 天，續租起日為上一期到期日之隔日。</li>
          <li>租金：${esc(rent)}。押金：${esc(deposit)}。運費：${esc(ship)}。運送方式：${esc(contract.shippingMethod||'依雙方確認')}。配送 / 安裝時間：${esc(deliveryText || '依店家最後確認')}。</li>
          <li>乙方提供設備包括：${itemHtml}</li>
          <li>退租需提早告知；未告知超過 3 天，視同原簽約方案續約。</li>
          <li>租約使用開始後，若提早退租，全數不退款。</li>
          <li>運費為一次性收費；續約租用不再次收費，特殊地區或特殊搬運另依雙方確認。</li>
          <li>因設備老舊或電腦相關線材磨損造成損壞，由乙方吸收；但因人為破壞須賠償，破壞判斷依原廠認定。</li>
          <li>續租方式：線上續租、轉帳付款，請保留相關截圖。</li>
          <li>如雙方發生有關事項之爭議或訴訟，雙方以臺中地方法院為第一審管轄法院。</li>
          <li>本契約壹式貳份，雙方各執乙份為憑；線上簽署及 PDF 留存具同等效力。</li>
        </ol>
        <div class="sign-grid">
          <div class="sign-card party-a"><b>甲方</b><br><span class="party-a-line">姓名 / 公司：${esc(partyAName)}</span><span class="party-a-line">身分證字號 / 統編：${esc(identity)}</span><span class="wide-line">地址：${esc(customerAddress)}</span><span class="party-a-line">電話：${esc(customerPhone)}</span><div class="sig-box">${sig?`<img src="${esc(sig)}" class="sig-img">`:'甲方簽名：____________________________'}</div></div>
          <div class="sign-card"><b>乙方</b><br>公司名稱：尚品樂器行<br>負責人：黃銘廷<br>地址：台中市豐原區圓環東路 347 號 4 樓<br>電話：04-2522-7893<br>統一編號：99680937<br>${sealHtml}</div>
        </div>
        <div class="contract-date">中華民國 ${esc(dateText)}</div><div class="rental-page-no">第 1 頁 / 共 2 頁</div>
      </div>
      <div class="rental-contract-sheet period-sheet">
        <h1>租賃期間明細表</h1>
        <div class="party-line">契約名稱：${esc(title)}</div>
        <div class="party-line">租賃設備：${esc(equipment || '__________')}</div>
        <div class="party-line">正式起租日：${esc(start || '____年__月__日')}　目前到期日：${esc(end || '____年__月__日')}　一期：${esc(periodDays)} 天</div>
        <table class="period-table"><thead><tr><th style="width:26%">租用方式</th><th>起租日</th><th>到期日</th><th style="width:72px">天數</th><th>備註</th></tr></thead><tbody>${periodRows()}</tbody></table>
        <div class="period-bottom"><div>${idCardBlock}</div><div class="period-stamp-block"><div class="period-stamp-title">乙方備查章</div>${sealHtml}</div></div>
        <div class="contract-date">中華民國 ${esc(dateText)}</div><div class="rental-page-no">第 2 頁 / 共 2 頁</div>
      </div>`;
  }
  Object.assign(Rental,{clean,num,ymd,rocDate,addDays,fmtMoney,esc,qs,val,checked,setVal,show,hide,toast,user,isManager,requireManager,db,call,all,get,set,nowText,contractStatus,applicationStatus,rentalTypeLabel,defaultIncludedItems,parseEquipmentItems,defaultTitle,calcEndDate,signUrl,myContractUrl,renderContractHtml,functionUrl});
  global.YZRental = Rental;
})(window);
