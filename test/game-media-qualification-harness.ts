/** Only the explicit offline container may invoke this fixture wrapper. */
import assert from "node:assert/strict";
import { access,readFile } from "node:fs/promises";
import { prepareMediaFixtures,inspectMediaFixtures } from "./game-media-fixtures";
const root="/qualification";
async function main(){
  if(process.platform!=='linux'||process.getuid?.()!==1000||process.env.KIDOS_DISPOSABLE_MEDIA_QUALIFICATION!=='1')throw Error('Only the disposable media fixture UID may use this harness.');
  await access('/.dockerenv');assert.equal(await readFile(root+'/.media-only','utf8'),'disposable-media-only\n');
  const action=process.argv[2];if(action==='--prepare')await prepareMediaFixtures(root);else if(action==='--inspect')process.stdout.write(JSON.stringify(await inspectMediaFixtures(root))+'\n');else throw Error('No generic fixture operation.');
}
void main().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
