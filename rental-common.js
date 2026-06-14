(function(global){
  'use strict';
  const Rental = {};
  const templateCache = {};

  const FALLBACK_TEMPLATES = {
    piano:{title:'電鋼琴設備租賃契約書',periodDays:90,companyName:'尚品樂器行',ownerName:'黃銘廷',companyAddress:'台中市豐原區圓環東路347號4樓',companyPhone:'04-25227893',taxId:'99680937',equipmentList:'電鋼琴主機\n譜架\n原廠腳架\n電鋼琴電源線\n電鋼琴椅子',clauses:'退租需提早告知，未告知超過 3 天視同原簽約方案續約。\n租約使用開始後，提早退租，全數不退款。\n運費為一次性收費，續約租用不再次收費。\n因設備老舊或線材磨損造成損壞由乙方吸收；但因人為破壞，例如琴架斷裂、鍵盤進入液體、椅腳斷裂或惡意破壞，須依原廠認定賠償。\n續租方式為線上續租、轉帳付款，請保留相關截圖。\n如雙方發生有關事項之爭議或訴訟，雙方以臺中地方法院為第一審管轄法院。\n本契約壹式貳份，雙方各執乙份為憑。',sampleRent:'',sampleShipping:'',sampleDeposit:'',shippingRules:'自載免運費，不含搬運（需要休旅車）。山區或特殊地點需加價。透天 3 樓 +200 元，4 樓～5 樓 +400 元。',rentalRules:'客人先送出租用基本資料，店家確認設備、金額與日期後，再提供正式填寫 / 簽署連結。正式租用須完成 LINE 聯繫、身分證資料與付款確認後成立。',lineBindText:'送出租賃申請後，請加入柚子樂器官方 LINE 並貼上系統產生的租賃申請文字，以利店家快速對應申請資料。',footerNote:''},
    drum:{title:'電子鼓器材設備租賃契約書',periodDays:90,companyName:'尚品樂器行',ownerName:'黃銘廷',companyAddress:'台中市豐原區圓環東路347號4樓',companyPhone:'04-25227893',taxId:'99680937',equipmentList:'大鼓感應 X1\n小鼓 X1\nHIHAT X1\nHIHAT 腳踏 X1\nTOM1 X1\nTOM2 X1\n落地鼓 X1\n鈸片 1 X1\n鈸片 2 X1\n操作主機 X1\n電子鼓支架 X1\n連接線 X1\n鼓鎖 X1\n音箱 X1\n音箱導線 X1',clauses:'退租需提早告知，未告知超過 3 天視同原簽約方案續約。\n租約使用開始後，提早退租，全數不退款。\n因設備老舊或線材磨損造成損壞由乙方吸收；但因人為破壞，例如鼓架斷裂、打點網割傷或惡意破壞，須依原廠認定賠償。\n如雙方發生有關事項之爭議或訴訟，雙方以臺中地方法院為第一審管轄法院。\n本契約壹式貳份，雙方各執乙份為憑。',sampleRent:'',sampleShipping:'',sampleDeposit:'',shippingRules:'自載免運費，不含搬運（需要休旅車）。山區或特殊地點需加價。透天 3 樓 +200 元，4 樓～5 樓 +400 元。',rentalRules:'客人先送出租用基本資料，店家確認設備、金額與日期後，再提供正式填寫 / 簽署連結。正式租用須完成 LINE 聯繫、身分證資料與付款確認後成立。',lineBindText:'送出租賃申請後，請加入柚子樂器官方 LINE 並貼上系統產生的租賃申請文字，以利店家快速對應申請資料。',footerNote:''},
    other:{title:'設備租賃契約書',periodDays:90,companyName:'尚品樂器行',ownerName:'黃銘廷',companyAddress:'台中市豐原區圓環東路347號4樓',companyPhone:'04-25227893',taxId:'99680937',equipmentList:'',clauses:'租約使用開始後，全數不退款。\n因設備老舊或線材磨損造成損壞由乙方吸收；但因人為破壞須依原廠認定賠償。\n如雙方發生有關事項之爭議或訴訟，雙方以臺中地方法院為第一審管轄法院。\n本契約壹式貳份，雙方各執乙份為憑。',sampleRent:'',sampleShipping:'',sampleDeposit:'',shippingRules:'自載免運費，不含搬運（需要休旅車）。山區或特殊地點需加價。透天 3 樓 +200 元，4 樓～5 樓 +400 元。',rentalRules:'客人先送出租用基本資料，店家確認設備、金額與日期後，再提供正式填寫 / 簽署連結。正式租用須完成 LINE 聯繫、身分證資料與付款確認後成立。',lineBindText:'送出租賃申請後，請加入柚子樂器官方 LINE 並貼上系統產生的租賃申請文字，以利店家快速對應申請資料。',footerNote:''}
  };

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){ const s=lower(v); return v===true || ['是','yes','true','1','啟用','enabled','active','已啟用'].includes(s); }
  function num(v){ const n=Number(String(v==null?'':v).replace(/[^0-9.-]/g,'')); return Number.isFinite(n)?n:0; }
  function pad(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ if(!(d instanceof Date)) d=new Date(d); if(isNaN(d.getTime())) return ''; return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function hms(d){ d=d instanceof Date?d:new Date(); return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds()); }
  function rocDate(dateText){ const d=new Date(clean(dateText)+'T00:00:00'); if(isNaN(d.getTime())) return clean(dateText)||'　年　月　日'; return `民國 ${d.getFullYear()-1911} 年 ${d.getMonth()+1} 月 ${d.getDate()} 日`; }
  function addDays(dateText, days){ const d=new Date(clean(dateText)+'T00:00:00'); if(isNaN(d.getTime())) return ''; d.setDate(d.getDate()+Number(days||0)); return ymd(d); }
  function fmtMoney(v){ const n=num(v); return n ? n.toLocaleString('zh-TW')+' 元' : '0 元'; }
  function normalizeDeliveryMethod(v){
    v=clean(v);
    if(!v) return '到府安裝';
    if(v.includes('自取') || v.includes('自載') || v.includes('店取') || v.includes('自己運送')) return '自取自載';
    return '到府安裝';
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
  function isManager(u=user()){ const role=clean(u.role).toLowerCase(); return !!(u && (u.showSettingsZone || u.canViewSettings || u.isManagerAccount || role==='admin' || role==='manager' || role==='主管' || role==='管理者')); }
  function requireManager(){ const u=user(); if(!u || !clean(u.id||u.employeeId||u.email)){ location.href='index.html'; return null; } if(!isManager(u)){ location.href='dashboard.html'; return null; } return u; }
  function firebaseApp(){
    const cfg=(global.APP_CONFIG&&global.APP_CONFIG.FIREBASE_CONFIG)||null;
    if(!cfg || !global.firebase) throw new Error('Firebase 尚未啟用');
    return global.firebase.apps && global.firebase.apps.length ? global.firebase.app() : global.firebase.initializeApp(cfg);
  }
  function db(){ firebaseApp(); return global.firebase.firestore(); }
  function projectId(){ const cfg=(global.APP_CONFIG&&global.APP_CONFIG.FIREBASE_CONFIG)||{}; return clean(cfg.projectId || 'youzi-c1b74'); }
  function functionUrl(name){ return 'https://us-central1-'+projectId()+'.cloudfunctions.net/'+name; }
  function serverTs(){ try{ return global.firebase.firestore.FieldValue.serverTimestamp(); }catch(e){ return new Date().toISOString(); } }
  function arrayUnion(v){ try{ return global.firebase.firestore.FieldValue.arrayUnion(v); }catch(e){ return [v]; } }
  function nowText(){ const d=new Date(); return ymd(d)+' '+hms(d); }
  async function all(collection, limit){ const snap=await db().collection(collection).limit(limit||500).get(); const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id}, doc.data()||{}))); return rows; }
  async function get(collection,id){ if(!id) return null; const doc=await db().collection(collection).doc(clean(id)).get(); return doc.exists?Object.assign({__id:doc.id},doc.data()||{}):null; }
  async function set(collection,id,data,merge=true){ await db().collection(collection).doc(clean(id)).set(data||{}, {merge}); }

  function templateDocId(type){
    type=clean(type);
    if(type==='digitalPiano' || type==='piano' || type==='電鋼琴') return 'piano';
    if(type==='electronicDrum' || type==='drum' || type==='電子鼓') return 'drum';
    return 'other';
  }
  function rentalTypeFromDocId(docId){ if(docId==='piano') return 'digitalPiano'; if(docId==='drum') return 'electronicDrum'; return 'other'; }
  function fallbackTemplate(type){ const id=templateDocId(type); return Object.assign({type:id}, FALLBACK_TEMPLATES[id] || FALLBACK_TEMPLATES.other); }
  function normalizeTemplate(row, type){
    const id=templateDocId(type || row && row.type);
    const base=fallbackTemplate(id);
    const out=Object.assign({}, base, row||{}, {type:id});
    out.periodDays=Math.max(1, Number(out.periodDays || base.periodDays || 90));
    return out;
  }
  async function loadTemplateSettings(type, force){
    const id=templateDocId(type);
    if(!force && templateCache[id]) return templateCache[id];
    let row=null;
    try{ row=await get('rentalTemplateSettings', id); }catch(e){ row=null; }
    templateCache[id]=normalizeTemplate(row||{}, id);
    try{ localStorage.setItem('YZ_RENTAL_TEMPLATE_'+id, JSON.stringify(templateCache[id])); }catch(_e){}
    return templateCache[id];
  }
  async function preloadRentalTemplates(force){ return await Promise.all(['piano','drum','other'].map(t=>loadTemplateSettings(t, force).catch(()=>fallbackTemplate(t)))); }
  function cachedTemplate(type){
    const id=templateDocId(type);
    if(templateCache[id]) return templateCache[id];
    try{ const raw=localStorage.getItem('YZ_RENTAL_TEMPLATE_'+id); if(raw){ templateCache[id]=normalizeTemplate(JSON.parse(raw), id); return templateCache[id]; } }catch(_e){}
    return fallbackTemplate(id);
  }
  function splitLines(text){ return clean(text).split(/\n+/).map(clean).filter(Boolean); }
  function applyTemplateToContract(contract){
    contract=Object.assign({}, contract||{});
    const type=clean(contract.rentalType||contract.type)||'other';
    const t=cachedTemplate(type);
    if(!clean(contract.contractTitle || contract.title)) contract.contractTitle=t.title;
    if(!clean(contract.periodDays)) contract.periodDays=t.periodDays;
    if(!clean(contract.includedItems) && !Array.isArray(contract.equipmentItems)) contract.includedItems=t.equipmentList;
    if(!clean(contract.contractClauses || contract.clauses)) contract.contractClauses=t.clauses;
    if(!clean(contract.shippingRules)) contract.shippingRules=t.shippingRules;
    if(!clean(contract.rentalRules)) contract.rentalRules=t.rentalRules;
    if(!clean(contract.lineBindText)) contract.lineBindText=t.lineBindText;
    if(!clean(contract.partyBName)) contract.partyBName=t.companyName;
    if(!clean(contract.partyBOwner)) contract.partyBOwner=t.ownerName;
    if(!clean(contract.partyBAddress)) contract.partyBAddress=t.companyAddress;
    if(!clean(contract.partyBPhone)) contract.partyBPhone=t.companyPhone;
    if(!clean(contract.partyBTaxId)) contract.partyBTaxId=t.taxId;
    if(!clean(contract.rentFee) && clean(t.sampleRent)) contract.rentFee=t.sampleRent;
    if(!clean(contract.shippingFee) && clean(t.sampleShipping)) contract.shippingFee=t.sampleShipping;
    if(!clean(contract.depositFee) && clean(t.sampleDeposit)) contract.depositFee=t.sampleDeposit;
    return contract;
  }

  function contractStatus(row){ return clean(row.status || row.contractStatus || '草稿'); }
  function applicationStatus(row){ return clean(row.status || '新申請'); }
  function rentalTypeLabel(t){ t=clean(t); if(t==='digitalPiano') return '電鋼琴'; if(t==='electronicDrum') return '電子鼓'; if(t==='other') return '其他設備'; return t||'未選擇'; }
  function defaultIncludedItems(type){ return clean(cachedTemplate(type).equipmentList); }
  function defaultTitle(type){ return clean(cachedTemplate(type).title) || (type==='digitalPiano'?'電鋼琴設備租賃契約書':(type==='electronicDrum'?'電子鼓器材設備租賃契約書':'設備租賃契約書')); }
  function parseEquipmentItems(contract){
    contract=applyTemplateToContract(contract||{});
    if(Array.isArray(contract.equipmentItems) && contract.equipmentItems.length){
      return contract.equipmentItems.map(x=>({name:clean(x.name||x.equipmentName||x.title), note:clean(x.note||x.remark||x.memo)})).filter(x=>x.name||x.note);
    }
    const lines=clean(contract.includedItems).split(/\n|、|,|，/).map(clean).filter(Boolean);
    if(lines.length) return lines.map(x=>{ const parts=x.split(/\s\/\s/); return {name:clean(parts[0]), note:clean(parts.slice(1).join(' / '))}; });
    const n=clean(contract.equipmentName||contract.modelName||contract.itemName);
    return n?[{name:n,note:clean(contract.serialNo||contract.machineCode)}]:[];
  }
  function calcEndDate(startDate, periods, type, days){ return addDays(startDate, Math.max(1, Number(days || (Math.max(1, Number(periods||1))*Number(cachedTemplate(type).periodDays||90))))-1); }
  function pageBase(){ return location.origin+location.pathname.replace(/[^\/]*$/,''); }
  function signUrl(contract){ const id=clean(contract.contractId||contract.__id); const token=clean(contract.signToken||contract.token); return pageBase()+'rental-sign.html?contractId='+encodeURIComponent(id)+'&token='+encodeURIComponent(token); }
  function myContractUrl(contract){ const id=clean(contract.contractId||contract.__id); const token=clean(contract.customerToken||contract.signToken||contract.token); return pageBase()+'rental-my-contract.html?contractId='+encodeURIComponent(id)+'&token='+encodeURIComponent(token); }
  function officialContractUrl(contract){ const id=clean(contract.contractId||contract.__id); const token=clean(contract.officialContractToken||contract.customerToken||contract.signToken||contract.token); return pageBase()+'rental-contract.html?contractId='+encodeURIComponent(id)+'&token='+encodeURIComponent(token); }
  function adminUrlForContract(id){ return pageBase()+'rental-admin.html?contractId='+encodeURIComponent(id); }
  function adminUrlForApplication(id){ return pageBase()+'rental-admin.html?applicationId='+encodeURIComponent(id); }

  function renderContractHtml(contract, opts){
    contract=applyTemplateToContract(contract||{}); opts=opts||{};
    const type=clean(contract.rentalType||contract.type);
    const title=clean(contract.contractTitle||contract.title)||defaultTitle(type);
    const partyAName=clean(contract.customerName||contract.partyAName||contract.companyName);
    const identity=clean(contract.customerIdNumber||contract.customerTaxId||contract.taxId);
    const customerAddress=clean(contract.customerAddress||contract.address);
    const customerPhone=clean(contract.customerPhone||contract.phone);
    const partyBName=clean(contract.partyBName)||cachedTemplate(type).companyName;
    const partyBOwner=clean(contract.partyBOwner)||cachedTemplate(type).ownerName;
    const partyBAddress=clean(contract.partyBAddress)||cachedTemplate(type).companyAddress;
    const partyBPhone=clean(contract.partyBPhone)||cachedTemplate(type).companyPhone;
    const partyBTaxId=clean(contract.partyBTaxId)||cachedTemplate(type).taxId;
    const items=parseEquipmentItems(contract);
    const equipment=clean(contract.equipmentName||contract.modelName||contract.itemName||(items[0]&&items[0].name));
    const serial=clean(contract.serialNo||contract.machineCode||(items[0]&&items[0].note));
    const periods=Math.max(1, Math.min(10, Number(contract.periods||contract.rentalPeriods||1)));
    const periodDays=Math.max(1, Number(contract.periodDays||cachedTemplate(type).periodDays||90));
    const start=clean(contract.startDate);
    const end=clean(contract.endDate)||calcEndDate(start, periods, type, Number(contract.rentDays||periods*periodDays));
    const rent=fmtMoney(contract.rentFee||contract.rentalFee);
    const ship=fmtMoney(contract.shippingFee);
    const deposit=fmtMoney(contract.depositFee);
    const deliveryText=clean(contract.deliveryDate||contract.confirmedDeliveryDate||contract.deliveryDateTime||'').slice(0,10);
    const deliveryMethod=normalizeDeliveryMethod(contract.shippingMethod||contract.deliveryMethod);
    const isSelfPickup=deliveryMethod==='自取自載';
    const status=clean(contract.status||contract.contractStatus);
    const hasFormalData=!!(contract.customerSubmittedFormalAt || contract.customerSignatureDataUrl || contract.signatureDataUrl || contract.customerIdImageWatermarkedDataUrl || contract.idImageWatermarkedDataUrl || contract.customerIdImageDataUrl || contract.idImageDataUrl);
    const isOfficial=!!(opts.officialView || contract._officialPreview || hasFormalData || contract.officialPdfUrl || contract.officialConfirmedAt || contract.officialStartDate || ['租賃中','已退租','待歸還','續約詢問中','續約待付款','續約待確認','退租申請中'].includes(status));
    const deliveryLabel=isOfficial?(isSelfPickup?'確認自取日期':'確認安裝日期'):(isSelfPickup?'預估自取日期':'預估安裝日期');
    const startLabel=isOfficial?'正式起租日':'預估起租日';
    const startFallback=isOfficial?'____年__月__日':'依實際安裝完成後確認';
    const endFallback=isOfficial?'____年__月__日':'依正式起租日重新計算';
    const preliminaryNote=isOfficial?'':'實際正式起租日與租賃期間，會在店家最後確認後另行產生並傳送正式契約。';
    const dateText=clean(contract.contractDate)||ymd(new Date());
    const sig=clean(contract.customerSignatureDataUrl || contract.signatureDataUrl || contract.customerSignatureUrl || contract.signatureUrl || contract.signDataUrl);
    const idImage=clean(contract.customerIdImageWatermarkedDataUrl||contract.idImageWatermarkedDataUrl||contract.customerIdImageDataUrl||contract.idImageDataUrl||contract.idCardImageDataUrl||contract.customerIdImageUrl||contract.idImageUrl||contract.idCardImageUrl);
    const typeLine = type==='other'
      ? `租賃設備：${esc(equipment || '__________')}`
      : `租賃${esc(rentalTypeLabel(type))}：${esc(equipment || '__________')}${serial?'　編號：'+esc(serial):''}`;
    const itemHtml = items.length ? `<ol class="equipment-list-contract">${items.map(x=>`<li>${esc(x.name)}${x.note?`<span class="eq-note-contract">（${esc(x.note)}）</span>`:''}</li>`).join('')}</ol>` : '依雙方確認設備清單';
    const clauseHtml=[];
    clauseHtml.push(`${typeLine}<br>租賃期間：詳如第二頁「租賃期間明細表」。一期固定 ${esc(periodDays)} 天，續租起日為上一期到期日之隔日。`);
    clauseHtml.push(`租金：${esc(rent)}。押金：${esc(deposit)}。運費：${esc(ship)}。交付方式：${esc(deliveryMethod)}。${esc(deliveryLabel)}：${esc(deliveryText || '依店家最後確認')}。${preliminaryNote?`<br><b>${esc(preliminaryNote)}</b>`:''}`);
    clauseHtml.push(`乙方提供設備包括：${itemHtml}`);
    if(clean(contract.shippingRules)) clauseHtml.push(`<b>運費 / 搬運說明：</b>${esc(contract.shippingRules)}`);
    if(clean(contract.rentalRules)) clauseHtml.push(`<b>租用流程說明：</b>${esc(contract.rentalRules)}`);
    splitLines(contract.contractClauses||contract.clauses).forEach(x=>clauseHtml.push(esc(x)));
    if(!clauseHtml.some(x=>x.includes('線上簽署'))){ clauseHtml.push('本契約可採線上簽署及電子留存，與紙本簽署具同等效力。'); }
    function periodRows(){
      const rows=[];
      const periodEntries=Array.isArray(contract.periodEntries)?contract.periodEntries:[];
      const renewalEntries=Array.isArray(contract.renewalEntries)?contract.renewalEntries:[];
      if(start){
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
      while(rows.length<12) rows.push({method:'',start:'',end:'',days:'',note:''});
      return rows.slice(0,16).map(r=>`<tr><td>${esc(r.method)}</td><td>${esc(r.start)}</td><td>${esc(r.end)}</td><td>${esc(r.days)}</td><td>${esc(r.note)}</td></tr>`).join('');
    }
    const sealHtml = `<div class="official-stamps-rental"><img class="seal-company-rental" src="company_seal_contract_transparent.png" onerror="this.style.display='none'"><img class="seal-owner-rental" src="red_stamp_transparent.png" onerror="this.style.display='none'"></div>`;
    const idCardBlock = `<div class="id-card-block"><div class="id-card-title">甲方身分證資料備查</div><div class="id-card-meta">身分證字號 / 統編：${esc(identity || '客人正式填寫後顯示')}</div><div class="id-card-body">${idImage?`<img class="id-card-img" src="${esc(idImage)}" alt="身分證證明圖片">`:`<div class="id-placeholder">客人正式填寫連結上傳身分證證明後，此處會顯示加浮水印後的圖片。</div>`}</div></div>`;
    return `
      <style>
        .rental-contract-sheet{page-break-after:always;break-after:page;position:relative;overflow:hidden;background:#fff;color:#111827;width:210mm;height:297mm;min-height:297mm;margin:0 auto 10mm;padding:9mm 11mm;box-sizing:border-box;border:1px solid #d1d5db;box-shadow:0 8px 20px rgba(0,0,0,.05);font-size:12.2px;line-height:1.48}.rental-contract-sheet h1{text-align:center;font-size:21px;margin:0 0 4mm;letter-spacing:2px}.party-line{font-weight:800;margin-bottom:1.3mm;position:relative}.intro{margin:2mm 0}.clauses{padding-left:18px;margin:0}.clauses li{margin-bottom:1.15mm}.equipment-list-contract{margin:1mm 0 0 0;padding-left:18px}.equipment-list-contract li{margin:.4mm 0}.eq-note-contract{color:#475569}.sign-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:8px;margin-top:3mm}.sign-card{border:1px solid #94a3b8;border-radius:12px;padding:8px;min-height:40mm;position:relative}.sign-card.party-a{min-height:43mm}.party-a-line{display:block;margin:1.4mm 0}.wide-line{display:block;margin-top:1.2mm;min-height:7mm}.sig-box{margin-top:2mm;min-height:14mm;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sig-label{font-weight:900;white-space:nowrap}.sig-img{max-width:105px;max-height:52px;object-fit:contain}.official-stamps-rental{position:relative;height:24mm;margin-top:1mm}.seal-company-rental{position:absolute;left:0;top:0;width:27mm;height:22mm;object-fit:contain}.seal-owner-rental{position:absolute;left:30mm;top:7mm;width:14mm;height:14mm;object-fit:contain}.contract-date{text-align:center;margin-top:3mm;font-weight:800}.rental-page-no{position:absolute;right:11mm;bottom:6mm;font-size:10.5px;color:#64748b}.rental-contract-sheet.period-sheet h1{text-align:center}.period-table{width:100%;border-collapse:collapse;margin-top:3mm;font-size:12px}.period-table th,.period-table td{border:1px solid #333;padding:3px;text-align:center;height:7mm}.period-table th{background:#f3f4f6}.period-bottom{position:absolute;left:11mm;right:11mm;bottom:11mm;display:grid;grid-template-columns:1.15fr .85fr;gap:8mm;align-items:end}.id-card-block{border:1px solid #94a3b8;border-radius:12px;padding:7px;min-height:42mm}.id-card-title{font-weight:950;margin-bottom:1.6mm}.id-card-meta{font-size:11.5px;margin-bottom:1.6mm}.id-card-body{height:29mm;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px}.id-card-img{max-width:100%;max-height:29mm;object-fit:contain;filter:grayscale(100%)}.id-placeholder{font-size:11.5px;color:#64748b;text-align:center;padding:3mm}.period-stamp-block{border:1px solid #94a3b8;border-radius:12px;padding:7px;min-height:42mm}.period-stamp-title{font-weight:950;margin-bottom:1.6mm}
        @media(max-width:840px){.rental-contract-sheet{width:210mm!important;height:297mm!important;min-height:297mm!important;padding:9mm 11mm!important}.sign-grid{display:grid!important;grid-template-columns:1.1fr .9fr!important}.period-bottom{position:absolute!important;left:11mm!important;right:11mm!important;bottom:11mm!important;display:grid!important;grid-template-columns:1.15fr .85fr!important}.rental-page-no{position:absolute!important;right:11mm!important;bottom:6mm!important;text-align:left!important;margin-top:0!important}}
        @media print{.rental-contract-sheet{width:210mm!important;height:297mm!important;min-height:297mm!important;border:none!important;box-shadow:none!important;margin:0!important;page-break-after:always!important;break-after:page!important}.period-bottom{position:absolute!important;left:12mm!important;right:12mm!important;bottom:12mm!important;grid-template-columns:1.15fr .85fr!important}@page{size:A4;margin:0}}
      </style>
      <div class="rental-contract-sheet">
        <h1>${esc(title)}</h1>
        <div class="party-line">立契約書人：${esc(partyAName || '__________')}（以下簡稱甲方）</div>
        <div class="party-line">立契約書人：${esc(partyBName || '__________')}（以下簡稱乙方）</div>
        <p class="intro">甲方向乙方租賃設備，雙方同意簽訂本契約，條款如下：</p>
        <ol class="clauses">${clauseHtml.map(x=>`<li>${x}</li>`).join('')}</ol>
        <div class="sign-grid">
          <div class="sign-card party-a"><b>甲方</b><br><span class="party-a-line">姓名 / 公司：${esc(partyAName)}</span><span class="party-a-line">身分證字號 / 統編：${esc(identity)}</span><span class="wide-line">地址：${esc(customerAddress)}</span><span class="party-a-line">電話：${esc(customerPhone)}</span><div class="sig-box"><span class="sig-label">甲方簽名：</span>${sig?`<img src="${esc(sig)}" class="sig-img" alt="甲方簽名">`:'<span class="sig-empty">尚未簽名</span>'}</div></div>
          <div class="sign-card"><b>乙方</b><br>公司名稱：${esc(partyBName)}<br>負責人：${esc(partyBOwner)}<br>地址：${esc(partyBAddress)}<br>電話：${esc(partyBPhone)}<br>統一編號：${esc(partyBTaxId)}<br>${sealHtml}</div>
        </div>
        ${clean(contract.footerNote)?`<div style="font-size:11.5px;color:#475569;margin-top:2mm;line-height:1.6">${esc(contract.footerNote)}</div>`:''}
        <div class="contract-date">中華民國 ${esc(dateText)}</div><div class="rental-page-no">第 1 頁 / 共 2 頁</div>
      </div>
      <div class="rental-contract-sheet period-sheet">
        <h1>租賃期間明細表</h1>
        <div class="party-line">契約名稱：${esc(title)}</div>
        <div class="party-line">租賃設備：${esc(equipment || '__________')}</div>
        <div class="party-line">${esc(startLabel)}：${esc(start || startFallback)}　目前到期日：${esc(end || endFallback)}　一期：${esc(periodDays)} 天</div>
        <table class="period-table"><thead><tr><th style="width:26%">租用方式</th><th>起租日</th><th>到期日</th><th style="width:72px">天數</th><th>備註</th></tr></thead><tbody>${periodRows()}</tbody></table>
        <div class="period-bottom"><div>${idCardBlock}</div><div class="period-stamp-block"><div class="period-stamp-title">乙方簽章</div>${sealHtml}</div></div>
        <div class="contract-date">中華民國 ${esc(dateText)}</div><div class="rental-page-no">第 2 頁 / 共 2 頁</div>
      </div>`;
  }

  function randomString(len){
    len=len||20;
    try{
      const arr=new Uint8Array(len);
      (global.crypto||global.msCrypto).getRandomValues(arr);
      return Array.from(arr).map(x=>(x%36).toString(36)).join('').toUpperCase();
    }catch(e){ return Math.random().toString(36).slice(2,2+len).toUpperCase()+Date.now().toString(36).toUpperCase(); }
  }
  function makeId(prefix){ const d=new Date(); return prefix+'_'+String(d.getFullYear())+pad(d.getMonth()+1)+pad(d.getDate())+'_'+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds())+'_'+randomString(6); }
  function makeApplicationId(){ const d=new Date(); return 'RC'+String(d.getFullYear())+pad(d.getMonth()+1)+pad(d.getDate())+randomString(5); }
  function makeContractNo(id){ return clean(id).replace(/^RCT_?/,'RC-') || makeId('RC'); }
  function validToken(row, token){
    const t=clean(token);
    if(!t) return false;
    return [row.signToken,row.token,row.customerToken,row.officialContractToken].map(clean).filter(Boolean).includes(t);
  }
  async function primaryManagerRecipient(){
    try{
      const direct=await get('employees','PRIMARY_MANAGER_LINE');
      if(direct && clean(direct.lineUserId || direct['LINE User ID'])) return {name:clean(direct.name||'主要主管'),lineUserId:clean(direct.lineUserId || direct['LINE User ID']),email:clean(direct.email)};
    }catch(_e){}
    try{
      const rows=await all('employees',1000);
      const mgr=rows.find(x=>clean(x.lineUserId || x['LINE User ID']) && (isManager(x) || clean(x.role).toLowerCase()==='admin'));
      if(mgr) return {name:clean(mgr.name||mgr.employeeId||'主管'),lineUserId:clean(mgr.lineUserId || mgr['LINE User ID']),email:clean(mgr.email)};
    }catch(_e){}
    return null;
  }
  async function queueLineNotice(row){
    row=row||{};
    const qid=clean(row.queueId)||makeId('LINEQ');
    if(clean(row.channel||'line')==='line' && !clean(row.targetLineUserId)) return false;
    await db().collection('notificationQueue').doc(qid).set(Object.assign({
      queueId:qid, channel:'line', status:'待發送', createdAt:serverTs(), createdAtText:nowText(), source:'rental-local-fallback'
    }, row, {queueId:qid}), {merge:true});
    return true;
  }
  async function queueManagerNotice(title, body, extra){
    const mgr=await primaryManagerRecipient();
    if(!mgr || !mgr.lineUserId) return false;
    return await queueLineNotice(Object.assign({
      queueId:makeId('RENTAL_MGR'),
      targetLineUserId:mgr.lineUserId,
      targetName:mgr.name,
      targetEmail:mgr.email,
      title, body, message:body,
      source:'rental-manager-notice'
    }, extra||{}));
  }

  async function localSubmitApplication(payload){
    payload=payload||{};
    const id=clean(payload.applicationId||payload.applicationNo)||makeApplicationId();
    const customerName=clean(payload.customerName);
    const lineConfirmText=clean(payload.lineConfirmText)||('租賃申請 '+id+' '+customerName);
    const data=Object.assign({}, payload, {
      applicationId:id, applicationNo:id, rentalApplicationNo:id,
      status:clean(payload.status)||'待店家確認', stage:clean(payload.stage)||'inquiry',
      lineConfirmText, lineLinkStatus:clean(payload.lineLinkStatus)||'pending',
      createdAt:serverTs(), updatedAt:serverTs(), createdAtText:clean(payload.createdAtText)||nowText(), updatedAtText:nowText(),
      source:clean(payload.source)||'customer-inquiry-web'
    });
    await set('rentalApplications', id, data, true);
    try{
      await queueManagerNotice('新的設備租賃申請', ['有新的設備租賃申請', '姓名：'+(customerName||'未填'), '電話：'+clean(payload.customerPhone), '申請編號：'+id, '類型：'+rentalTypeLabel(payload.rentalType), '', '查看申請：'+adminUrlForApplication(id)].join('\n'), {applicationId:id, source:'rental-application-created'});
    }catch(_e){}
    return {ok:true,applicationId:id,applicationNo:id,lineConfirmText,message:'租賃申請已送出。'};
  }
  async function localSaveContract(payload){
    payload=payload||{};
    await loadTemplateSettings(payload.rentalType||payload.type).catch(()=>{});
    const existingId=clean(payload.contractId||payload.__id);
    const id=existingId||makeId('RCT');
    const existing=existingId?(await get('rentalContracts', existingId).catch(()=>null)):null;
    const app=clean(payload.applicationId)?(await get('rentalApplications', payload.applicationId).catch(()=>null)):null;
    let data=applyTemplateToContract(Object.assign({}, existing||{}, app?{
      applicationId:payload.applicationId,
      applicationNo:app.applicationNo||app.applicationId,
      customerLineUserId:payload.customerLineUserId||app.customerLineUserId||app.lineUserId,
      lineUserId:payload.customerLineUserId||app.customerLineUserId||app.lineUserId,
      lineDisplayName:app.lineDisplayName
    }:{}, payload));
    const signToken=clean(data.signToken||data.token)||randomString(28);
    const customerToken=clean(data.customerToken)||signToken;
    const officialToken=clean(data.officialContractToken)||randomString(28);
    const makeSign=!!payload.makeSignLink;
    let status=clean(data.status)||'草稿';
    if(makeSign && ['草稿','待店家確認','新申請','主管確認中',''].includes(status)) status='待客人補資料';
    data=Object.assign({}, data, {
      contractId:id,
      contractNo:clean(data.contractNo)||makeContractNo(id),
      signToken, token:signToken, customerToken, officialContractToken:officialToken,
      status,
      updatedAt:serverTs(), updatedAtText:nowText(),
      source:clean(data.source)||'rental-admin-firestore',
      saveSource:'rental-common-local-api'
    });
    if(!existing){ data.createdAt=serverTs(); data.createdAtText=clean(data.createdAtText)||nowText(); }
    await set('rentalContracts', id, data, true);
    if(clean(payload.applicationId)){
      await set('rentalApplications', payload.applicationId, {status:'已轉正式契約', linkedContractId:id, contractId:id, updatedAt:serverTs(), updatedAtText:nowText()}, true).catch(()=>{});
    }
    return {ok:true,contractId:id,contractNo:data.contractNo,signToken,token:signToken,customerToken,officialContractToken:officialToken,signUrl:signUrl(data),message:makeSign?'資料已儲存，資料填寫連結已建立。':'租賃契約資料已儲存。'};
  }
  async function localSignContract(payload){
    payload=payload||{};
    const id=clean(payload.contractId);
    if(!id) throw new Error('缺少合約 ID。');
    const c=await get('rentalContracts', id);
    if(!c) throw new Error('找不到合約資料。');
    if(!validToken(c, payload.token)) throw new Error('合約連結驗證失敗。');
    const data={
      customerSignatureDataUrl:clean(payload.signatureDataUrl),
      signatureDataUrl:clean(payload.signatureDataUrl),
      customerIdNumber:clean(payload.customerIdNumber),
      customerIdImageWatermarkedDataUrl:clean(payload.customerIdImageWatermarkedDataUrl),
      idImageWatermarkedDataUrl:clean(payload.customerIdImageWatermarkedDataUrl),
      customerSubmittedFormalAt:nowText(),
      customerSignedAt:nowText(),
      formalReceivedNoticeText:clean(payload.formalReceivedNoticeText||''),
      status:'待店家確認',
      updatedAt:serverTs(), updatedAtText:nowText(), signSource:'rental-common-local-api'
    };
    await set('rentalContracts', id, data, true);
    try{
      const fresh=Object.assign({}, c, data, {contractId:id});
      await queueManagerNotice('租賃客人已送出正式資料', ['客人已完成租賃正式資料與簽名', '姓名：'+clean(fresh.customerName), '合約編號：'+clean(fresh.contractNo||id), '設備：'+clean(fresh.equipmentName||rentalTypeLabel(fresh.rentalType)), '', '查看合約：'+adminUrlForContract(id)].join('\n'), {contractId:id, source:'rental-formal-submitted-manager'});
    }catch(_e){}
    return {ok:true,message:'正式資料與簽名已送出。'};
  }
  async function localGetContract(payload){
    const id=clean(payload&&payload.contractId);
    const token=clean(payload&&payload.token);
    const c=await get('rentalContracts', id);
    if(!c) throw new Error('找不到合約資料。');
    if(token && !validToken(c, token)) throw new Error('合約連結驗證失敗。');
    return {ok:true,contract:Object.assign({contractId:id},c)};
  }
  async function localSubmitRenewalRequest(payload){
    payload=payload||{}; const id=clean(payload.contractId); const c=await get('rentalContracts', id);
    if(!c) throw new Error('找不到合約資料。'); if(!validToken(c,payload.token)) throw new Error('連結驗證失敗。');
    const req={requestId:makeId('REN'), periods:Math.max(1,Number(payload.periods||1)||1), note:clean(payload.note), status:'待店家確認', createdAtText:nowText()};
    const data={status:'續約詢問中', renewalRequest:req, renewalRequests:arrayUnion(req), updatedAt:serverTs(), updatedAtText:nowText()};
    await set('rentalContracts', id, data, true);
    try{ await queueManagerNotice('租賃續約申請', ['客人送出續約申請', '姓名：'+clean(c.customerName), '合約：'+clean(c.contractNo||id), '期數：'+req.periods, '備註：'+req.note, '', '查看合約：'+adminUrlForContract(id)].join('\n'), {contractId:id, source:'rental-renewal-request'}); }catch(_e){}
    return {ok:true,message:'續約申請已送出。'};
  }
  async function localSubmitReturnRequest(payload){
    payload=payload||{}; const id=clean(payload.contractId); const c=await get('rentalContracts', id);
    if(!c) throw new Error('找不到合約資料。'); if(!validToken(c,payload.token)) throw new Error('連結驗證失敗。');
    const req={requestId:makeId('RET'), returnDate:clean(payload.returnDate), returnTime:clean(payload.returnTime), note:clean(payload.note), status:'待店家確認', createdAtText:nowText()};
    const data={status:'退租申請中', returnRequest:req, returnRequests:arrayUnion(req), updatedAt:serverTs(), updatedAtText:nowText()};
    await set('rentalContracts', id, data, true);
    try{ await queueManagerNotice('租賃退租申請', ['客人送出退租申請', '姓名：'+clean(c.customerName), '合約：'+clean(c.contractNo||id), '希望退租：'+req.returnDate+' '+req.returnTime, '備註：'+req.note, '', '查看合約：'+adminUrlForContract(id)].join('\n'), {contractId:id, source:'rental-return-request'}); }catch(_e){}
    return {ok:true,message:'退租申請已送出。'};
  }
  async function localCompleteReturn(payload){
    payload=payload||{}; const id=clean(payload.contractId); if(!id) throw new Error('缺少合約 ID。');
    const c=await get('rentalContracts', id).catch(()=>null);
    await set('rentalContracts', id, {status:'已退租', returnedAt:serverTs(), returnedAtText:nowText(), updatedAt:serverTs(), updatedAtText:nowText(), returnCompletedSource:'rental-common-local-api'}, true);
    const lineId=clean((c||{}).customerLineUserId||(c||{}).lineUserId);
    if(lineId){
      await queueLineNotice({queueId:makeId('RENTAL_RETURN_DONE'), targetLineUserId:lineId, targetName:clean((c||{}).customerName), targetEmail:clean((c||{}).customerEmail), title:'租賃退租已完成', body:'您的設備租賃退租已完成。感謝您使用柚子樂器設備租賃服務。', message:'您的設備租賃退租已完成。感謝您使用柚子樂器設備租賃服務。', contractId:id, source:'rental-return-complete'}).catch(()=>{});
    }
    return {ok:true,message:'已完成退租。'};
  }
  async function localRentalAction(name, payload){
    if(name==='rentalSubmitApplicationHttp') return await localSubmitApplication(payload||{});
    if(name==='rentalSaveContractHttp') return await localSaveContract(payload||{});
    if(name==='rentalSignContractHttp') return await localSignContract(payload||{});
    if(name==='rentalGetContractHttp') return await localGetContract(payload||{});
    if(name==='rentalSubmitRenewalRequestHttp') return await localSubmitRenewalRequest(payload||{});
    if(name==='rentalSubmitReturnRequestHttp') return await localSubmitReturnRequest(payload||{});
    if(name==='rentalCompleteReturnHttp') return await localCompleteReturn(payload||{});
    return null;
  }
  async function call(name, payload){
    if(/^rental[A-Z]/.test(clean(name)) || /^rental/.test(clean(name))){
      const local=await localRentalAction(clean(name), payload||{});
      if(local) return local;
    }
    const res=await fetch(functionUrl(name), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload||{})});
    const text=await res.text(); let json={};
    try{ json=text?JSON.parse(text):{}; }catch(e){ json={ok:false,message:text||'回傳不是 JSON'}; }
    if(!res.ok || json.ok===false) throw new Error(json.message || json.error || ('API '+name+' '+res.status));
    return json;
  }

  Object.assign(Rental,{clean,lower,truthy,num,ymd,rocDate,addDays,fmtMoney,normalizeDeliveryMethod,esc,qs,val,checked,setVal,show,hide,toast,user,isManager,requireManager,db,call,all,get,set,nowText,contractStatus,applicationStatus,rentalTypeLabel,defaultIncludedItems,parseEquipmentItems,defaultTitle,calcEndDate,signUrl,myContractUrl,officialContractUrl,renderContractHtml,functionUrl,loadTemplateSettings,preloadRentalTemplates,cachedTemplate,applyTemplateToContract,templateDocId,queueLineNotice,queueManagerNotice});
  global.YZRental = Rental;
})(window);
