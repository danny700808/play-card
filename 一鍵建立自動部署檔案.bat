@echo off
chcp 65001 >nul
setlocal

echo ==========================================
echo  柚子樂器 - Firebase Functions 自動部署設定
echo ==========================================
echo.
echo 這個檔案請放在 play-card-main 最外層後執行。
echo 會自動建立：
echo   .firebaserc
echo   .github\workflows\firebase-functions-deploy.yml
echo.

if not exist "firebase.json" (
  echo [錯誤] 這裡看不到 firebase.json。
  echo 請把這個 bat 放到 play-card-main 最外層再執行。
  echo.
  pause
  exit /b 1
)

if not exist "functions" (
  echo [錯誤] 這裡看不到 functions 資料夾。
  echo 請把這個 bat 放到 play-card-main 最外層再執行。
  echo.
  pause
  exit /b 1
)

echo [1/3] 建立 .firebaserc ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$json = @'{`n  \"projects\": {`n    \"default\": \"youzi-c1b74\"`n  }`n}`n'@; Set-Content -LiteralPath '.firebaserc' -Value $json -Encoding UTF8"

echo [2/3] 建立 .github\workflows ...
if not exist ".github" mkdir ".github"
if not exist ".github\workflows" mkdir ".github\workflows"

echo [3/3] 建立 GitHub Actions 自動部署檔 ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$yml = @'`nname: Deploy Firebase Functions`n`non:`n  push:`n    branches:`n      - main`n    paths:`n      - 'functions/**'`n      - 'firebase.json'`n      - '.firebaserc'`n      - '.github/workflows/firebase-functions-deploy.yml'`n`njobs:`n  deploy-functions:`n    runs-on: ubuntu-latest`n    steps:`n      - name: Checkout repository`n        uses: actions/checkout@v4`n`n      - name: Setup Node.js`n        uses: actions/setup-node@v4`n        with:`n          node-version: '20'`n`n      - name: Install Firebase CLI`n        run: npm install -g firebase-tools`n`n      - name: Install functions dependencies`n        working-directory: functions`n        run: npm ci || npm install`n`n      - name: Deploy Firebase Functions`n        env:`n          FIREBASE_SERVICE_ACCOUNT_YOUZI_C1B74: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_YOUZI_C1B74 }}`n        run: firebase deploy --only functions --project youzi-c1b74`n'@; Set-Content -LiteralPath '.github\workflows\firebase-functions-deploy.yml' -Value $yml -Encoding UTF8"

echo.
echo 完成！已建立自動部署檔案。
echo.
echo 接下來請在 CMD 輸入：
echo   git add .firebaserc .github/workflows/firebase-functions-deploy.yml
echo   git commit -m "新增 Firebase Functions 自動部署"
echo   git push
echo.
pause
