import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

/** Offline UI dependency, pinned by the same lock as production builds. */
export async function copyGameModelRuntime(destination){
  const source=path.resolve('packages/adapter-game-web'),lock=JSON.parse(await readFile(path.join(source,'runtime.lock.json'),'utf8'));
  const engine=lock.engines.find(item=>item.engine==='babylon');
  if(!engine||!engine.plugins.some(item=>item.module==='babylonjs-loaders/glTF/2.0'))throw Error('The model viewer requires its pinned Babylon/glTF2 runtime.');
  await mkdir(destination,{recursive:true});
  for(const [name,expected] of Object.entries(engine.files)){
    if(path.basename(name)!==name)throw Error('Invalid installed model runtime path.');
    const file=path.join(source,'runtimes',name),bytes=await readFile(file);
    if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error(`Model runtime integrity mismatch: ${name}`);
    await copyFile(file,path.join(destination,name));
  }
  await writeFile(path.join(destination,'runtime.lock.json'),JSON.stringify({schemaVersion:1,engines:[engine]},null,2)+'\n');
}
