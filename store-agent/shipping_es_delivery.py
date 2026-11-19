"""Use checkout's selected delivery, never a clerk-selected replacement."""
import json


def selected_delivery(order):
    pickup = order.get('pickup_address') or {}
    fees = [f for f in order.get('shipping_fees', []) if not f.get('is_deleted')]
    provider = pickup.get('service_provider') or ''
    try:
        details = json.loads(pickup.get('json') or '{}')
    except (ValueError, TypeError):
        details = {}
    subtype = details.get('LogisticsSubType') if isinstance(details, dict) else None
    if provider == 'ecpaylogistics-tw':
        method = {'UNIMARTC2C': 'seven', 'UNIMART': 'seven',
                  'FAMIC2C': 'family', 'FAMI': 'family'}.get(subtype)
        if method and details.get('CVSStoreID'):
            return {'shippingMethod': method, 'logisticsProvider': provider,
                    'deliveryMethod': '7-11' if method == 'seven' else '全家',
                    'deliveryMethodSource': 'EasyStore 訂單原始取貨設定',
                    'selectedDelivery': {'provider': provider, 'subtype': subtype,
                        'storeId': str(details['CVSStoreID']),
                        'storeAppId': pickup.get('store_app_id')}}
        return {'deliveryMethod': '綠界物流（門市資料待確認）'}
    if pickup:
        return {'shippingMethod': 'pickup', 'deliveryMethod': '門市自取',
                'deliveryMethodSource': 'EasyStore 訂單原始取貨設定'}
    native = (len(fees) == 1 and fees[0].get('shipping_id') and fees[0].get('zone_id')
              and not fees[0].get('store_app_id')
              and str(fees[0].get('name','')).strip().lower() in ('運費','shipping fee','自訂物流','自訂配送'))
    explicit_postal = len(fees) == 1 and any(v in str(fees[0].get('name','')) for v in ('郵局', '中華郵政', '自訂物流'))
    if order.get('shipping_address') and (native or explicit_postal):
        # Owner's rule: EasyStore native/custom shipping -> postal address label.
        return {'shippingMethod': 'postal', 'documentType': 'postal-address-v1',
                'deliveryMethod': '自訂物流／郵局', 'logisticsProvider': 'postal-address',
                'deliveryMethodSource': 'EasyStore 自訂物流（店家指定郵局）',
                'selectedDelivery': {'shippingId': fees[0].get('shipping_id'),
                                     'zoneId': fees[0].get('zone_id'), 'name': fees[0].get('name')}}
    return {}
