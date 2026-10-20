(function(root){
  'use strict';
  const labels={acquired:'已取單',print_requested:'已開啟列印',printed:'已印單',shipped:'已出貨',processed:'已處理',cancelled:'已取消'};
  const model={
    formatSku(value){
      const raw=String(value||'').trim().replace(/\s+/g,'');
      if(/^\d{3}-/.test(raw))return raw;
      return raw.replace(/^(\d{3})(\d{4})(.*)$/,'$1-$2$3');
    },
    searchCode(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');},
    shopeePrintUrl(row){
      if(row.platform!=='EasyStore'||row.channel!=='蝦皮'||!/^\d+$/.test(String(row.externalId||'')))return '';
      if(row.stage!=='shipped'&&!row.tracking)return '';
      return `https://admin.easystore.co/channels/shopee/taiwan/orders/awb?store_order_ids=${row.externalId}`;
    },
    async obtainDocument(api,row,options,onReview=()=>{}){
      const fresh=await api('/api/preview',{key:row.key,options});
      // A reprint must never silently turn into a new shipment.
      if(row.canDownload&&fresh.action!=='download')throw Error('平台貨運單狀態已變更，請重新讀取訂單；這次未申請新出貨。');
      if(fresh.key!==row.key||!fresh.fingerprint)throw Error('未能核對這筆訂單，請重新讀取。');
      onReview(fresh);
      return api('/api/process',{key:row.key,options,fingerprint:fresh.fingerprint});
    },
    status(row){
      if(row.handlingChanged)return '資料有變，需核對';
      if(row.handled)return labels[row.handlingAction]||'已處理';
      if(row.stage==='review')return '需核對';
      return row.stage==='partial'?'未處理 · 部分待出貨':'未處理';
    }
  };
  if(typeof module!=='undefined')module.exports=model;
  else root.ShippingModel=model;
})(typeof window!=='undefined'?window:this);
