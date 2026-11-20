// Synthetic format fixtures only. No Unity scene, runnable player or QA evidence.
import {UNITY_VERSION} from '../packages/adapter-game-unity/src/project';
export function unityDataFixture(rows=[{path:'Resources/example',data:Buffer.from('Synthetic payload; not Unity game content')}]){
 const prefix=Buffer.from('UnityWebData1.0\0'),headerSize=prefix.length+4+rows.reduce((total,row)=>total+12+Buffer.byteLength(row.path),0),header=Buffer.alloc(headerSize);prefix.copy(header);header.writeUInt32LE(headerSize,prefix.length);
 let cursor=prefix.length+4,offset=headerSize;for(const row of rows){const name=Buffer.from(row.path);header.writeUInt32LE(offset,cursor);header.writeUInt32LE(row.data.length,cursor+4);header.writeUInt32LE(name.length,cursor+8);name.copy(header,cursor+12);cursor+=12+name.length;offset+=row.data.length;}
 return Buffer.concat([header,...rows.map(row=>row.data)]);
}
export function unityTarFixture(files:[string,Buffer,string?][]){
 const parts:Buffer[]=[];
 for(const [name,data,type='0']of files){const header=Buffer.alloc(512);header.write(name,0,100);header.write('0000644\0',100);header.write('0000000\0',108);header.write('0000000\0',116);header.write(data.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header.write(type,156);header.write('ustar\0',257);header.write(header.reduce((total,byte)=>total+byte,0).toString(8).padStart(6,'0')+'\0 ',148);parts.push(header,data,Buffer.alloc((512-data.length%512)%512));}
 return Buffer.concat([...parts,Buffer.alloc(1024)]);
}
export function unityOutputFixture(dimension:'2d'|'3d'='2d'){
 const settings={schemaVersion:1 as const,engineVersion:UNITY_VERSION,dimension,scenes:['Assets/Scenes/Opening.unity','Assets/Scenes/Game.unity']};
 const report={schemaVersion:1,engineVersion:UNITY_VERSION,target:'web',result:'succeeded',failureCode:'',sceneCount:2,errors:0,warnings:1,bytes:1};
 const files:[string,Buffer,string?][]=[['index.html',Buffer.from('<!doctype html><script>throw new Error("MUST_NOT_EXECUTE")</script>')],['Build/output.loader.js',Buffer.from('globalThis.__unityFixtureExecuted = true;')],['Build/output.framework.js',Buffer.from('throw Error("MUST_NOT_EXECUTE");')],['Build/output.wasm',Buffer.from([0,97,115,109,1,0,0,0])],['Build/output.data',unityDataFixture()],['StreamingAssets/áudio.bin',Buffer.from([0,1,2])],['TemplateData/example.css',Buffer.from('/* Synthetic template metadata */')]];
 return {settings,report,files,archive:()=>unityTarFixture(files),diagnostic:()=>Buffer.from(JSON.stringify(report)+'\n')};
}
