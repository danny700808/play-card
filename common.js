function getApiUrl(){return (window.APP_CONFIG && window.APP_CONFIG.API_URL) || "";}
function qs(id){ return document.getElementById(id); }
function setMsg(id, text){ qs(id).innerText = text; }
async function postApi(payload){
  const apiUrl = getApiUrl();
  if(!apiUrl || apiUrl.indexOf("PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE") >= 0){
    return {status:false,msg:"請先在 config.js 貼上 Apps Script 部署網址"};
  }
  try{
    const res = await fetch(apiUrl,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(payload)});
    const text = await res.text();
    try{return JSON.parse(text);}catch(e){return {status:false,msg:"API 回傳格式錯誤\n" + text};}
  }catch(err){ return {status:false,msg:"連線失敗：" + err.message};}
}
function saveSession(result){
  localStorage.setItem("emp_login","ok");
  localStorage.setItem("emp_email", result.email || "");
  localStorage.setItem("emp_name", result.name || "");
  localStorage.setItem("emp_id", result.empId || "");
  localStorage.setItem("emp_role", result.role || "");
  localStorage.setItem("emp_token", result.sessionToken || "");
}
function clearSession(){["emp_login","emp_email","emp_name","emp_id","emp_role","emp_token"].forEach(k=>localStorage.removeItem(k));}
function requireLogin(){if(localStorage.getItem("emp_login") !== "ok" || !localStorage.getItem("emp_token")){location.href = "./index.html"; return false;} return true;}
function getSessionPayload(){return {sessionToken: localStorage.getItem("emp_token") || "", email: localStorage.getItem("emp_email") || ""};}
async function fetchPublicIp(){try{const r = await fetch("https://api.ipify.org?format=json"); const d = await r.json(); return d.ip || "";}catch(e){return "";}}
