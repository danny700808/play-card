from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one marker, found {count}")
    return text.replace(old, new, 1)


def replace_all(text: str, old: str, new: str, minimum: int, label: str) -> str:
    count = text.count(old)
    if count < minimum:
        raise SystemExit(f"{label}: expected at least {minimum} markers, found {count}")
    return text.replace(old, new)


admin_path = Path("rental-admin.html")
admin = admin_path.read_text(encoding="utf-8")

admin = replace_once(
    admin,
    '<link rel="stylesheet" href="style.css?v=rental-flow-20260611"><link rel="stylesheet" href="global-nav.css?v=20260603unified1">',
    '<link rel="stylesheet" href="style.css?v=rental-flow-20260611"><link rel="stylesheet" href="global-nav.css?v=20260603unified1"><link rel="stylesheet" href="rental-paper-sign-v1.css?v=20260803-paper-sign-v1">',
    "rental-admin paper css",
)

admin = replace_once(
    admin,
    '  <script src="ui-action-feedback.js?v=20260701safe3"></script>\n</body>',
    '  <script src="rental-paper-sign-v1.js?v=20260803-paper-sign-v1"></script>\n  <script src="ui-action-feedback.js?v=20260701safe3"></script>\n</body>',
    "rental-admin paper js",
)

admin = replace_once(
    admin,
    'function hasFormalSubmittedData(c){ c=c||{}; return !!(',
    'function hasFormalSubmittedData(c){ c=c||{}; return !!(c.paperSignedConfirmedAt || c.paperSignedPdfUrl || (Array.isArray(c.paperSignedDocuments)&&c.paperSignedDocuments.length) || ',
    "paper documents count as submitted",
)

status_list_old = "['待客人補資料','待客人簽署','待簽署','formal_sent','pending_customer']"
status_list_new = "['待客人補資料','待客人簽署','待簽署','formal_sent','pending_customer','待紙本簽署','紙本已上傳待確認']"
admin = replace_all(admin, status_list_old, status_list_new, 3, "paper statuses in rental filters")

admin = replace_once(
    admin,
    "const isWaitingCustomer=['待客人補資料','待客人簽署','待簽署','formal_sent','pending_customer','待紙本簽署','紙本已上傳待確認'].includes(st);",
    "const isPaperSigning=R.clean(c.signingMethod||c.signatureMethod)==='paper' || !!(c.paperSignedPdfUrl||c.paperSignedConfirmedAt); const isWaitingCustomer=!isPaperSigning && ['待客人補資料','待客人簽署','待簽署','formal_sent','pending_customer','待紙本簽署','紙本已上傳待確認'].includes(st);",
    "paper action button guard",
)

admin = replace_once(
    admin,
    "b(hasLine?'':'secondary','sendToCustomerForFill()','回傳給客人填寫身分證字號','data-send-fill-btn');",
    "if(!isPaperSigning) b(hasLine?'':'secondary','sendToCustomerForFill()','回傳給客人填寫身分證字號','data-send-fill-btn');",
    "hide online send button for paper cases",
)

admin = replace_once(
    admin,
    "      const payload=collect();\n      if(!validateInternalRentalCountFor('確認租用成立')) return;",
    "      const payload=collect();\n      const paperSigned=!!(selected && R.clean(selected.signingMethod||selected.signatureMethod)==='paper' && selected.paperSignedConfirmedAt && (selected.paperSignedPdfUrl || (Array.isArray(selected.paperSignedPageUrls)&&selected.paperSignedPageUrls.length)));\n      if(!validateInternalRentalCountFor('確認租用成立')) return;",
    "paper validation state",
)

admin = replace_once(
    admin,
    "      if(!hasSignatureAsset(payload)) missing.push('甲方簽名');",
    "      if(!paperSigned && !hasSignatureAsset(payload)) missing.push('甲方簽名');",
    "paper signature validation",
)
admin = replace_once(
    admin,
    "      if(!payload.customerIdNumber) missing.push('甲方身分證字號 / 統編');",
    "      if(!paperSigned && !payload.customerIdNumber) missing.push('甲方身分證字號 / 統編');",
    "paper identity number validation",
)
admin = replace_once(
    admin,
    "      if(!hasIdImageAsset(payload)) missing.push('甲方身分證證明圖片');",
    "      if(!paperSigned && !hasIdImageAsset(payload)) missing.push('甲方身分證證明圖片');",
    "paper id image validation",
)

admin_path.write_text(admin, encoding="utf-8")


sign_path = Path("rental-sign.html")
sign = sign_path.read_text(encoding="utf-8")

sign = replace_once(
    sign,
    '<input id="idImageInput" type="file" accept="image/*">',
    '<input id="idImageInput" type="file" accept="image/*" capture="environment">',
    "online sign mobile camera",
)

stray = "        if(hasSubmittedIdentityAndSignature(contract)){ showAlreadySubmitted(contract); }\n"
if sign.count(stray) > 1:
    raise SystemExit("online sign stray submitted check duplicated")
sign = sign.replace(stray, "", 1)

sign = replace_once(
    sign,
    "      const submitBtn = document.querySelector('button[type=\"submit\"], #submitBtn, #submitSignBtn');",
    "      const submitBtn = document.querySelector('button[type=\"submit\"], #submitBtn, #submitSignBtn, #submitSigBtn');",
    "online sign completed selector",
)

sign = replace_once(
    sign,
    "    async function load(){\n      try{\n        contract=await R.get('rentalContracts', contractId); if(!contract) throw new Error('找不到合約');\n        if(R.clean(contract.signToken||contract.token)!==R.clean(token)) throw new Error('合約連結驗證失敗');\n        signed=!!contract.customerSignedAt;",
    "    async function load(){\n      try{\n        if(!contractId || !token) throw new Error('合約連結不完整，請確認是否複製完整網址。');\n        contract=await R.get('rentalContracts', contractId); if(!contract) throw new Error('找不到合約');\n        if(R.clean(contract.signingMethod||contract.signatureMethod)==='paper') throw new Error('此合約已改用紙本簽署，請直接與柚子樂器確認。');\n        const validTokens=[contract.signToken,contract.token].map(R.clean).filter(Boolean);\n        if(!validTokens.includes(R.clean(token))) throw new Error('合約連結驗證失敗');\n        signed=!!contract.customerSignedAt || hasSubmittedIdentityAndSignature(contract);",
    "online sign load validation",
)

sign_path.write_text(sign, encoding="utf-8")


view_path = Path("rental-contract.html")
view = view_path.read_text(encoding="utf-8")

view = replace_once(
    view,
    '  <link rel="stylesheet" href="global-nav.css?v=20260624unified-top-nav">',
    '  <link rel="stylesheet" href="global-nav.css?v=20260624unified-top-nav">\n  <link rel="stylesheet" href="rental-paper-sign-v1.css?v=20260803-paper-sign-v1">',
    "formal paper contract css",
)
view = replace_once(
    view,
    '  <script src="global-nav.js?v=20260624unified-top-nav"></script>',
    '  <script src="rental-paper-contract-view-v1.js?v=20260803-paper-sign-v1"></script>\n  <script src="global-nav.js?v=20260624unified-top-nav"></script>',
    "formal paper contract viewer",
)
view_path.write_text(view, encoding="utf-8")
