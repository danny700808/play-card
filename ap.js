const API_URL = "https://script.google.com/macros/s/AKfycbxB0Z0OSox6qikxiWmqKPiD50zizkfYiR4y5kekfCSFFt91nQfNd8hWafRkemG0Xfk/exec";

const todayDateEl = document.getElementById("todayDate");
const liveTimeEl = document.getElementById("liveTime");
const emailEl = document.getElementById("email");
const messageEl = document.getElementById("message");
const checkInBtn = document.getElementById("checkInBtn");
const checkOutBtn = document.getElementById("checkOutBtn");

function updateClock() {
  const now = new Date();

  const dateText = now.toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long"
  });

  const timeText = now.toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  todayDateEl.textContent = dateText;
  liveTimeEl.textContent = timeText;
}

updateClock();
setInterval(updateClock, 1000);

function setMessage(text) {
  messageEl.textContent = text;
}

function setLoading(isLoading) {
  checkInBtn.disabled = isLoading;
  checkOutBtn.disabled = isLoading;
}

async function submitClock(type) {
  const email = emailEl.value.trim().toLowerCase();

  if (!email) {
    setMessage("請先輸入員工 Email");
    emailEl.focus();
    return;
  }

  if (!API_URL || API_URL.includes("請改成你的AppsScript網址")) {
    setMessage("尚未設定 Apps Script API 網址");
    return;
  }

  try {
    setLoading(true);
    setMessage("送出中，請稍候...");

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
        action: "clock",
        type,
        email
      })
    });

    const result = await response.json();

    if (result.status) {
      setMessage(
        `${type}成功\n姓名：${result.name || ""}\n時間：${result.time || ""}\n${result.msg || ""}`.trim()
      );
    } else {
      setMessage(result.msg || "打卡失敗");
    }
  } catch (error) {
    setMessage("系統連線失敗，請稍後再試");
    console.error(error);
  } finally {
    setLoading(false);
  }
}

checkInBtn.addEventListener("click", () => submitClock("上班"));

checkOutBtn.addEventListener("click", () => submitClock("下班"));
