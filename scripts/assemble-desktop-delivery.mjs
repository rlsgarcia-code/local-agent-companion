// Assemble a verified subset of an existing signed release. Never rewrite its index.
import {createHash,verify} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {copyFile,lstat,mkdir,readFile,writeFile} from 'node:fs/promises';
import * as path from 'node:path';
const option=name=>process.argv.find(value=>value.startsWith(name+'='))?.slice(name.length+1);
const required=name=>{const value=option(name);if(!value)throw Error('Missing '+name);return path.resolve(value);};
const indexDirectory=required('--index-dir'),output=required('--output'),report=required('--report');
const publicKey=await readFile('release-keys/companion-ed25519.pub','utf8');
const raw=await readFile(path.join(indexDirectory,'companion-release.manifest.json'));
const signature=await readFile(path.join(indexDirectory,'companion-release.manifest.sig'));
if(!verify(null,raw,publicKey,signature))throw Error('Invalid original release signature.');
const index=JSON.parse(raw);
if(index.schema!==1||index.kind!=='companion-suite-candidate'||!/^[a-f0-9]{40}$/.test(index.commit))throw Error('Invalid original release index.');
const files=['--engine','--mac-app','--vsix','--sdk'].map(required);
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
const names=new Set();
for(const file of files){const name=path.basename(file),info=await lstat(file);if(names.has(name)||info.isSymbolicLink()||!info.isFile()||await digest(file)!==index.files[name])throw Error('Artifact not authorized by original index: '+name);names.add(name);}
const acceptance=JSON.parse(await readFile(report,'utf8'));
if(acceptance.engine!==index.engine||acceptance.engineCommit!==index.commit||acceptance.application!==index.application||acceptance.scope!=='companion-engine-mac-vscode')throw Error('Readiness report does not match the exact release.');
await mkdir(output,{mode:0o700});
for(const file of files)await copyFile(file,path.join(output,path.basename(file)));
await writeFile(path.join(output,'original-release.manifest.json'),raw);
await writeFile(path.join(output,'original-release.manifest.sig'),signature);
await writeFile(path.join(output,'readiness.json'),JSON.stringify(acceptance,null,2)+'\n');
const verifier=`// Read-only verification of the artifacts included in this desktop delivery.\nimport {createHash,verify} from 'node:crypto';\nimport {createReadStream} from 'node:fs';\nimport {readFile,lstat} from 'node:fs/promises';\nimport {fileURLToPath} from 'node:url';\nimport * as path from 'node:path';\nconst root=path.dirname(fileURLToPath(import.meta.url));\nconst key=${JSON.stringify(publicKey)};\nconst raw=await readFile(path.join(root,'original-release.manifest.json'));\nif(!verify(null,raw,key,await readFile(path.join(root,'original-release.manifest.sig'))))throw Error('Invalid original release signature');\nconst manifest=JSON.parse(raw);\nif(manifest.engine!==${JSON.stringify(index.engine)}||manifest.commit!==${JSON.stringify(index.commit)})throw Error('Unexpected release');\nfor(const name of ${JSON.stringify([...names])}){const file=path.join(root,name),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw Error('Invalid artifact');const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);if(h.digest('hex')!==manifest.files[name])throw Error('Artifact integrity failed: '+name);}\nconsole.log('DESKTOP_DELIVERY_VERIFIED '+manifest.engine+' '+manifest.application);\n`;
await writeFile(path.join(output,'verify-delivery.mjs'),verifier);
await writeFile(path.join(output,'LEIA-ME.txt'),`Companion: núcleo independente + Mac + VS Code\n\nMotor: ${index.engine}; aplicativos: ${index.application}; Node empacotado: ${index.node}.\nOrigem exata: ${index.commit}.\n\nMac: extraia o arquivo Local-Companion e abra Local Companion.app. O cliente Mac usa os modelos Ollama configurados neste Mac.\nVS Code: instale o VSIX incluído por Extensions > Install from VSIX. Esta é a variante OpenAI, que também preserva a configuração LiteLLM existente; chaves permanecem no Secret Storage do editor.\nMotor independente: o arquivo companion-engine contém Node, serviço e dependências. O arquivo companion-sdks fornece os clientes TypeScript/Python sem runtime de agente. O motor funciona sem iniciar as interfaces e sem KidOS.\n\nAs instalações já feitas neste Mac usam o mesmo motor. Fechar uma interface preserva o trabalho independente dela; recursos que exigem o editor aguardam sua reconexão. Históricos dos produtos ficam separados.\n\nIntegridade: node verify-delivery.mjs confere a assinatura do índice original e os quatro artefatos incluídos. Este kit é um subconjunto verificado da publicação original; o índice assinado foi preservado sem alterações. readiness.json é o relatório local de validação, não uma nova autorização de publicação.\n\nA versão anterior e os backups pessoais permanecem na máquina; eles não fazem parte deste kit. O aplicativo Mac tem assinatura Apple ad-hoc, sem notarização. A promoção da release final continua sujeita à revisão.\nKidOS está em espera e não é requisito desta entrega.\n`);
const checksums=[];for(const name of [...names,'original-release.manifest.json','original-release.manifest.sig','readiness.json','verify-delivery.mjs','LEIA-ME.txt'])checksums.push((await digest(path.join(output,name)))+'  '+name);
await writeFile(path.join(output,'SHA256SUMS'),checksums.join('\n')+'\n');
console.log('VERIFIED_DESKTOP_DELIVERY_READY',output);
