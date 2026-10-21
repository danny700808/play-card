'use strict';
const fs=require('node:fs');
let html=fs.readFileSync('store-agent/shipping-ui/index.html','utf8');
html=html.replace('<title>柚子樂器｜出貨工作台</title>','<title>柚子樂器｜包貨窗口</title>')
  .replace('href="/style.css"','href="store-agent/shipping-ui/style.css?v=20261021-delivery-v1"')
  .replace('<meta name="youzi-session" content="__SESSION__">','<link rel="stylesheet" href="shipping-desk.css?v=20261020-v1">\n  <meta name="referrer" content="no-referrer">\n  <script defer src="shipping-desk.js?v=20261020-v1"></script>')
  .replace('src="/model.js"','src="store-agent/shipping-ui/model.js?v=20261021-delivery-v1"')
  .replace('<script defer src="/app.js"></script>','<script defer src="shipping-local-print.js?v=20261020-local-print-v1"></script>\n  <script defer src="store-agent/shipping-ui/app.js?v=20261021-direct-shopee-v1"></script>')
  .replace('<body>','<body>\n  <section id="packingLogin" class="packing-login"><form id="packingLoginForm"><span class="brand">柚子樂器</span><h1>包貨窗口</h1><label>密碼<input id="packingPassword" type="password" autocomplete="current-password" required></label><label class="remember"><input id="packingRemember" type="checkbox" checked>記住這台電腦</label><p id="loginError" class="login-error" role="alert"></p><button id="packingLoginButton" class="primary" type="submit">進入包貨窗口</button></form></section>')
  .replace('<main>','<main id="packingApp" hidden>')
  .replace('<h1>出貨工作台</h1>','<h1>包貨窗口</h1>')
  .replace('</div></div></header>','</div></div><div class="packing-session"><span id="hostStatus" class="host-status">連接主機中</span><button id="packingLogout" type="button">登出</button></div></header>');
fs.writeFileSync('shipping-desk.html',html);
