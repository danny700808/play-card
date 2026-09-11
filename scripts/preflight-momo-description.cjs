// Platform-specific derivatives only: never overwrite source photographs.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('../functions/node_modules/sharp');
async function prepare(input,output){
 if(path.resolve(input)===path.resolve(output))throw Error('Original must be preserved');
 const original=await fs.readFile(input),meta=await sharp(original).metadata();
 const extension=path.extname(output).toLowerCase();
 const sameFormat=(meta.format==='jpeg'&&['.jpg','.jpeg'].includes(extension))||(meta.format==='png'&&extension==='.png');
 if(!['.jpg','.jpeg','.png'].includes(extension))throw Error('Output must be JPEG or PNG');
 let result=original.length<=480000&&meta.width<=1000&&meta.height<=1500&&sameFormat?original:null;
 if(!result&&extension==='.png')throw Error('Use a separate .jpg derivative for compression');
 for(const width of [Math.min(meta.width,1000),850,700,600].filter((x,i,a)=>x>0&&x<=meta.width&&a.indexOf(x)===i)){
  if(result)break;
  for(const quality of [90,85,80,75,70]){
   const bytes=await sharp(original).rotate().resize({width,height:1500,fit:'inside',withoutEnlargement:true}).jpeg({quality,mozjpeg:true}).toBuffer();
   if(bytes.length<=480000){result=bytes;break;}
  }if(result)break;
 }
 if(!result)throw Error('Cannot meet MOMO size without excessive compression; keep pending for review');
 await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,result);
 const info=await sharp(result).metadata();if(result.length>=500000)throw Error('MOMO size limit');
 return {input,output,originalSha256:crypto.createHash('sha256').update(original).digest('hex'),sha256:crypto.createHash('sha256').update(result).digest('hex'),sizeBytes:result.length,width:info.width,height:info.height,visualReviewRequired:true};
}
module.exports={prepare};
if(require.main===module)prepare(process.argv[2],process.argv[3]).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
