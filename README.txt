這一包是純前端修正版，不要貼 apps-script.gs。

請只覆蓋 GitHub 的這 5 個檔案：
- task.html
- app.js
- style.css
- dashboard.html
- config.js

重點：
1. 指派員工改成姓名選單（目前 config.js 先放一位員工，可自行追加）
2. 截止日期/時間預設隱藏，只有按「自訂時間」才展開
3. 完成回報需求取代原本「是否需要照片」
4. 老闆版 task.html 不顯示「我的任務」
5. 員工在 dashboard.html 看「我的任務」
6. 不動目前可用的 Google Apps Script

如果要新增員工姓名選單，請在 config.js 的 EMPLOYEES 陣列裡追加：
{ id: '員工ID', name: '姓名', email: '信箱' }
