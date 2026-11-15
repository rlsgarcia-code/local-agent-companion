import {readFile,copyFile,mkdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
// Fixed packaged data only. Never copy an upstream tree or fetch during a build.
export async function copyGameLibraries(destination){
  const root=path.resolve('packages/adapter-game-library/libraries'),files=new Map();
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  async function bytes(relative,max){
    let target=root;
    for(const part of relative.split('/')){if(!part||part==='.'||part==='..'||part.includes('\\'))throw Error('Unsafe library packaging path');target=path.join(target,part);if((await lstat(target)).isSymbolicLink())throw Error('Linked library packaging input');}
    const stat=await lstat(target);if(!stat.isFile()||stat.nlink!==1||stat.size<1||stat.size>max)throw Error('Invalid library packaging file');
    const raw=await readFile(target);if(raw.length!==stat.size)throw Error('Library packaging input changed');files.set(relative,target);return raw;
  }
  const index=JSON.parse((await bytes('index.json',64*1024)).toString());
  if(index.schemaVersion!==1||!Array.isArray(index.libraries)||!index.libraries.length||index.libraries.length>30)throw Error('Invalid library packaging registry');
  let total=0;
  for(const item of index.libraries){
    if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(item.id)||!/^[a-f0-9]{64}$/.test(item.manifestSha256))throw Error('Invalid library identity');
    const raw=await bytes(`${item.id}/manifest.json`,2*1024*1024);if(sha(raw)!==item.manifestSha256)throw Error('Library manifest hash differs from registry');
    const manifest=JSON.parse(raw.toString());if(manifest.schemaVersion!==1||manifest.library.id!==item.id||!Array.isArray(manifest.entries))throw Error('Invalid library manifest');
    for(const entry of manifest.entries)for(const file of entry.files){
      if(!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isInteger(file.size)||file.size<1||file.size>64*1024*1024)throw Error('Invalid library blob declaration');
      const name=`${item.id}/blobs/${file.sha256}`;if(files.has(name))continue;total+=file.size;if(total>256*1024*1024)throw Error('Library packaging budget exceeded');
      const data=await bytes(name,file.size);if(data.length!==file.size||sha(data)!==file.sha256)throw Error('Library blob integrity mismatch');
    }
    for(const notice of manifest.library.licenseFiles){
      if(typeof notice!=='string'||notice.split('/').some(part=>!part||part==='.'||part==='..'||part.includes('\\')))throw Error('Invalid library notice path');
      const declaration=manifest.entries[0].files.find(file=>file.path===notice&&file.mime==='text/plain');if(!declaration)throw Error('Missing complete library notice');
      files.set(`${item.id}/notices/${notice}`,files.get(`${item.id}/blobs/${declaration.sha256}`));
    }
  }
  for(const [relative,source] of files){const target=path.join(destination,...relative.split('/'));await mkdir(path.dirname(target),{recursive:true});await copyFile(source,target);}
  await copyFile('packages/adapter-game-library/upstream.lock.json',path.join(destination,'upstream.lock.json'));
}
