import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,readdir,readFile} from 'node:fs/promises';
import * as path from 'node:path';
import yauzl from 'yauzl';

/** Verify the actual installed payload, including native engine files, against the supplied VSIX. */
export async function installedVSIXDirectory(archive,directory){
  const expected=new Map();let packageJson;
  await new Promise((resolve,reject)=>yauzl.open(archive,{lazyEntries:true},(error,zip)=>{
    if(error)return reject(error);
    const fail=error=>{zip.close();reject(error);};
    zip.on('error',fail);zip.on('end',resolve);
    zip.on('entry',entry=>{
      if(!entry.fileName.startsWith('extension/')||entry.fileName.endsWith('/'))return zip.readEntry();
      const name=entry.fileName.slice('extension/'.length);
      if(!name||name.includes('\\')||name.split('/').some(part=>!part||part==='.'||part==='..')||path.isAbsolute(name)||expected.has(name)||((entry.externalFileAttributes>>>16)&0o170000)===0o120000)
        return fail(new Error('Unsafe VSIX payload entry'));
      zip.openReadStream(entry,(error,stream)=>{
        if(error)return fail(error);
        void (async()=>{
          const hash=createHash('sha256'),parts=[];
          for await(const block of stream){hash.update(block);if(name==='package.json')parts.push(block);}
          if(name==='package.json')packageJson=JSON.parse(Buffer.concat(parts).toString());
          expected.set(name,hash.digest('hex'));zip.readEntry();
        })().catch(fail);
      });
    });zip.readEntry();
  }));
  if(!packageJson||!expected.has('dist/extension.js'))throw new Error('VSIX lacks its extension payload');
  let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch{return undefined;}
  const normalize=value=>{const {__metadata,...manifest}=value;return manifest;};
  for(const entry of entries){
    if(!entry.isDirectory())continue;
    const root=path.join(directory,entry.name);
    try{
      const packageFile=path.join(root,'package.json');
      if((await lstat(packageFile)).isSymbolicLink())continue;
      const installed=JSON.parse(await readFile(packageFile,'utf8'));
      if(installed.name!==packageJson.name||installed.publisher!==packageJson.publisher||installed.version!==packageJson.version)continue;
      const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
      if(JSON.stringify(canonical(normalize(installed)))!==JSON.stringify(canonical(normalize(packageJson))))continue;
      for(const [name,digest] of expected){
        let file=root;for(const segment of name.split('/')){file=path.join(file,segment);if((await lstat(file)).isSymbolicLink())throw Error('Installed payload contains a link');}
        if(!(await lstat(file)).isFile())throw Error('Installed payload is incomplete');
        if(name==='package.json')continue; // VS Code adds __metadata; compared structurally above.
        const hash=createHash('sha256');for await(const block of createReadStream(file))hash.update(block);
        if(hash.digest('hex')!==digest)throw Error('Installed payload differs from the exact VSIX');
      }
      return root;
    }catch{ /* An incomplete, linked or modified installation is never accepted. */ }
  }
  return undefined;
}
