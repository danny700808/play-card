'use strict';
// Read-only September validation. Only anonymous relationship flags are logged.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const report=console.log.bind(console);console.log=console.info=console.warn=console.error=()=>{};
const filename=path.resolve('functions/coursePortal.js'),backend=new Module(filename,module);
backend.filename=filename;backend.paths=Module._nodeModulePaths(path.dirname(filename));
backend._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports.audit={withPortalReads,scheduleBundle,eventBlocksResource,overlaps,sourceId};',filename);
const a=backend.exports.audit;
const auditPublicKey="-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAka2YscTx+e7H0+yrNcFk\nTQsiCoHTucHg/0LC5h1LrgCz3YInh2oV3as7k8Ynnz/XDquOVcaKlYD2VXxDavcz\nn69kp3G7L0CvmfoJr6xPRyEj1H2Plmkv4NcOtISLzkxvONyVdXEil8M6St6cs2HO\n3jFmTpI72tqOhjsp+TyShqPfAI91xDX396X/7A/rUsMOVl92c9PErPJDs2rf7zDW\nlpYJ5g+Pv3hWeeFrXFxmrIWjdnatd5bYp0O6eItv5K+QMMw9zZexhGggsMFFZbUT\nJhSvM3vhUoE1+3PvBM48pGo3m2D5i9UxX19WSn4lmSoi9wprQ1mJMW1afYaywI4R\n/7PQNAaEYzfFugBSfUq0NiccQf8KRdiAbpiZP/226YSDSmvgLIK9YxrPFBon+5q0\n2rAOQqTaKTW11+yEot2sfqNQwezR1xYRDb4jxzp3eMta8aA5LZxv7vZTd5XuIbqP\nUrixuCUWqXX2i/DicJEUj0cTbaCCwq0Y60CiF1cfE7LVAgMBAAE=\n-----END PUBLIC KEY-----\n";
const privateReport=value=>{const c=require('crypto'),key=c.randomBytes(32),iv=c.randomBytes(12),cipher=c.createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);report('PRIVATE_AUDIT '+JSON.stringify({key:c.publicEncrypt({key:auditPublicKey,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}));};
async function main(){
 const bundle=await a.scheduleBundle('2026-10-08','2026-10-08','',{adminWrite:true,studentIds:[]});
 const rooms=bundle.rooms.map(r=>({id:a.sourceId(r),name:r.name}));
 const events=bundle.resourceEvents.filter(r=>a.overlaps('18:00','20:00',r.startTime,r.endTime));
 privateReport({rooms,events:events.map(r=>({...r,blocks:a.eventBlocksResource(r)}))});
 report('Read-only rental occupancy audit complete.');
}
a.withPortalReads(main)().catch(()=>{report('Read-only audit failed.');process.exitCode=1;});
