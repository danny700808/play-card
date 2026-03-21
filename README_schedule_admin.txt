檔案：schedule-admin.html

這份頁面是設定區的「班表設定」HTML。

它預設會呼叫這幾個後端 action：
- getScheduleSetupData
- saveScheduleTemplate
- deleteScheduleTemplate
- saveEmployeeSchedule
- deleteEmployeeSchedule

後端 getScheduleSetupData 建議回傳格式：
{
  templates: [...],
  assignments: [...],
  employees: [
    { employeeId: "EMP001", name: "王小明" }
  ]
}

注意：
1. 這份 HTML 內的 apiCall() 需要接到你現有前端的 API 封裝。
2. 如果你目前是用 fetch 呼叫 GAS Web App，請把 apiCall() 裡的 api.post(action, payload) 改成你原本系統使用的寫法。
3. 這份頁面只做班表模板與員工套用班表管理，不動現有登入與打卡頁。
