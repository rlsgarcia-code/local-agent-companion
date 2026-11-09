// Read-only audit of the exact engine installed with both desktop clients.
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import * as path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=name=>process.argv.find(value=>value.startsWith(name+'='))?.slice(name.length+1);
const required=name=>{const value=option(name);if(!value)throw Error('Missing '+name);return path.resolve(value);};
const standalone=required('--engine'),app=required('--app'),extension=required('--extension');
const key=await readFile(path.join(root,'release-keys/companion-ed25519.pub'),'utf8');
const compiled=await build({entryPoints:[path.join(root,'packages/client-ts/src/bootstrap.ts')],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};
new Function('module','exports','require',compiled.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url));
const results=[];
for(const [component,directory] of [['standalone',standalone],['mac',path.join(app,'Contents/Resources/companion-engine')],['vscode',path.join(extension,'dist/engine')]]){
  await module.exports.verifyBundle(directory,key,false);
  const bytes=await readFile(path.join(directory,'manifest.json')),manifest=JSON.parse(bytes);
  results.push({component,version:manifest.version,commit:manifest.commit,node:manifest.node,target:manifest.target,
    manifestSha256:createHash('sha256').update(bytes).digest('hex')});
}
if(new Set(results.map(result=>result.manifestSha256)).size!==1)throw Error('Installed clients do not use the identical signed engine.');
const extensionMetadata=JSON.parse(await readFile(path.join(extension,'package.json'),'utf8'));
const {stdout:macVersionText}=await promisify(execFile)('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',path.join(app,'Contents/Info.plist')]);
const macVersion=macVersionText.trim();
if(macVersion!==extensionMetadata.version)throw Error('Installed client application versions do not match.');
const report={state:'passed',engine:results[0].version,engineCommit:results[0].commit,
  extensionVersion:extensionMetadata.version,macVersion,components:results};
if(option('--report'))await writeFile(path.resolve(option('--report')),JSON.stringify(report,null,2)+'\n');
console.log('INSTALLED_DESKTOP_ENGINES_IDENTICAL '+report.engine+' '+report.engineCommit);
