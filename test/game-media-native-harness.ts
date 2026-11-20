/** Synthetic media only; no engine installer or product entrypoint. */
import { lstat,readFile,realpath } from "node:fs/promises";
import path from "node:path";
import { prepareMediaFixtures,inspectMediaFixtures } from "./game-media-fixtures";

async function main(){
  const root=process.argv[3];
  if(process.platform!=='linux'||process.env.KIDOS_NATIVE_MEDIA_QUALIFICATION!=='1'||!root||
      !/^\/tmp\/kidos-native-media-[a-f0-9]{32}$/.test(root)||await realpath(root)!==root)
    throw Error('Select only the explicit private temporary native media fixture.');
  const info=await lstat(root);
  if(!info.isDirectory()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0)throw Error('Private fixture ownership required.');
  const marker=JSON.parse(await readFile(path.join(root,'fixture.json'),'utf8'));
  if(marker.scope!=='temporary-native-media-qualification'||marker.schema!==1)throw Error('Wrong qualification marker.');
  if(process.argv[2]==='--prepare')await prepareMediaFixtures(root);
  else if(process.argv[2]==='--inspect')process.stdout.write(JSON.stringify(await inspectMediaFixtures(root))+'\n');
  else throw Error('No generic fixture operation.');
}
void main().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
