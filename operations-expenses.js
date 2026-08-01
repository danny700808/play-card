(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.YouziOperatingExpenses=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const DEFAULT_START_MONTH='2026-07';
  const DEFAULT_CLOSED_WEEKDAYS=[1]; // 星期一
  const DEFAULT_RECURRING_RULES=[
    {id:'rent',category:'房屋租金',amount:42500,startMonth:DEFAULT_START_MONTH,allocationMode:'monthly',active:true},
    {id:'yamaha-authorization',category:'Yamaha 授權費',amount:6500,startMonth:DEFAULT_START_MONTH,allocationMode:'monthly',active:true}
  ];
  const EXPENSE_CATEGORIES=[
    {id:'rent',label:'房屋租金',defaultMode:'monthly'},
    {id:'yamaha-authorization',label:'Yamaha 授權費',defaultMode:'monthly'},
    {id:'electricity',label:'電費',defaultMode:'bimonthly'},
    {id:'water',label:'水費',defaultMode:'monthly'},
    {id:'phone-internet',label:'電話／網路費',defaultMode:'monthly'},
    {id:'payroll',label:'薪資',defaultMode:'monthly'},
    {id:'labor-insurance',label:'勞保公司負擔',defaultMode:'monthly'},
    {id:'health-insurance',label:'健保公司負擔',defaultMode:'monthly'},
    {id:'labor-pension',label:'勞退公司提繳',defaultMode:'monthly'},
    {id:'occupational-insurance',label:'職災保險',defaultMode:'monthly'},
    {id:'accounting',label:'會計／記帳費',defaultMode:'monthly'},
    {id:'marketing',label:'廣告／行銷費',defaultMode:'actual'},
    {id:'software',label:'軟體／雲端訂閱',defaultMode:'monthly'},
    {id:'bank-fee',label:'銀行／刷卡手續費',defaultMode:'actual'},
    {id:'cleaning',label:'清潔／垃圾處理費',defaultMode:'actual'},
    {id:'supplies',label:'文具／印刷／教學耗材',defaultMode:'actual'},
    {id:'maintenance',label:'維修保養費',defaultMode:'actual'},
    {id:'transport',label:'運費／油資／停車費',defaultMode:'actual'},
    {id:'insurance',label:'公共意外／設備保險',defaultMode:'monthly'},
    {id:'tax',label:'稅費',defaultMode:'actual'},
    {id:'other',label:'其他支出',defaultMode:'actual'}
  ];

  function clean(value){return String(value==null?'':value).trim();}
  function integerAmount(value){
    const number=Number(value);
    return Number.isFinite(number)?Math.max(0,Math.floor(number)):0;
  }
  function pad(value){return String(value).padStart(2,'0');}
  function validMonth(value){return /^\d{4}-(0[1-9]|1[0-2])$/.test(clean(value));}
  function validDateKey(value){return /^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/.test(clean(value));}
  function dateKeyFromValue(value){
    if(value&&typeof value.toDate==='function')value=value.toDate();
    if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.getFullYear()+'-'+pad(value.getMonth()+1)+'-'+pad(value.getDate());
    const text=clean(value);
    const match=text.match(/^(\d{4}-\d{2}-\d{2})/);
    if(match&&validDateKey(match[1]))return match[1];
    const parsed=new Date(text);
    return Number.isNaN(parsed.getTime())?'':dateKeyFromValue(parsed);
  }
  function monthFromValue(value){
    const date=dateKeyFromValue(value);
    return date?date.slice(0,7):(validMonth(value)?clean(value):'');
  }
  function parseMonth(value){
    if(!validMonth(value))return null;
    const parts=clean(value).split('-').map(Number);
    return {year:parts[0],month:parts[1]};
  }
  function monthIndex(value){const part=parseMonth(value);return part?part.year*12+part.month-1:null;}
  function monthFromIndex(index){const year=Math.floor(index/12),month=index-year*12+1;return year+'-'+pad(month);}
  function nextMonth(value,step){const index=monthIndex(value);return index==null?'':monthFromIndex(index+(Number(step)||1));}
  function compareMonth(a,b){const ai=monthIndex(a),bi=monthIndex(b);return ai==null||bi==null?0:ai-bi;}
  function monthKeysBetween(startMonth,endMonth){
    const start=monthIndex(startMonth),end=monthIndex(endMonth);
    if(start==null||end==null||start>end)return [];
    const rows=[];
    for(let index=start;index<=end;index+=1)rows.push(monthFromIndex(index));
    return rows;
  }
  function daysInMonth(value){const part=parseMonth(value);return part?new Date(part.year,part.month,0).getDate():0;}
  function operatingDateKeys(value,closedWeekdays){
    const part=parseMonth(value);if(!part)return [];
    const closed=new Set((Array.isArray(closedWeekdays)?closedWeekdays:DEFAULT_CLOSED_WEEKDAYS).map(Number));
    const rows=[];
    for(let day=1;day<=daysInMonth(value);day+=1){
      const date=new Date(part.year,part.month-1,day);
      if(!closed.has(date.getDay()))rows.push(part.year+'-'+pad(part.month)+'-'+pad(day));
    }
    return rows;
  }
  function allocateMonthlyAmount(value,month,closedWeekdays){
    const total=integerAmount(value),dates=operatingDateKeys(month,closedWeekdays);
    if(!total||!dates.length)return [];
    const base=Math.floor(total/dates.length),remainder=total-(base*dates.length);
    return dates.map(function(dateKey,index){return {dateKey:dateKey,amount:base+(index===0?remainder:0)};});
  }
  function defaultRules(){return DEFAULT_RECURRING_RULES.map(function(row){return Object.assign({monthlyOverrides:[]},row);});}
  function normalizeMonthlyOverrides(value,fallbackMode){
    const byMonth=new Map();
    (Array.isArray(value)?value:[]).forEach(function(row){
      const month=clean(row&&row.month);
      if(validMonth(month))byMonth.set(month,{month:month,amount:integerAmount(row&&row.amount),mode:normalizeExpenseMode(row&&(row.mode||row.allocationMode)||fallbackMode||'monthly')});
    });
    return Array.from(byMonth.values()).sort(function(a,b){return a.month.localeCompare(b.month);});
  }
  function normalizeRule(row,fallback){
    const source=row&&typeof row==='object'?row:{},base=fallback||{};
    const allocationMode=normalizeExpenseMode(source.allocationMode==null?(base.allocationMode||'monthly'):source.allocationMode);
    return {
      id:clean(source.id)||clean(base.id),
      category:clean(source.category)||clean(base.category)||'其他支出',
      amount:integerAmount(source.amount==null?base.amount:source.amount),
      startMonth:validMonth(source.startMonth)?clean(source.startMonth):(validMonth(base.startMonth)?clean(base.startMonth):DEFAULT_START_MONTH),
      endMonth:validMonth(source.endMonth)?clean(source.endMonth):'',
      active:source.active==null?base.active!==false:source.active!==false,
      note:clean(source.note==null?base.note:source.note),
      allocationMode:allocationMode,
      monthlyOverrides:normalizeMonthlyOverrides(source.monthlyOverrides==null?base.monthlyOverrides:source.monthlyOverrides,allocationMode)
    };
  }
  function normalizeSettings(raw){
    const source=raw&&typeof raw==='object'?raw:{};
    const provided=Array.isArray(source.recurringRules)?source.recurringRules:[];
    const byId=new Map(provided.map(function(row){return [clean(row&&row.id),row];}));
    const rules=defaultRules().map(function(fallback){return normalizeRule(byId.get(fallback.id),fallback);});
    provided.forEach(function(row){if(clean(row&&row.id)&&!rules.some(function(rule){return rule.id===clean(row.id);}))rules.push(normalizeRule(row));});
    const weekdays=Array.isArray(source.closedWeekdays)&&source.closedWeekdays.length?source.closedWeekdays.map(Number).filter(function(day){return day>=0&&day<=6;}):DEFAULT_CLOSED_WEEKDAYS.slice();
    return {
      startMonth:validMonth(source.startMonth)?clean(source.startMonth):DEFAULT_START_MONTH,
      closedWeekdays:Array.from(new Set(weekdays)),
      recurringRules:rules
    };
  }
  function effectiveRuleForMonth(ruleValue,month){
    const rule=normalizeRule(ruleValue),selected=clean(month);
    if(!validMonth(selected)||!rule.active||compareMonth(selected,rule.startMonth)<0||(rule.endMonth&&compareMonth(selected,rule.endMonth)>0)){
      return Object.assign({},rule,{amount:0,sourceMonth:'',changedThisMonth:false,available:false});
    }
    let amount=rule.allocationMode==='monthly'||selected===rule.startMonth?rule.amount:0,allocationMode=rule.allocationMode,sourceMonth=rule.startMonth,changedThisMonth=selected===rule.startMonth;
    rule.monthlyOverrides.forEach(function(row){
      const comparison=compareMonth(row.month,selected);
      if(comparison===0){amount=row.amount;allocationMode=row.mode;sourceMonth=row.month;changedThisMonth=true;}
      else if(comparison<0&&row.mode==='monthly'){amount=row.amount;allocationMode=row.mode;sourceMonth=row.month;changedThisMonth=false;}
    });
    return Object.assign({},rule,{amount:amount,allocationMode:allocationMode,sourceMonth:sourceMonth,changedThisMonth:changedThisMonth,available:true});
  }
  function recurringRulesForMonth(settings,month,includeZero){
    const normalized=normalizeSettings(settings);
    return normalized.recurringRules.map(function(rule){return effectiveRuleForMonth(rule,month);}).filter(function(rule){return rule.available&&(includeZero!==false||rule.amount>0);});
  }
  function rowInRange(row,startKey,endKey){return (!startKey||row.dateKey>=startKey)&&(!endKey||row.dateKey<=endKey);}
  function recurringLedgerRows(settings,startValue,endValue){
    const normalized=normalizeSettings(settings),startKey=dateKeyFromValue(startValue),endKey=dateKeyFromValue(endValue);
    if(!startKey||!endKey||startKey>endKey)return [];
    const selectedStart=startKey.slice(0,7),selectedEnd=endKey.slice(0,7),rows=[];
    normalized.recurringRules.forEach(function(rule){
      if(!rule.active)return;
      const first=compareMonth(rule.startMonth,selectedStart)>0?rule.startMonth:selectedStart;
      const last=rule.endMonth&&compareMonth(rule.endMonth,selectedEnd)<0?rule.endMonth:selectedEnd;
      if(compareMonth(first,last)>0)return;
      monthKeysBetween(first,last).forEach(function(month){
        const effective=effectiveRuleForMonth(rule,month);
        if(!effective.available||!effective.amount)return;
        allocateMonthlyAmount(effective.amount,month,normalized.closedWeekdays).forEach(function(day){
          const modeLabel=effective.allocationMode==='monthly'?'每月延續支出':effective.allocationMode==='bimonthly'?'兩月帳單分攤':'本月支出';
          const row={dateKey:day.dateKey,amount:day.amount,category:effective.category,sourceType:'recurring',sourceId:effective.id,expenseMonth:month,allocationMode:effective.allocationMode,paymentDateKey:'',note:[modeLabel,effective.allocationMode==='monthly'?'自 '+effective.sourceMonth+' 起沿用':'只歸屬 '+month,'星期一不分攤',effective.note].filter(Boolean).join('；')};
          if(rowInRange(row,startKey,endKey))rows.push(row);
        });
      });
    });
    return rows;
  }
  function normalizeExpenseMode(value){return ['actual','monthly','bimonthly'].includes(clean(value))?clean(value):'actual';}
  function manualExpenseLedgerRows(expenses,settings,startValue,endValue){
    const normalized=normalizeSettings(settings),startKey=dateKeyFromValue(startValue),endKey=dateKeyFromValue(endValue),rows=[];
    if(!startKey||!endKey||startKey>endKey)return rows;
    (Array.isArray(expenses)?expenses:[]).forEach(function(expense){
      const total=integerAmount(expense&&expense.amount);if(!total)return;
      const mode=normalizeExpenseMode(expense&&expense.allocationMode),paymentDateKey=dateKeyFromValue(expense&&expense.occurredAt),category=clean(expense&&expense.category)||'其他支出',id=clean(expense&&(expense.id||expense.expenseNo));
      function addMonthly(amount,month,portionNote){
        if(!validMonth(month)||compareMonth(month,normalized.startMonth)<0)return;
        allocateMonthlyAmount(amount,month,normalized.closedWeekdays).forEach(function(day){
          const row={dateKey:day.dateKey,amount:day.amount,category:category,sourceType:'manual',sourceId:id,expenseMonth:month,allocationMode:mode,paymentDateKey:paymentDateKey,note:[clean(expense&&expense.note),portionNote].filter(Boolean).join('｜')};
          if(rowInRange(row,startKey,endKey))rows.push(row);
        });
      }
      if(mode==='monthly'){
        addMonthly(total,validMonth(expense.expenseMonth)?expense.expenseMonth:monthFromValue(expense.occurredAt),'按月分攤；星期一不分攤');
        return;
      }
      if(mode==='bimonthly'){
        const first=validMonth(expense.periodStartMonth)?clean(expense.periodStartMonth):'',second=validMonth(expense.periodEndMonth)?clean(expense.periodEndMonth):'';
        if(!first||!second)return;
        const base=Math.floor(total/2),remainder=total-(base*2);
        addMonthly(base+remainder,first,'兩月帳單前月分攤；星期一不分攤');
        addMonthly(base,second,'兩月帳單後月分攤；星期一不分攤');
        return;
      }
      if(paymentDateKey&&paymentDateKey>=normalized.startMonth+'-01'){
        const row={dateKey:paymentDateKey,amount:total,category:category,sourceType:'manual',sourceId:id,expenseMonth:paymentDateKey.slice(0,7),allocationMode:'actual',paymentDateKey:paymentDateKey,note:clean(expense&&expense.note)};
        if(rowInRange(row,startKey,endKey))rows.push(row);
      }
    });
    return rows;
  }
  function buildLedger(options){
    const opts=options||{},rows=recurringLedgerRows(opts.settings,opts.start,opts.end).concat(manualExpenseLedgerRows(opts.expenses,opts.settings,opts.start,opts.end));
    return rows.sort(function(a,b){return a.dateKey.localeCompare(b.dateKey)||a.category.localeCompare(b.category)||a.sourceId.localeCompare(b.sourceId);});
  }
  function summarizeByCategory(rows){
    const map=new Map();
    (rows||[]).forEach(function(row){map.set(row.category,Number(map.get(row.category)||0)+Number(row.amount||0));});
    return Array.from(map.entries()).map(function(entry){return {category:entry[0],amount:entry[1]};}).sort(function(a,b){return b.amount-a.amount||a.category.localeCompare(b.category);});
  }
  function categoryByLabel(label){return EXPENSE_CATEGORIES.find(function(row){return row.label===clean(label);})||null;}

  return Object.freeze({
    DEFAULT_START_MONTH:DEFAULT_START_MONTH,
    DEFAULT_CLOSED_WEEKDAYS:DEFAULT_CLOSED_WEEKDAYS.slice(),
    DEFAULT_RECURRING_RULES:defaultRules(),
    EXPENSE_CATEGORIES:EXPENSE_CATEGORIES.map(function(row){return Object.assign({},row);}),
    integerAmount:integerAmount,
    dateKeyFromValue:dateKeyFromValue,
    monthFromValue:monthFromValue,
    validMonth:validMonth,
    nextMonth:nextMonth,
    monthKeysBetween:monthKeysBetween,
    operatingDateKeys:operatingDateKeys,
    allocateMonthlyAmount:allocateMonthlyAmount,
    normalizeMonthlyOverrides:normalizeMonthlyOverrides,
    normalizeSettings:normalizeSettings,
    effectiveRuleForMonth:effectiveRuleForMonth,
    recurringRulesForMonth:recurringRulesForMonth,
    normalizeExpenseMode:normalizeExpenseMode,
    recurringLedgerRows:recurringLedgerRows,
    manualExpenseLedgerRows:manualExpenseLedgerRows,
    buildLedger:buildLedger,
    summarizeByCategory:summarizeByCategory,
    categoryByLabel:categoryByLabel
  });
});
