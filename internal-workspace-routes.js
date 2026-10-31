/* Navigation only: permissions and business actions stay in their existing pages. */
(function(root){
 const groups = {
  "hr": {
    "label": "人事薪資",
    "home": "hr-payroll-settings-hub.html",
    "links": [
      [
        "人員",
        "employee-admin.html"
      ],
      [
        "應聘",
        "application-admin.html"
      ],
      [
        "薪資與投保",
        "salary-admin.html"
      ],
      [
        "工讀結算",
        "data-center.html?module=parttime"
      ],
      [
        "班表",
        "schedule-admin.html"
      ],
      [
        "假勤制度",
        "leave-policy-admin.html"
      ],
      [
        "資料整理",
        "person-data-admin.html"
      ]
    ],
    "pages": [
      "hr-payroll-settings-hub.html",
      "employee-admin.html",
      "application-admin.html",
      "application-notification-settings.html",
      "salary-admin.html",
      "data-center.html",
      "parttime-payroll-admin.html",
      "schedule-admin.html",
      "leave-policy-admin.html",
      "person-data-admin.html",
      "line-binding-admin.html"
    ]
  },
  "approval": {
    "label": "簽核",
    "home": "approval-hub.html",
    "links": [
      [
        "待辦總覽",
        "approval-hub.html"
      ],
      [
        "註冊",
        "registration-approval.html"
      ],
      [
        "打卡",
        "clock-corrections-admin.html"
      ],
      [
        "臨時出勤",
        "temporary-attendance-admin.html"
      ],
      [
        "請假",
        "leave.html?mode=approval"
      ],
      [
        "個資",
        "profile-change-admin.html"
      ],
      [
        "出勤核對",
        "attendance-flow-check.html"
      ]
    ],
    "pages": [
      "approval-hub.html",
      "registration-approval.html",
      "clock-corrections-admin.html",
      "temporary-attendance-admin.html",
      "profile-change-admin.html",
      "approval-notification-settings.html",
      "attendance-flow-check.html",
      "clock-records-admin.html"
    ]
  },
  "work": {
    "label": "日常工作",
    "home": "items-hub.html",
    "links": [
      [
        "工作總覽",
        "items-hub.html"
      ],
      [
        "公告",
        "announcement-admin.html"
      ],
      [
        "交辦",
        "task.html?mode=admin"
      ],
      [
        "定期事項",
        "routine.html?mode=admin"
      ],
      [
        "教育訓練",
        "training-admin.html"
      ],
      [
        "員工首頁",
        "dashboard.html"
      ]
    ],
    "pages": [
      "items-hub.html",
      "announcement-admin.html",
      "training-admin.html",
      "notification-settings.html",
      "line-notification-check.html"
    ]
  },
  "teachers": {
    "label": "外聘老師",
    "home": "teacher-hub.html",
    "links": [
      [
        "老師總覽",
        "teacher-hub.html"
      ],
      [
        "名單",
        "employee-admin.html?type=external&source=teacher-hub"
      ],
      [
        "合約",
        "external-teacher-admin.html?source=teacher-hub"
      ],
      [
        "條款",
        "contract-admin.html"
      ],
      [
        "公告",
        "announcement-admin.html?audience=external&source=teacher-hub"
      ],
      [
        "協助事項",
        "task.html?mode=admin&identity=external&source=teacher-hub"
      ],
      [
        "拿貨",
        "teacher-goods-admin.html?source=teacher-hub"
      ],
      [
        "表單",
        "external-teacher-forms-admin.html"
      ]
    ],
    "pages": [
      "teacher-hub.html",
      "external-teacher-admin.html",
      "external-teacher-contract-admin.html",
      "contract-admin.html",
      "teacher-goods-admin.html",
      "external-teacher-forms-admin.html",
      "teacher-notification-settings.html",
      "external-teacher-payroll.html"
    ]
  },
  "rental": {
    "label": "租賃",
    "home": "rental-system-hub.html",
    "links": [
      [
        "租賃總覽",
        "rental-system-hub.html"
      ],
      [
        "申請與契約",
        "rental-admin.html"
      ],
      [
        "契約模板",
        "rental-template-settings.html"
      ],
      [
        "費用設定",
        "rental-settings.html"
      ],
      [
        "合約列印",
        "rental-contract-admin.html"
      ]
    ],
    "pages": [
      "rental-system-hub.html",
      "rental-admin.html",
      "rental-template-settings.html",
      "rental-settings.html",
      "rental-contract-admin.html",
      "email-send-check.html"
    ]
  },
  "forms": {
    "label": "表單證明",
    "home": "quotation-contract-hub.html",
    "links": [
      [
        "表單總覽",
        "quotation-contract-hub.html"
      ],
      [
        "模板設定",
        "form-settings-hub.html"
      ],
      [
        "估價單",
        "quotation-admin.html"
      ],
      [
        "集點卡",
        "gift-point-card-admin.html"
      ],
      [
        "在職證明",
        "employment-certificate-hub.html"
      ],
      [
        "教學證明",
        "teaching-certificate-hub.html"
      ],
      [
        "證明審核",
        "certificate-review-admin.html"
      ]
    ],
    "pages": [
      "quotation-contract-hub.html",
      "form-settings-hub.html",
      "quotation-admin.html",
      "gift-point-card-admin.html",
      "employment-certificate-hub.html",
      "employment-certificate-admin.html",
      "employment-certificate-admin-issue.html",
      "teaching-certificate-hub.html",
      "teaching-certificate-admin.html",
      "teaching-certificate-admin-issue.html",
      "certificate-review-admin.html",
      "certificate-history-admin.html",
      "certificate-notification-settings.html"
    ]
  },
  "employee": {
    "label": "員工服務",
    "home": "dashboard.html",
    "links": [
      [
        "員工首頁",
        "dashboard.html"
      ],
      [
        "打卡",
        "clock.html"
      ],
      [
        "工讀時數",
        "parttime.html"
      ],
      [
        "請假",
        "leave.html"
      ],
      [
        "公告",
        "announcements.html"
      ],
      [
        "交辦",
        "task.html"
      ],
      [
        "定期",
        "routine.html"
      ],
      [
        "教育訓練",
        "training.html"
      ],
      [
        "表單",
        "forms-hub.html"
      ]
    ],
    "pages": [
      "dashboard.html",
      "clock.html",
      "parttime.html",
      "leave.html",
      "announcements.html",
      "task.html",
      "routine.html",
      "training.html",
      "forms-hub.html",
      "profile.html",
      "salary.html",
      "temporary-attendance.html",
      "gift-point-card.html",
      "employment-certificate.html",
      "teaching-certificate.html",
      "barcode-print.html"
    ]
  }
};
 function resolve(path,search){
   const file=path.split('/').pop();const query=new URLSearchParams(search||'');
   if(query.get('source')==='teacher-hub' || (file==='employee-admin.html'&&query.get('type')==='external')) return 'teachers';
   if(file==='leave.html'&&query.get('mode')==='approval')return 'approval';
   if(['task.html','routine.html'].includes(file)&&query.get('mode')==='admin')return 'work';
   return Object.keys(groups).find(key=>groups[key].pages.includes(file))||null;
 }
 const api={groups,resolve};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.InternalWorkspaceRoutes=api;
})(typeof window==='object'?window:this);
