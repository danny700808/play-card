'use strict';
const fs=require('fs');
const path='.github/scripts/extend-rental-attendance-bonus.cjs';
let s=fs.readFileSync(path,'utf8');
const needle="  write(p,s);\n }\n\n{\n let p='room-booking.html'";
if(!s.includes(needle)) throw new Error('target not found');
s=s.replace(needle,"  write(p,s);\n }\n}\n\n{\n let p='room-booking.html'");
fs.writeFileSync(path,s);
console.log('fixed');