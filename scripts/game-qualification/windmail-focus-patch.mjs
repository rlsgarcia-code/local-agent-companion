// Player-facing focus correction on an exact revision54 qualification copy.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export async function windmailFocusIntegration(files){
 const old=files.get('src/ui.ts');assert.equal(createHash('sha256').update(old).digest('hex'),'3d4aa1f5f93cb32e534a605aae51f23068dc6ffbaac8cd611d54d6879cc36392');
 return new Map([['src/ui.ts',await readFile(new URL('../../examples/game-integrations/windmail-focus/recovery.ts',import.meta.url))]]);
}
