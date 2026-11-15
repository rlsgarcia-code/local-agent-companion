import {createHash} from 'node:crypto';
import {readFile,lstat,mkdir,copyFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

// Exact source-backed component exception, never a general MPL allowlist.
export async function inspectGameRasterizer(projectRoot=process.cwd()) {
  const root=path.join(projectRoot,'packages/adapter-game-assets'),lock=JSON.parse(await readFile(path.join(root,'rasterizer.lock.json'),'utf8'));
  if(lock.package!=='@resvg/resvg-wasm'||lock.version!=='2.6.2'||lock.license!=='MPL-2.0')throw Error('Unreviewed game rasterizer component.');
  const packageRoot=path.join(projectRoot,'node_modules/@resvg/resvg-wasm');
  const check=async(file,expected,size)=>{const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||(size!==undefined&&stat.size!==size)||createHash('sha256').update(await readFile(file)).digest('hex')!==expected)throw Error('Game rasterizer source, license or binary integrity mismatch.');};
  await check(path.join(packageRoot,'index_bg.wasm'),lock.wasm.sha256,lock.wasm.size);
  for(const [name,sha]of Object.entries(lock.packageFiles))await check(path.join(packageRoot,name),sha);
  await check(path.join(root,lock.source.path),lock.source.sha256,lock.source.size);
  await check(path.join(root,lock.licenseFile.path),lock.licenseFile.sha256);
  return {root,packageRoot,lock};
}

export async function copyGameRasterizer(destination,projectRoot=process.cwd()) {
  const {root,packageRoot,lock}=await inspectGameRasterizer(projectRoot);
  await mkdir(path.join(destination,'resvg-source/npm'),{recursive:true});
  await copyFile(path.join(packageRoot,'index_bg.wasm'),path.join(destination,'resvg.wasm'));
  for(const name of Object.keys(lock.packageFiles))await copyFile(path.join(packageRoot,name),path.join(destination,'resvg-source/npm',name));
  await copyFile(path.join(root,lock.source.path),path.join(destination,'resvg-source/source.tar.gz'));
  await copyFile(path.join(root,lock.licenseFile.path),path.join(destination,'resvg-source/LICENSE'));
  await copyFile(path.join(root,'rasterizer.lock.json'),path.join(destination,'resvg-source/manifest.json'));
  await writeFile(path.join(destination,'resvg-source/NOTICE.txt'),`@resvg/resvg-wasm ${lock.version}\nLicense: MPL-2.0; complete text in LICENSE.\nPublished Wasm and glue are used unchanged. The npm-published gitHead source is supplied in source.tar.gz; published glue and metadata are in npm/.\nSource code is available under MPL-2.0 at ${lock.source.url}\nThis inventory pins the published artifact and declared upstream source; it does not claim a reproducible Rust build or independent legal review.\nNo game code or generated media is included in this component notice.\n`);
}
