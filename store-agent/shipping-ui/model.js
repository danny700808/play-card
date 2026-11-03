(function(root){
  'use strict';
  const labels={arranged:'已安排出貨',acquired:'已取單',print_requested:'已開啟列印',printed:'已印單',shipped:'已出貨',processed:'已處理',cancelled:'已取消'};
  const model={
    packingLabel(row){
      if(row.stale||row.handlingChanged)throw Error('訂單資料待核對，尚未送印。');
      if(!Array.isArray(row.items)||!row.items.length)throw Error('尚未取得商品資料，尚未送印。');
      const items=[];
      for(const item of row.items){
        const quantity=row.stage==='partial'?item.remaining:item.quantity;
        if(quantity==null||typeof quantity==='boolean'||String(quantity).trim()===''||!Number.isInteger(Number(quantity))||Number(quantity)<0||item.heldQuantity>0)
          throw Error('商品數量待核對，尚未送印。');
        if(Number(quantity)===0)continue;
        const name=String(item.name||'').trim(),sku=model.formatSku(item.sku);
        if(!name||!sku)throw Error('品名或貨號不完整，尚未送印。');
        const variant=String(item.variant||'').trim();
        items.push({name:name+(variant&&!name.includes(variant)?' / '+variant:''),sku,quantity:Number(quantity)});
      }
      if(!items.length)throw Error('沒有可核對的出貨商品，尚未送印。');
      return {version:'packing-footer-v1',orderNo:row.orderNo,items,
        paidAmount:row.paidAmount,paidCurrency:row.paidCurrency,
        paidAmountStatus:model.paidAmount(row).confirmed?row.paidAmountStatus:'unconfirmed'};
    },
    paidAmount(row){
      if(row.stale)return {text:'實付金額：待更新',confirmed:false,note:'訂單資料尚未更新，請重新讀取後核對。'};
      if(row.paidAmountStatus==='review')return {text:'實付金額：需核對',confirmed:false,note:row.paidAmountNote||'請核對退款或拆單明細。'};
      if(row.paidAmountStatus==='pending_collection'&&row.paidCurrency==='TWD'&&
        typeof row.payableAmount==='string'&&/^\d{1,12}(?:\.\d{1,2})?$/.test(row.payableAmount)){
        return {text:`待收款：NT$${Number(row.payableAmount).toLocaleString('zh-TW',{maximumFractionDigits:2})}`,confirmed:false,note:row.paidAmountNote};
      }
      const raw=row.paidAmount;
      const valid=(typeof raw==='string'||typeof raw==='number')&&
        /^\d{1,12}(?:\.\d{1,2})?$/.test(String(raw))&&Number.isFinite(Number(raw));
      const currency=String(row.paidCurrency||'');
      if(row.paidAmountStatus!=='confirmed'||!valid||!/^[A-Z]{3}$/.test(currency)){
        return {text:'實付金額：待確認',confirmed:false,note:row.paidAmountNote||'尚未取得可確認的實付金額，請核對平台付款明細。'};
      }
      const amount=Number(raw).toLocaleString('zh-TW',{maximumFractionDigits:2});
      return {text:`${row.paidAmountScope==='parcel'?'本包裹實付':'實付金額'}：${currency==='TWD'?'NT$':currency+' '}${amount}`,
        confirmed:true,note:row.paidAmountNote||'平台回傳的實付金額'};
    },
    formatSku(value){
      const raw=String(value||'').trim().replace(/\s+/g,'');
      if(/^\d{3}-/.test(raw))return raw;
      return raw.replace(/^(\d{3})(\d{4})(.*)$/,'$1-$2$3');
    },
    deliveryMethod(row){
      const names={TWL_HCT:'新竹物流',TWL_KERRY:'嘉里大榮',TWL_FM:'全家',TWL_711:'7-11'};
      const value=String(row.deliveryMethod||names[row.carrierCode]||row.carrier||'').trim();
      if(!value||['shipping fee','shipping','運費','預設物流','預設物流 (一般包裹)'].includes(value.toLowerCase()))return row.deliveryMethodNote?'配送資料未讀取':'配送方式待平台提供';
      return value.replace(/^第三方物流-/,'')+(row.deliveryMethodNote?'（上次核對）':'');
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
      if((row.canDownload||row.documentReady)&&fresh.action!=='download')throw Error('平台貨運單狀態已變更，請重新讀取訂單；這次未申請新出貨。');
      if(fresh.key!==row.key||!fresh.fingerprint)throw Error('未能核對這筆訂單，請重新讀取。');
      onReview(fresh);
      return api('/api/process',{key:row.key,options,fingerprint:fresh.fingerprint});
    },
    savedDocumentAvailable(row){
      return !!(row.documentReady&&!row.stale&&!row.handlingChanged&&!['cancelled','review'].includes(row.stage));
    },
    documentActionLabel(row){
      if(['printed','print_requested','shipped'].includes(row.handlingAction)||row.stage==='shipped')return '重印貨運單';
      if(row.documentReady||row.handlingAction==='acquired')return '列印貨運單';
      if(row.handlingAction==='arranged')return '取回原貨運單';
      return '取得貨運單';
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

