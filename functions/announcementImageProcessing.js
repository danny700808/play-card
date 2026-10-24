'use strict';
async function prepare(bytes){
  const sharp=require('sharp'),options={limitInputPixels:60000000};
  const metadata=await sharp(bytes,options).metadata();
  if(!['jpeg','png','webp'].includes(metadata.format))throw Error('Unsupported image');
  for(const width of [2048,1600,1280])for(const quality of [82,72]){
    const output=await sharp(bytes,options).rotate().resize({width,height:width,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality}).toBuffer();
    // One URL can safely serve both LINE's original and smaller preview image.
    if(output.length<=900*1024)return output;
  }
  throw Error('Image compression failed');
}
module.exports={prepare};
