// Prepare a PRIVATE paired extension folder for this Windows host only.
// No Chrome profile, cookies, passwords or platform tokens are read.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const destination=process.argv[2],dataDir=process.argv[3];
if(!destination||!dataDir)throw Error('Usage: node prepare-delivery-reader.cjs <extension-folder> <host-data-folder>');
const source=path.resolve(__dirname,'../delivery-reader');
const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
const {publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const der=publicKey.export({type:'spki',format:'der'});
manifest.key=der.toString('base64');
const extensionId=[...crypto.createHash('sha256').update(der).digest().subarray(0,16)]
  .map(b=>String.fromCharCode(97+(b>>4),97+(b&15))).join('');
const token=crypto.randomBytes(32).toString('base64url');
fs.mkdirSync(destination,{recursive:true});fs.mkdirSync(dataDir,{recursive:true});
for(const name of ['background.js','reader.js'])fs.copyFileSync(path.join(source,name),path.join(destination,name));
fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2));
fs.writeFileSync(path.join(destination,'pairing.js'),'const YOUZI_DELIVERY_TOKEN='+JSON.stringify(token)+';\n');
fs.writeFileSync(path.join(dataDir,'delivery-bridge.json'),JSON.stringify({extensionId,token},null,2));
console.log('Prepared paired reader:',destination,'Extension:',extensionId);
