"""MOMO v0.11.4 SKU price API, executed only by the store IP agent."""
from datetime import datetime, timezone, timedelta

QUERY = 'https://api3p.momo.com.tw/VendorApi/GoodsQueryByMethod'
MODIFY = 'https://api3p.momo.com.tw/VendorApi/GoodsdtPriceModify'


def positive_integer(value):
    if isinstance(value, bool):
        raise ValueError('MOMO 價格必須是正整數')
    number = float(value)
    if not number.is_integer() or number <= 0:
        raise ValueError('MOMO 價格必須是正整數')
    return int(number)


def sku_code(value):
    return str(value or '').strip().zfill(5)


def query_item(post, token, goods, variant, now):
    data = post(QUERY, token, {
        'queryMethod': 'All', 'saleStatus': 'All', 'pageIndex': 1, 'maxPerPage': 100,
        'applyDate': now.strftime('%Y-%m-%d %H:%M:%S'),
        'listGoods': [{'goodsCode': goods, 'listGoodsdtCode': [variant]}]
    })
    if data.get('success') is False or data.get('errorMessage'):
        raise RuntimeError(data.get('errorMessage') or 'MOMO 價格查詢失敗')
    matches = [dt for row in data.get('result', []) if str(row.get('goodsCode')) == goods
               and row.get('success') is not False for dt in row.get('listGoodsdt', [])
               if sku_code(dt.get('goodsdtCode')) == sku_code(variant)]
    if len(matches) != 1:
        raise RuntimeError('MOMO 未回傳唯一商品規格，未能確認價格')
    return matches[0]


def sync_targets(config, targets, logger, inventory_source, clock=None):
    output = {'targets': len(targets), 'success': 0, 'errors': 0, 'items': []}
    cfg = config.get('momo') or {}
    post = inventory_source.momo_post
    clock = clock or (lambda: datetime.now(timezone(timedelta(hours=8))))
    catalog = None
    for target in targets:
        item = {k: target.get(k) for k in ('productId', 'sku', 'targetPrice')}
        item['platform'] = 'MOMO'
        try:
            price = positive_integer(target.get('targetPrice'))
            token = cfg.get('momo_token')
            if not token:
                raise RuntimeError('MOMO TOKEN 尚未設定')
            mapping = target.get('platformMappings') or {}
            goods, variant = str(mapping.get('goodsCode') or ''), str(mapping.get('goodsdtCode') or '')
            if not goods or not variant:
                if catalog is None:
                    catalog = inventory_source.momo_query_all(cfg)
                matches = [r for r in catalog if str(r.get('entpGoodsNo', '')).strip() == str(target.get('sku', '')).strip()]
                if len(matches) != 1:
                    raise RuntimeError('MOMO SKU 配對不唯一或找不到商品，未送出改價')
                goods, variant = matches[0]['goodsCode'], matches[0]['goodsdtCode']
            now = clock()
            current = query_item(post, token, goods, variant, now)
            if str(current.get('entpGoodsNo') or '').strip() != str(target.get('sku') or '').strip():
                raise RuntimeError('MOMO 原廠編號與中央 SKU 不符，未送出改價')
            # The required list/market price comes from MOMO, never from the store price.
            if positive_integer(current.get('salePrice')) == price:
                item.update(status='same', message='MOMO 目前售價已相同')
            else:
                if current.get('custPrice') is None:
                    raise RuntimeError('MOMO 市價空白；改價 API 必填市價，需先指定市價處理方式')
                market = positive_integer(current.get('custPrice'))
                response = post(MODIFY, token, {'listItem': [{
                    'goodsCode': goods, 'goodsdtCode': variant, 'salePrice': price,
                    'custPrice': market, 'applyDate': now.strftime('%Y-%m-%d')
                }]})
                results = [r for r in response.get('listItem', []) if str(r.get('goodsCode')) == goods
                           and sku_code(r.get('goodsdtCode')) == sku_code(variant)]
                if response.get('success') is False or response.get('errorMessage'):
                    raise RuntimeError(response.get('errorMessage') or 'MOMO 整體改價請求失敗')
                if len(results) != 1 or results[0].get('success') is not True:
                    raise RuntimeError((results[0].get('errorMessage') if results else '') or 'MOMO 未回傳此規格改價成功')
                verified = query_item(post, token, goods, variant, clock())
                if positive_integer(verified.get('salePrice')) != price:
                    raise RuntimeError('MOMO 已受理改價，但查詢尚未確認新售價，請重新同步查驗')
                item.update(status='success', message=f'MOMO 售價已查驗為 {price}；市價維持 {market}')
            output['success'] += 1
        except Exception as exc:
            item.update(status='error', message=str(exc)[:700])
            output['errors'] += 1
        output['items'].append(item)
        logger.write(f"MOMO 改價 {item.get('sku')}：{item['status']}｜{item['message']}")
    return output
