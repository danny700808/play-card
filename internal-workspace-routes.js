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
        "註冊建檔",
        "registration-approval.html"
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
        "quotation-contract-hub.html?identity=external&source=teacher-hub"
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
        "集點卡列印",
        "gift-point-card.html?source=forms"
      ],
      [
        "估價單",
        "quotation-admin.html"
      ],
      [
        "集點卡設定",
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
      "my-certificates.html",
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
   if(file==='gift-point-card.html'&&query.get('source')==='forms')return 'forms';
   if(file==='leave.html'&&query.get('mode')==='approval')return 'approval';
   if(['task.html','routine.html'].includes(file)&&query.get('mode')==='admin')return 'work';
   return Object.keys(groups).find(key=>groups[key].pages.includes(file))||null;
 }
 // The management map is navigation only. Queries retain each page's existing filters.
 const leaf=(id,label,href,extra)=>Object.assign({id,label,href},extra||{});
 const branch=(id,label,children,extra)=>Object.assign({id,label,children},extra||{});
 const tree=branch('root','管理工作區',[
  branch('people','人事',[
   branch('staff','專職人員',[
    leaf('staff-mobile','手機版檢視','dashboard.html?preview=staff'),
    leaf('staff-people','人員資料','employee-admin.html?type=staff'),
    leaf('staff-salary','薪資與投保','salary-admin.html?type=staff'),
    leaf('staff-schedule','班表','schedule-admin.html'),
    leaf('staff-leave','假勤制度','leave-policy-admin.html'),
    branch('staff-approvals','簽核',[
     leaf('staff-leave-review','請假','leave.html?mode=approval&identity=staff'),
     leaf('staff-clock','打卡','clock-corrections-admin.html?identity=staff'),
     leaf('staff-temporary','臨時出勤','temporary-attendance-admin.html?identity=staff'),
     leaf('staff-profile','個資修改','profile-change-admin.html?identity=staff'),
     leaf('staff-registration','入職建檔','registration-approval.html?identity=staff')
    ]),
    leaf('staff-certificate','在職證明','employment-certificate-hub.html?identity=staff')
   ]),
   branch('parttime','工讀生',[
    leaf('parttime-mobile','手機版檢視','dashboard.html?preview=employee'),
    leaf('parttime-people','人員資料','employee-admin.html?type=parttime'),
    leaf('parttime-salary','薪資與投保','salary-admin.html?type=parttime'),
    leaf('parttime-settlement','薪資結算','data-center.html?module=parttime'),
    leaf('parttime-schedule','班表','schedule-admin.html'),
    leaf('parttime-leave','假勤制度','leave-policy-admin.html'),
    leaf('parttime-check','出勤核對','attendance-flow-check.html'),
    branch('parttime-attendance','簽核',[
     leaf('parttime-clock','打卡','clock-corrections-admin.html?identity=parttime'),
     leaf('parttime-temporary','臨時出勤','temporary-attendance-admin.html?identity=parttime'),
     leaf('parttime-leave-review','請假','leave.html?mode=approval&identity=parttime'),
     leaf('parttime-profile','個資修改','profile-change-admin.html?identity=parttime'),
     leaf('parttime-registration','入職建檔','registration-approval.html?identity=parttime')
    ]),
    leaf('parttime-certificate','在職證明','employment-certificate-hub.html?identity=parttime')
   ]),
   branch('external','外聘老師',[
    leaf('external-mobile','手機版檢視','dashboard.html?preview=teacher'),
    leaf('external-people','名單與資料','employee-admin.html?type=external&source=teacher-hub'),
    leaf('external-payroll','課務薪資','portal.html#course-teachers'),
    leaf('external-contract','合約與條款','external-teacher-admin.html?source=teacher-hub'),
    branch('external-approvals','簽核',[
     leaf('external-profile','個資修改','profile-change-admin.html?identity=external'),
     leaf('external-registration','合作建檔','registration-approval.html?identity=external'),
     leaf('external-contract-review','合約確認','external-teacher-admin.html?from=approval&filterStatus=submitted_pending_admin&source=teacher-hub')
    ]),
    branch('external-work','公告與協助',[
     leaf('external-announcement','老師公告','announcement-admin.html?audience=external&source=teacher-hub'),
     leaf('external-task','協助事項','task.html?mode=admin&identity=external&source=teacher-hub'),
     leaf('external-notification','通知設定','teacher-notification-settings.html')
    ]),
    leaf('external-goods','拿貨與詢價','teacher-goods-admin.html?source=teacher-hub'),
    leaf('external-forms','表單與證明','quotation-contract-hub.html?identity=external&source=teacher-hub')
   ],{common:[leaf('external-overview','老師總覽','teacher-hub.html')]}),
   branch('recruit','應聘與入職',[
    leaf('recruit-applications','應聘管理','application-admin.html'),
    leaf('recruit-registration','註冊建檔','registration-approval.html',{preferred:true}),
    leaf('recruit-notification','應聘通知設定','application-notification-settings.html')
   ])
  ],{badge:'badge-hr-payroll',common:[
   leaf('all-people','全體人員','employee-admin.html',{preferred:true}),
   leaf('all-schedule','共用班表','schedule-admin.html',{preferred:true}),
   leaf('all-leave','共用假勤制度','leave-policy-admin.html',{preferred:true}),
   leaf('people-sources','資料來源整理','person-data-admin.html'),
   leaf('people-binding','帳號綁定','line-binding-admin.html'),
   branch('approvals','全部簽核',groups.approval.links.filter(([,href])=>href!=='approval-hub.html').map(([label,href],i)=>leaf('approval-'+i,label,href,{preferred:true}))),
   leaf('people-approval-notifications','簽核提醒','approval-notification-settings.html')
   ,branch('approval-unclassified','待分類簽核',[
    leaf('unclassified-leave','請假','leave.html?mode=approval&identity=unknown'),
    leaf('unclassified-clock','打卡','clock-corrections-admin.html?identity=unknown'),
    leaf('unclassified-temporary','臨時出勤','temporary-attendance-admin.html?identity=unknown'),
    leaf('unclassified-profile','個資修改','profile-change-admin.html?identity=unknown'),
    leaf('unclassified-registration','入職建檔','registration-approval.html?identity=unknown')
   ])
  ]}),
  branch('work','日常工作',[
   leaf('work-announcements','公告','announcement-admin.html'),
   leaf('work-tasks','交辦事項','task.html?mode=admin'),
   leaf('work-routines','定期事項','routine.html?mode=admin'),
   leaf('work-training','教育訓練','training-admin.html'),
   leaf('work-employee','員工服務入口','dashboard.html')
  ],{badge:'badge-items',common:[leaf('work-notifications','通知設定','notification-settings.html'),leaf('work-line','通知檢查','line-notification-check.html')]}),
  branch('rental','租賃',[
   leaf('rental-applications','申請與契約','rental-admin.html'),
   leaf('rental-template','契約模板','rental-template-settings.html'),
   leaf('rental-fees','費用與提醒','rental-settings.html'),
   leaf('rental-print','合約列印','rental-contract-admin.html'),
   leaf('rental-preview','客人填寫入口','rental-order.html')
  ],{badge:'badge-rental',common:[leaf('rental-email','Email 檢查','email-send-check.html')]}),
  branch('forms','表單與證明',[
   branch('gift','集點卡',[leaf('gift-print','列印／儲存圖片','gift-point-card.html?source=forms'),leaf('gift-settings','版面設定','gift-point-card-admin.html')]),
   leaf('quotation','估價單','quotation-admin.html'),
   branch('employment','在職證明',[
    leaf('employment-issue','開立','employment-certificate-admin-issue.html'),
    leaf('employment-review','審核','certificate-review-admin.html?type=employment'),
    leaf('employment-history','歷史紀錄','certificate-history-admin.html?type=employment'),
    leaf('employment-template','範本設定','employment-certificate-admin.html')
   ]),
   branch('teaching','教學證明',[
    leaf('teaching-issue','開立','teaching-certificate-admin-issue.html'),
    leaf('teaching-review','審核','certificate-review-admin.html?type=teaching'),
    leaf('teaching-history','歷史紀錄','certificate-history-admin.html?type=teaching'),
    leaf('teaching-template','範本設定','teaching-certificate-admin.html')
   ])
  ],{badge:'badge-forms',common:[leaf('forms-overview','表單總覽','quotation-contract-hub.html'),leaf('forms-notification','證明提醒','certificate-notification-settings.html')]})
 ]);
 const treeIndex=new Map();
 function indexTree(node,parents){treeIndex.set(node.id,{node,path:parents.concat(node)});[...(node.children||[]),...(node.common||[])].forEach(child=>indexTree(child,parents.concat(node)));}
 indexTree(tree,[]);
 function treePath(id){return treeIndex.get(id)?.path||[];}
 function treeNode(id){return treeIndex.get(id)?.node||null;}
 function treeLink(node){
  if(node.children)return 'settings.html?ui=20261031-mobile1#'+node.id;
  const u=new URL(node.href,'https://workspace.invalid/');u.searchParams.set('nav',node.id);u.searchParams.set('ui','20261031-mobile1');
  return u.pathname.slice(1)+u.search+u.hash;
 }
 function pageContext(path,search,hash){
  const file=path.split('/').pop(),query=new URLSearchParams(search||'');
  function score(node){
   if(!node.href)return -1;
   const u=new URL(node.href,'https://workspace.invalid/');
   if(u.pathname.split('/').pop()!==file||u.hash&&u.hash!==hash)return -1;
   if(![...u.searchParams].every(([key,value])=>query.get(key)===value))return -1;
   return [...u.searchParams].length*10+(node.preferred?2:0);
  }
  const explicit=treeNode(query.get('nav'));
  if(explicit&&score(explicit)>=0)return treePath(explicit.id);
  const identity=query.get('identity');
  if(['staff','parttime','external'].includes(identity)&&groups.forms.pages.includes(file)){
   return treePath(identity==='external'?'external-forms':identity+'-certificate');
  }
  const candidates=[...treeIndex.values()].filter(item=>score(item.node)>=0).sort((a,b)=>score(b.node)-score(a.node));
  if(candidates.length)return candidates[0].path;
  const key=resolve(path,search);
  const base={hr:'people',teachers:'external',approval:'approvals',work:'work',rental:'rental',forms:'forms',employee:'work'}[key];
  return base?treePath(base):treePath('root');
 }
 const api={groups,resolve,tree,treePath,treeNode,treeLink,pageContext};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.InternalWorkspaceRoutes=api;
})(typeof window==='object'?window:this);
