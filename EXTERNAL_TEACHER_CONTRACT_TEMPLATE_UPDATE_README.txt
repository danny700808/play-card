外聘老師契約條文更新包

用途：
- 將外聘老師預設契約改成目前確認的「外聘才藝教師委任契約書」20 條版本。
- external-teacher-contract-admin.html 增加「套用預設委任契約條文」按鈕。
- functions/externalTeacherOnboarding.js 的新建預設模板也改成同一份條文。

覆蓋檔案：
1. external-teacher-contract-admin.html
2. functions/externalTeacherOnboarding.js

參考文字：
- external_teacher_default_contract_text.txt

注意：
- 如果 Firebase 裡已經有舊的 active 合約模板，單純覆蓋 functions 檔案不會自動改掉既有模板。
- 請進 external-teacher-contract-admin.html，按「套用預設委任契約條文」，再按「儲存條文」。
- 這包沒有修改任何 rental-* 租賃檔案。
