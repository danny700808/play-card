柚子樂器｜老師、學生／家長、教室租用入口
版本：2026-07-26 v1

一、這次新增的入口

1. course-portal.html
   統一入口，讓使用者選擇老師、學生／家長或教室租用。

2. teacher-course-portal.html
   老師只看自己的週課表、學生及薪資；可做單次調課、永久調課、
   增加一堂課、老師免費送課及教室租用。

3. student-course-portal.html
   同一名學生可由本人、父親、母親或其他照顧者分別綁定 LINE，
   查看自己的課程、簽到、學費及設定提醒。

4. room-booking.html
   本校學生使用學生 LINE 綁定直接進入並使用學生價格；
   非本校學生以姓名＋電話註冊，再到 LINE 完成綁定。

5. course-portal-admin.html
   管理端查看與解除老師、學生／家長及一般租用者的 LINE 綁定。

二、一次完成部署

請把本壓縮檔解壓後，依原有資料夾位置覆蓋到 GitHub 專案，
再使用原本成功過的 GitHub Pages 與 Firebase Functions 部署流程。

需要部署的範圍：

- GitHub Pages：根目錄的 HTML、CSS、JS
- Firebase Functions：functions/index.js、functions/injiaoyunEducationMirror.js、
  functions/coursePortal.js、functions/coursePortalUtils.js
- Firestore Rules：firestore.rules

若使用 Firebase CLI，可在專案根目錄一次執行：

firebase deploy --only functions,firestore:rules

前端則照原本 GitHub Pages 自動部署；完成後以 Ctrl+F5 重新整理。

三、重要規則

- 姓名＋電話只用來核對資料，不是永久密碼。
- LINE 綁定碼 20 分鐘失效。
- LINE 回覆的一次性入口連結使用一次後失效。
- 裝置登入狀態最長 30 天，可由管理端立即解除。
- 同一名學生可以綁定多個 LINE 帳號，每位家長有自己的提醒設定。
- 學生／家長只會收到已綁定學生的資料。
- 老師只會收到自己的學生、課程與薪資。
- 其他老師的課只顯示「教室已使用」，不顯示學生姓名。
- 老師免費送課：學生 0 元、老師薪資 0 元。
- 教室租用星期二不開放，費用到現場付款。
- 手機入口資料集合禁止瀏覽器直接讀寫，只能透過 Cloud Functions。

四、LINE Webhook

不需要新增第二個 Webhook。
這次的課務綁定已接到原本的 lineWebhook：

- 柚子老師入口 CP-XXXXXXXX
- 柚子學生綁定 CP-XXXXXXXX
- 柚子租用綁定 CP-XXXXXXXX

原來的人員綁定、主管綁定、設備租賃綁定仍保留。
