(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(globalThis);
  else root.OperationsPlatformOrderAnomaliesUiStylesV1=factory(root);
})(typeof window!=='undefined'?window:globalThis,function(global){
  'use strict';
  function ensureStyles() {
    if (!global.document || global.document.getElementById('opsPlatformOrderAnomalyStyles')) return;
    const style = global.document.createElement('style');
    style.id = 'opsPlatformOrderAnomalyStyles';
    style.textContent = [
      '.ops-poa-card{margin-top:14px;border:1px solid #d8e5dc;background:#fff}',
      '.ops-poa-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}',
      '.ops-poa-head h2{margin:0 0 6px;font-size:20px;color:#173247}',
      '.ops-poa-head p{margin:0;color:#64766c;line-height:1.65}',
      '.ops-poa-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}',
      '.ops-poa-summary{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}',
      '.ops-poa-chip{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:7px 10px;background:#eef5f0;color:#345348;font-size:12px;font-weight:700}',
      '.ops-poa-chip.danger{background:#fff0f0;color:#9a3030}',
      '.ops-poa-chip.warning{background:#fff6dc;color:#886817}',
      '.ops-poa-chip.ready{background:#e9f8ef;color:#267044}',
      '.ops-poa-status{display:none;border-radius:12px;padding:11px 13px;margin:12px 0;line-height:1.55;font-size:13px}',
      '.ops-poa-status.show{display:block}',
      '.ops-poa-status.info{background:#eef5ff;color:#315c8a}',
      '.ops-poa-status.success{background:#e9f8ef;color:#267044}',
      '.ops-poa-status.warning{background:#fff6dc;color:#7a5d12}',
      '.ops-poa-status.error{background:#fff0f0;color:#9a3030}',
      '.ops-poa-list{display:grid;gap:12px}',
      '.ops-poa-item{border:1px solid #e0e8e3;border-left:5px solid #c35b5b;border-radius:14px;padding:14px;background:#fff}',
      '.ops-poa-item.warning{border-left-color:#d0a22f}',
      '.ops-poa-item.ready{border-left-color:#3c9b65;background:#fbfffc}',
      '.ops-poa-item-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
      '.ops-poa-item-head b{display:block;color:#173247;font-size:15px}',
      '.ops-poa-item-head small{display:block;color:#73837a;margin-top:4px;line-height:1.5}',
      '.ops-poa-badges{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}',
      '.ops-poa-badge{border-radius:999px;padding:5px 8px;background:#f0f4f2;color:#476157;font-size:11px;font-weight:800;white-space:nowrap}',
      '.ops-poa-badge.danger{background:#fff0f0;color:#9a3030}',
      '.ops-poa-badge.warning{background:#fff6dc;color:#806215}',
      '.ops-poa-badge.ready{background:#e9f8ef;color:#267044}',
      '.ops-poa-reason,.ops-poa-fix{border-radius:11px;padding:10px 12px;margin-top:10px;line-height:1.65;font-size:13px}',
      '.ops-poa-reason{background:#fff4f4;color:#7f3030}',
      '.ops-poa-item.warning .ops-poa-reason{background:#fff8e8;color:#725817}',
      '.ops-poa-item.ready .ops-poa-reason{background:#edf9f1;color:#266441}',
      '.ops-poa-fix{background:#f3f7f5;color:#40584f}',
      '.ops-poa-reason strong,.ops-poa-fix strong{display:block;margin-bottom:2px}',
      '.ops-poa-meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;color:#66786e;font-size:12px}',
      '.ops-poa-item-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}',
      '.ops-poa-empty{border:1px dashed #cfdad3;border-radius:13px;padding:20px;text-align:center;color:#5c7166;background:#f8fbf9}',
      '.ops-poa-more{margin-top:10px;color:#73837a;font-size:12px;text-align:center}',
      '@media(max-width:760px){.ops-poa-head,.ops-poa-item-head{display:block}.ops-poa-actions,.ops-poa-badges{justify-content:flex-start;margin-top:10px}.ops-poa-actions .ops-button,.ops-poa-item-actions .ops-button{flex:1;min-width:130px}}'
    ].join('');
    global.document.head.appendChild(style);
  }

  return {ensureStyles:ensureStyles};
});
