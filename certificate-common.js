(function(global){
  const ORG_UNITS = {
    shangpin: {
      key:'shangpin',
      name:'尚品樂器行',
      label:'尚品樂器行',
      identifierLabel:'統一編號',
      identifier:'99680937',
      address:'台中市豐原區圓環東路347號4樓',
      phone:'04-25227893',
      stamp:'company_seal_contract_transparent.png',
      stampLabel:'尚品公司章',
      personalStamp:'red_stamp_transparent.png',
      tip:'公司／樂器行工作身分請選擇尚品樂器行。'
    },
    kaili: {
      key:'kaili',
      name:'台中市私立凱立音樂短期補習班',
      label:'台中市私立凱立音樂短期補習班',
      identifierLabel:'證號',
      identifier:'中市教終字第1110094357 號',
      address:'台中市豐原區圓環東路347號1至2樓',
      teachingLocation:'台中市豐原區圓環東路347號',
      phone:'04-25227893',
      stamp:'blue_stamp_transparent.png',
      stampLabel:'補習班章',
      personalStamp:'red_stamp_transparent.png',
      tip:'補習班老師／教學身分請選擇台中市私立凱立音樂短期補習班。'
    }
  };
  const BRAND = { name:'柚子樂器', english:'YOU ZI MUSIC', logo:'yuzu-logo-document-black.png' };
  const LEGAL_NOTICE = '本證明書僅供申請人告知之用途使用。若有擅自變造、轉借、冒用，或未依原申請用途及雙方約定使用，致生爭議者，應由申請人或實際使用人自行負相關法律責任。';
  const OLD_DEFAULT_FOOTERS = ['本證明僅作為申請人於本單位服務事實之證明。','本證明僅作為申請人任職事實之證明，不作其他用途。'];
  const TEACHER_IDENTITY_OPTIONS = ['外聘老師','專職老師','工讀助教'];
  const LESSON_TYPE_OPTIONS = ['個別課','團體課','活動課','短期課程'];
  const EMPLOYMENT_WORK_NATURE_OPTIONS = ['教學','行政','門市','教學與行政','活動支援','其他'];

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function esc(v){ return clean(v).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }
  function upperId(v){ return clean(v).toUpperCase().replace(/\s+/g,''); }
  function pad(n){ return String(n).padStart(2,'0'); }
  function today(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
  function dateOnly(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') v = v.toDate();
    if(v instanceof Date && !isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth()+1)}-${pad(v.getDate())}`;
    const s=clean(v).replace(/\//g,'-');
    if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    const d=new Date(s); return isNaN(d.getTime()) ? s : `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  function dateTimeText(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') v = v.toDate();
    if(v instanceof Date && !isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth()+1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}`;
    const s=clean(v); return s;
  }
  function rocDate(v){
    const s=dateOnly(v); if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return esc(s);
    const [y,m,d]=s.split('-').map(Number);
    return `民國 ${y-1911} 年 ${m} 月 ${d} 日`;
  }
  function unitByKey(key){ return ORG_UNITS[clean(key)] || ORG_UNITS.kaili; }
  function typeLabel(type){ return clean(type)==='teaching' ? '教學證明' : '在職證明'; }
  function docTitle(type){ return clean(type)==='teaching' ? '教學證明書' : '在職證明書'; }
  function statusLabel(s){
    s=clean(s); if(!s) return '待主管審核';
    if(s==='approved'||s==='已同意') return '已核准';
    if(s==='rejected'||s==='已駁回') return '已退回';
    if(s==='pending') return '待主管審核';
    return s;
  }
  function isApprovedStatus(s){ s=statusLabel(s); return s==='已核准'; }
  function watermarkText(status, mode){
    if(mode==='editing') return '送出前預覽';
    const s=statusLabel(status);
    if(s==='已核准') return '';
    if(s==='已退回') return '申請已退回\n僅供預覽';
    return '主管尚未核准\n僅供預覽';
  }
  function defaultTemplate(type){
    const isTeaching = clean(type)==='teaching';
    return {
      certificateType:isTeaching?'teaching':'employment',
      title:isTeaching?'教學證明書':'在職證明書',
      defaultUnitKey:isTeaching?'kaili':'shangpin',
      showBrandLogo:true,
      introText:isTeaching?'茲證明下列教師於本單位擔任教學工作，教學資料如下，特此證明。':'茲證明下列人員現任職於本單位，任職資料如下，特此證明。',
      footerText:LEGAL_NOTICE,
      closingText:'特此證明',
      watermarkPending:'主管尚未核准\n僅供預覽',
      watermarkRejected:'申請已退回\n僅供預覽',
      updatedAtText:''
    };
  }
  function normalizeTemplate(type, row){ return Object.assign({}, defaultTemplate(type), row || {}); }
  function userIdOf(u){ u=u||{}; return clean(u.id || u.employeeId || u.userId || u.email); }
  function identityTypeOfUser(u){
    u=u||{}; const raw=lower(u.identityType || u['身分類型']);
    if(raw==='external'||raw.indexOf('外聘')>=0) return 'external';
    if(raw==='parttime'||raw.indexOf('工讀')>=0 || u.isPartTime===true) return 'parttime';
    return 'staff';
  }
  function identityLabelOfUser(u){ const t=identityTypeOfUser(u); return t==='external'?'外聘老師':(t==='parttime'?'工讀生':'專職老師'); }

  function normalizeApplication(row){
    row=row||{};
    const form=row.formData || row.data || row;
    const type=clean(row.certificateType || form.certificateType || row.type || 'employment')==='teaching'?'teaching':'employment';
    return Object.assign({}, row, {
      requestId:clean(row.requestId || row.__id || row.id),
      certificateType:type,
      certificateTypeLabel:typeLabel(type),
      employeeId:clean(row.employeeId || row.userId || form.employeeId || row['員工ID']),
      name:clean(row.name || row.applicantName || form.name || form.teacherName || row['姓名']),
      email:clean(row.email || row.Email || row['Email']),
      idNumber:upperId(row.idNumber || form.idNumber || row['身分證字號']),
      status:statusLabel(row.status || row['狀態']),
      formData:Object.assign({}, form, {idNumber:upperId(form.idNumber || row.idNumber || row['身分證字號'])}),
      submittedAtText:dateTimeText(row.submittedAt || row.createdAt || row['送出時間'] || row['建立時間']),
      reviewedAtText:dateTimeText(row.reviewedAt || row['審核時間']),
      hiddenBy:Array.isArray(row.hiddenBy)?row.hiddenBy:[]
    });
  }

  function applicationToDocumentData(row){
    const app=normalizeApplication(row);
    const f=app.formData || {};
    if(app.certificateType==='teaching'){
      return {
        type:'teaching',
        name:clean(f.teacherName || app.name),
        idNumber:upperId(f.idNumber || app.idNumber),
        teacherIdentity:clean(f.teacherIdentity || app.identityLabel || '外聘老師'),
        subject:clean(f.subject),
        periodStart:dateOnly(f.periodStart),
        periodEnd:dateOnly(f.periodEnd),
        stillTeaching:!!f.stillTeaching || clean(f.stillTeaching)==='是',
        lessonType:clean(f.lessonType || '個別課'),
        location:ORG_UNITS.kaili.teachingLocation || '台中市豐原區圓環東路347號',
        unitKey:clean(f.unitKey || 'kaili'),
        issueDate:dateOnly(f.issueDate || app.approvedDate || app.reviewedAt || today())
      };
    }
    return {
      type:'employment',
      name:clean(f.name || app.name),
      idNumber:upperId(f.idNumber || app.idNumber),
      jobTitle:clean(f.jobTitle || f.title),
      workNature:clean(f.workNature || '教學'),
      hireDate:dateOnly(f.hireDate),
      stillWorking:f.stillWorking === false ? false : true,
      unitKey:clean(f.unitKey || 'shangpin'),
      issueDate:dateOnly(f.issueDate || app.approvedDate || app.reviewedAt || today())
    };
  }

  function fieldRowsHtml(type, data){
    const rows = [];
    if(type==='teaching'){
      const period = [rocDate(data.periodStart), data.stillTeaching ? '迄今' : rocDate(data.periodEnd)].filter(Boolean).join(' 至 ');
      rows.push(['教師姓名', data.name], ['身分證字號', data.idNumber], ['教師身分', data.teacherIdentity], ['任教科目', data.subject], ['任教期間', period], ['授課類型', data.lessonType], ['授課地點', data.location || ORG_UNITS.kaili.address]);
    }else{
      rows.push(['姓名', data.name], ['身分證字號', data.idNumber], ['職稱', data.jobTitle], ['工作性質', data.workNature], ['到職日期', rocDate(data.hireDate)], ['任職狀態', data.stillWorking ? '現仍在職' : '已離職']);
    }
    return rows.map(([k,v])=>`<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  }

  function certificateHtml(opts){
    opts=opts||{};
    const type=clean(opts.type)==='teaching'?'teaching':'employment';
    const template=normalizeTemplate(type, opts.template || {});
    const data=Object.assign({type, unitKey:template.defaultUnitKey}, opts.data || {});
    data.unitKey = data.unitKey || template.defaultUnitKey;
    const unit=unitByKey(data.unitKey);
    const mark = opts.watermark != null ? clean(opts.watermark) : watermarkText(opts.status, opts.mode);
    const title=clean(template.title || docTitle(type));
    const intro=clean(template.introText || defaultTemplate(type).introText);
    let footer=clean(template.footerText || defaultTemplate(type).footerText);
    if(!footer || OLD_DEFAULT_FOOTERS.indexOf(footer) >= 0) footer = LEGAL_NOTICE;
    const closing=clean(template.closingText || '特此證明');
    const approved = isApprovedStatus(opts.status || '');
    const reviewLine = approved && opts.reviewedAt ? `<div class="cert-review-line">核准時間：${esc(dateTimeText(opts.reviewedAt))}${opts.reviewerName?`　核准人：${esc(opts.reviewerName)}`:''}</div>` : '';
    return `
      <section class="cert-doc ${approved?'cert-approved':'cert-preview'}">
        ${mark ? `<div class="cert-watermark">${esc(mark).replace(/\n/g,'<br>')}</div>` : ''}
        <div class="cert-title">${esc(title)}</div>
        <main class="cert-body">
          <p class="cert-intro">${esc(intro)}</p>
          <table class="cert-info-table"><tbody>${fieldRowsHtml(type, data)}</tbody></table>
          <p class="cert-footer-text">${esc(footer)}</p>
          <p class="cert-closing">${esc(closing)}</p>
        </main>
        <footer class="cert-footer">
          <div class="cert-bottom-info">
            <div class="cert-brand-bottom">
              ${template.showBrandLogo !== false ? `<img class="cert-brand-logo-bottom" src="${esc(BRAND.logo)}" alt="柚子樂器 YOU ZI MUSIC">` : `<div class="cert-brand-text">${esc(BRAND.name)}<span>${esc(BRAND.english)}</span></div>`}
              <div class="cert-brand-caption">對外商號：${esc(BRAND.name)} / ${esc(BRAND.english)}</div>
            </div>
            <div class="cert-issue">
              <div>實際政府認證單位：${esc(unit.name)}</div>
              <div>${esc(unit.identifierLabel)}：${esc(unit.identifier)}</div>
              <div>地址：${esc(unit.address)}</div>
              <div>電話：${esc(unit.phone || '04-25227893')}</div>
              <div>開立日期：${rocDate(data.issueDate || today())}</div>
              ${reviewLine}
            </div>
          </div>
          <div class="cert-stamps">
            <div class="stamp-box"><img src="${esc(unit.stamp)}" alt="${esc(unit.stampLabel)}"><span>${esc(unit.stampLabel)}</span></div>
            <div class="stamp-box personal"><img src="${esc(unit.personalStamp)}" alt="個人章"><span>個人章</span></div>
          </div>
        </footer>
      </section>`;
  }

  function injectCertificateStyles(){
    if(document.getElementById('certificateCommonStyles')) return;
    const style=document.createElement('style');
    style.id='certificateCommonStyles';
    style.textContent=`
      .cert-doc{width:210mm;min-height:297mm;background:#fff;color:#111827;box-sizing:border-box;padding:20mm 18mm 15mm;position:relative;box-shadow:0 10px 36px rgba(15,23,42,.16);overflow:hidden;font-family:"Noto Sans TC","Microsoft JhengHei",Arial,sans-serif;}
      .cert-brand-text{text-align:center;font-size:22px;font-weight:900;letter-spacing:3px}.cert-brand-text span{display:block;font-size:12px;letter-spacing:4px;margin-top:5px}
      .cert-title{text-align:center;font-size:32px;font-weight:950;letter-spacing:8px;margin:0 0 14mm;}
      .cert-body{font-size:15px;line-height:2;color:#111827}.cert-intro{margin:0 0 7mm;text-indent:2em}.cert-info-table{width:148mm;max-width:148mm;border-collapse:collapse;margin:0 auto 7mm;font-size:15px;table-layout:fixed}.cert-info-table th,.cert-info-table td{border:1px solid #111;padding:3.2mm 4mm;text-align:left;vertical-align:middle}.cert-info-table th{width:34mm;background:#f8fafc;text-align:center;font-weight:900}.cert-info-table td{width:auto}.cert-footer-text{width:148mm;max-width:148mm;margin:3mm auto 8mm;text-indent:2em;font-size:12px;line-height:1.8;color:#374151}.cert-closing{font-size:17px;font-weight:900;letter-spacing:2px;margin-top:8mm;text-align:left}.cert-footer{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8mm;align-items:end;width:160mm;max-width:160mm;margin:9mm auto 0;border-top:1px solid #e5e7eb;padding-top:6mm}.cert-bottom-info{display:flex;flex-direction:column;gap:4mm;min-width:0}.cert-brand-bottom{display:flex;align-items:center;gap:5mm;min-width:0}.cert-brand-logo-bottom{width:50mm;max-width:100%;max-height:18mm;object-fit:contain}.cert-brand-caption{font-size:12px;font-weight:900;letter-spacing:1px;color:#111827}.cert-issue{font-size:13px;line-height:1.75;font-weight:700;color:#111827}.cert-review-line{font-size:12px;color:#374151;margin-top:2mm}.cert-stamps{display:flex;justify-content:flex-end;gap:4mm;align-items:flex-end;min-width:62mm}.stamp-box{text-align:center;font-size:12px;color:#64748b;font-weight:800}.stamp-box img{display:block;width:29mm;height:29mm;object-fit:contain;margin:0 auto 2mm}.stamp-box.personal img{width:27mm;height:27mm}.cert-watermark{position:absolute;left:50%;top:47%;transform:translate(-50%,-50%) rotate(-24deg);font-size:34px;line-height:1.5;font-weight:950;color:rgba(185,28,28,.18);border:4px solid rgba(185,28,28,.16);border-radius:12px;padding:8mm 14mm;text-align:center;letter-spacing:4px;z-index:3;pointer-events:none;white-space:nowrap}.cert-preview .cert-body,.cert-preview .cert-footer{position:relative;z-index:1}.cert-scale-wrap{display:block;overflow:auto;background:#f8fafc;border:1px solid #e2e8f0;border-radius:20px;padding:16px;min-height:560px;max-width:100%;box-sizing:border-box;text-align:center}.cert-scale-wrap>.cert-doc{display:inline-block;text-align:left;vertical-align:top;transform:none!important;transform-origin:top center;margin:0 auto!important;max-width:none!important;}
      .cert-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:none;align-items:flex-start;justify-content:center;padding:22px;overflow:auto}.cert-modal.show{display:flex}.cert-modal-panel{background:#fff;border-radius:24px;padding:16px;max-width:min(100%,980px);box-shadow:0 25px 70px rgba(15,23,42,.32)}.cert-modal-actions{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}.cert-modal-actions .right{display:flex;gap:8px;flex-wrap:wrap}.cert-modal-actions button{width:auto}.cert-status-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:900;background:#eef7f2;color:#166534}.cert-status-pill.pending{background:#fff7ed;color:#9a3412}.cert-status-pill.rejected{background:#fef2f2;color:#991b1b}@media(max-width:780px){.cert-scale-wrap{min-height:430px;padding:10px}.cert-modal{padding:10px}.cert-watermark{font-size:22px}}@media print{html,body{margin:0!important;background:#fff!important}body *{visibility:hidden!important}.print-host,.print-host *{visibility:visible!important}.print-host{position:absolute!important;left:0!important;top:0!important;width:210mm!important}.cert-doc{box-shadow:none!important;margin:0!important;transform:none!important;zoom:1!important}@page{size:A4 portrait;margin:0}}
    `;
    document.head.appendChild(style);
  }


  function fitCertificatePreviews(){
    const wraps = Array.from(document.querySelectorAll('.cert-scale-wrap'));
    wraps.forEach(wrap => {
      const doc = wrap.querySelector(':scope > .cert-doc') || wrap.querySelector('.cert-doc');
      if(!doc) return;
      const style = global.getComputedStyle ? global.getComputedStyle(wrap) : null;
      const padX = style ? (parseFloat(style.paddingLeft)||0) + (parseFloat(style.paddingRight)||0) : 32;
      doc.style.zoom = '1';
      doc.style.marginLeft = 'auto';
      doc.style.marginRight = 'auto';
      const paperW = doc.offsetWidth || 794;
      const available = Math.max(240, (wrap.clientWidth || paperW) - padX - 4);
      const scale = Math.min(1, Math.max(0.28, available / paperW));
      doc.style.zoom = String(scale);
      wrap.dataset.certScale = String(scale.toFixed(3));
    });
  }
  function scheduleFitCertificatePreviews(){
    if(global.__yzCertFitTimer) global.clearTimeout(global.__yzCertFitTimer);
    global.__yzCertFitTimer = global.setTimeout(fitCertificatePreviews, 40);
  }

  async function verifyIdPassword(expected){
    const exp=upperId(expected);
    if(!exp){ alert('這筆資料沒有身分證字號，無法驗證。'); return false; }
    const input=prompt('此文件含有個人資料。請輸入本人身分證字號後繼續（英文會自動轉大寫）。');
    if(input==null) return false;
    if(upperId(input) !== exp){ alert('身分證字號不符，無法繼續。'); return false; }
    return true;
  }
  function printHtml(html){
    const base=location.href.replace(/[^\/]*$/,'');
    const w=window.open('', '_blank');
    if(!w){ alert('瀏覽器阻擋彈出視窗，請允許彈出視窗後再試。'); return; }
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${esc(base)}"><title>列印證明</title><style>${document.getElementById('certificateCommonStyles')?.textContent||''}body{margin:0;background:#fff}.print-host{width:210mm;margin:0 auto}</style></head><body><div class="print-host">${html}</div><script>window.onload=function(){setTimeout(function(){window.print();},350)}<\/script></body></html>`);
    w.document.close();
  }
  async function downloadEncryptedPdfFromElement(el, fileName, password){
    if(!el) throw new Error('找不到預覽內容。');
    const pass=upperId(password);
    if(!pass) throw new Error('缺少 PDF 密碼。');
    if(!global.html2canvas || !global.jspdf || !global.jspdf.jsPDF){
      throw new Error('PDF 元件尚未載入，請確認網路後重整頁面。');
    }
    const oldZoom = el.style.zoom;
    el.style.zoom = '1';
    try{
      const canvas = await global.html2canvas(el, {scale:2, useCORS:true, backgroundColor:'#ffffff'});
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new global.jspdf.jsPDF({orientation:'portrait', unit:'mm', format:'a4', encryption:{userPassword:pass, ownerPassword:pass, userPermissions:['print']}});
      pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      pdf.save(fileName || 'certificate.pdf');
    } finally {
      el.style.zoom = oldZoom || '';
      scheduleFitCertificatePreviews();
    }
  }
  function statusPill(status){ const s=statusLabel(status); const cls=s==='已核准'?'':(s==='已退回'?' rejected':' pending'); return `<span class="cert-status-pill${cls}">${esc(s)}</span>`; }

  global.YZ_CERT = {ORG_UNITS, BRAND, LEGAL_NOTICE, TEACHER_IDENTITY_OPTIONS, LESSON_TYPE_OPTIONS, EMPLOYMENT_WORK_NATURE_OPTIONS, clean, esc, upperId, today, dateOnly, dateTimeText, rocDate, unitByKey, typeLabel, docTitle, statusLabel, isApprovedStatus, watermarkText, defaultTemplate, normalizeTemplate, normalizeApplication, applicationToDocumentData, certificateHtml, injectCertificateStyles, verifyIdPassword, printHtml, downloadEncryptedPdfFromElement, fitCertificatePreviews, scheduleFitCertificatePreviews, statusPill, userIdOf, identityTypeOfUser, identityLabelOfUser};
})(window);
