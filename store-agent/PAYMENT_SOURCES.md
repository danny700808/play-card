# Packing desk payment contract

Verified 2026-10-20 against live API responses and seller screens. No shipment
creation or physical printing is used for payment verification.

## Sources

* EasyStore API 3.0 `orders.json`: successful, non-test, captured `transactions`
  (`id`, `status`, `test`, `paid_at`, `currency`, `amount`). The live Shopee orders
  identify the gateway as `shopee-payment`. These amounts match Shopee's
  **買家總支付金額**, including platform coupons; they differ from seller income.
  Example: merchandise 32,750, coupon 2,000, freight 0, capture 30,750.
  Do not deduct discounts, freight, seller fees or points again.
  `total_paid_amount` remains an explicit paid-total fallback when supplied.
  See [API reference](https://postman.easystore.co/) and
  [paid-total definition](https://developers.easystore.co/docs/theme/liquid-reference/liquid-order).
* EasyStore unpaid `cod_type=1`, no captured transactions:
  `total_amount_include_transaction` is a **receivable**, not paid cash.
  It is exported as `payableAmount`, `pending_collection`, with null `paidAmount`.
  Live Shopee COD buyer-total rows reconcile (including a discounted 3,036 order).
  The UI says 待收款; source status can lag collection, so it is not a bank receipt.
* MOMO official Vendor API v0.9, `OrderQuery`, pp.53–55: `listItem.orderAmount`
  is the suborder amount. Live E001 **客人實付金額** reconciles to its sum, including
  freight lines: 380+380+0=760; ten separate 95 lines+0=950; 2,380+0=2,380;
  discounted order 1,719+0=1,719. Never multiply the amount by quantity.
  `invoiceAmount` is separate; null does not mean zero. The live store uses momo代開.
* Coupang [ordersheet contract](https://developers.coupang.com/zh-TW/api/shipments/po-list-query-by-minute):
  sum(`orderItems.orderPrice` - `discountPrice`) + `shippingPrice` + `remotePrice`.
  `discountPrice` must reconcile to instant + downloadable + Coupang discounts;
  subtract it once. Money objects require TWD, integer units and nanos; do not
  default missing money to zero. `paidAt` and separately queried return/cancel
  records must be available. `isCod` describes freight collect, not item payment.
  Live 7,580 and 1,999 orders reconcile to official API buyer invoice metadata;
  WING's 7,580 order detail also confirms zero freight and buyer invoice 7,580.
  `extraProperties.invoiceAmountInfo.invoiceAmountToBuyer` is separately exported
  as `invoiceBuyerAmount`; never substitute seller settlement or the invoice
  allocated to Coupang for buyer payment.

## Refunds and parcel allocation

* Refund/cancel signals suppress confirmation, with `review` and a specific
  reason. Do not show the old gross payment as the refund-adjusted net amount.
  Automatic calculation of a refund net total is not implemented.
* Coupang's official return/cancel API is checked during every refresh. A failed
  or incomplete claims query cannot produce a confirmed payment.
* EasyStore is one row per original order, regardless of fulfillment count.
* MOMO amounts follow unique `orderSeq` values. A single physical parcel includes
  freight-only groups even if their courier fields are blank. Multiple physical
  parcels receive only their own sequences; unallocated nonzero freight requires
  review. This payment allocation does not change existing label keys/print flows.
* Coupang split shipments or multiple boxes for one order require review until
  freight/coupon allocation is independently verified; never repeat the whole
  order total on each parcel.
* `paidAmountScope` / `paidScopeKey` identify the amount's counting unit. A parcel
  amount is displayed as 本包裹實付. This feature does not create invoices.

## Deployment and privacy

Install `shipping_payments.py` alongside core/remote on the main host and restart.
The relay forwards only normalized payment fields; no raw transactions,
credentials, costs or settlement records. Preserve `shipping-local-print.js`
and secondary printer configuration. Generate the public page with
`node scripts/build-shipping-desk.cjs`.
