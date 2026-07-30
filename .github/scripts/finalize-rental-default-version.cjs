'use strict';
const fs=require('fs');
const path='functions/coursePortal.js';
let source=fs.readFileSync(path,'utf8');
function req(oldValue,newValue,label){if(!source.includes(oldValue))throw new Error('Missing '+label);source=source.replace(oldValue,newValue);}
req("  if (typeof setting.rentable === 'boolean') return setting.rentable;\n  return roomKind(room, setting) === 'normal';","  if (setting.roomRulesVersion === 1 && typeof setting.rentable === 'boolean') return setting.rentable;\n  return roomKind(room, setting) === 'normal';",'rentable version');
req("  if (typeof setting.teacherSchedulable === 'boolean') return setting.teacherSchedulable;\n  return true;","  if (setting.roomRulesVersion === 1 && typeof setting.teacherSchedulable === 'boolean') return setting.teacherSchedulable;\n  return true;",'teacher schedulable version');
req("  if (setting.rentalFee !== undefined && setting.rentalFee !== null && setting.rentalFee !== '') {","  if (setting.roomRulesVersion === 1 && setting.rentalFee !== undefined && setting.rentalFee !== null && setting.rentalFee !== '') {",'fee version');
req("  const rows = snap.exists && Array.isArray(snap.data().items) ? snap.data().items : defaults;","  const saved = snap.exists ? snap.data() || {} : {};\n  const rows = saved.version === 3 && Array.isArray(saved.items) ? saved.items : defaults;",'use version');
req("  const raw = snap.exists ? snap.data() || {} : {};","  const saved = snap.exists ? snap.data() || {} : {};\n  const raw = saved.version === 3 ? saved : {};",'policy version');
req("    items,\n    updatedAt: FieldValue.serverTimestamp(),","    version: 3,\n    items,\n    updatedAt: FieldValue.serverTimestamp(),",'use save version');
req("    businessHours,\n    studentDiscountRate: 0.5,","    version: 3,\n    businessHours,\n    studentDiscountRate: 0.5,",'policy save version');
req("      kind: ['normal', 'video', 'holding'].includes(clean(row.kind)) ? clean(row.kind) : 'normal',","      roomRulesVersion: 1,\n      kind: ['normal', 'video', 'holding'].includes(clean(row.kind)) ? clean(row.kind) : 'normal',",'room save version');
fs.writeFileSync(path,source);
console.log('Rental defaults versioned.');