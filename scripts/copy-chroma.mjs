import {copyFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
export async function copyChroma(destination){
 const names={'darwin-arm64':'chromadb-js-bindings-darwin-arm64','darwin-x64':'chromadb-js-bindings-darwin-x64','linux-arm64':'chromadb-js-bindings-linux-arm64-gnu','linux-x64':'chromadb-js-bindings-linux-x64-gnu','win32-x64':'chromadb-js-bindings-win32-x64-msvc'};
 const name=names[`${process.platform}-${process.arch}`];if(!name)throw Error('Chroma is not packaged for this target.');
 const directory=path.join('node_modules',name),binary=(await readdir(directory)).find(name=>name.endsWith('.node'));
 if(!binary)throw Error('Bundled Chroma native binary is missing.');
 await mkdir(destination,{recursive:true});await copyFile(path.join(directory,binary),path.join(destination,'chromadb.node'));
 await copyFile('scripts/chroma-server.cjs',path.join(destination,'server.cjs'));return name;
}
