// Explicit administrative provisioning from already-downloaded verified inputs.
// Never imported/called by inference, clients or a project recipe.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile, lstat, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const argument=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const lock=JSON.parse(await readFile(path.join(root,"packages/adapter-game-blender/toolchain.lock.json"),"utf8"));
const inputs=path.resolve(argument("--inputs",path.join(root,`.cache/game-editor-inputs/blender-${lock.version}`)));
const output=path.resolve(argument("--output",path.join(root,".cache/game-toolchains/blender.json")));
const docker=argument("--docker",process.platform==="darwin"?"/usr/local/bin/docker":"/usr/bin/docker");
const hash=(data)=>createHash("sha256").update(data).digest("hex");
const canonical=(value)=>JSON.stringify(value,(_key,item)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map((key)=>[key,item[key]])):item);
const local=(host)=>/^(?:unix:\/\/\/|npipe:\/\/)/.test(host);
if(process.env.DOCKER_HOST&&!local(process.env.DOCKER_HOST))throw new Error("Remote container endpoints are not permitted for Blender provisioning.");
const [context]=JSON.parse(execFileSync(docker,["context","inspect"],{encoding:"utf8"}));
if(!local(context.Endpoints?.docker?.Host??""))throw new Error("Blender requires the local container IPC endpoint.");
const archive=path.join(inputs,lock.archive.file),metadata=await lstat(archive);
if(!metadata.isFile()||metadata.isSymbolicLink()||metadata.size!==lock.archive.size)throw new Error("Blender archive size/type differs from its exact lock.");
const digest=createHash("sha256");for await(const chunk of createReadStream(archive))digest.update(chunk);
if(digest.digest("hex")!==lock.archive.sha256)throw new Error("Blender archive SHA-256 mismatch; nothing was extracted or executed.");
for(const dependency of lock.dependencies){const file=path.join(inputs,dependency.file),entry=await lstat(file);
  if(!entry.isFile()||entry.isSymbolicLink()||entry.size!==dependency.size||hash(await readFile(file))!==dependency.sha256)throw new Error("Blender system dependency integrity mismatch.");}
const driver=await readFile(path.join(root,"packages/adapter-game-blender/image/process.py"));
const driverSha256=hash(driver),recipeSha256=hash(canonical({lock,driverSha256,imagePolicy:1}));
const directory=await mkdtemp(path.join(inputs,`image-${recipeSha256.slice(0,12)}-`));
const extraction=`import sys,tarfile,pathlib,os
source,destination,root=sys.argv[1:]
with tarfile.open(source,'r:xz') as archive:
 items=archive.getmembers()
 if len(items)>150000 or sum(x.size for x in items)>4*1024**3: raise ValueError('Blender archive exceeds extraction limits')
 for item in items:
  p=pathlib.PurePosixPath(item.name)
  if p.is_absolute() or '..' in p.parts or not p.parts or p.parts[0]!=root: raise ValueError('Unexpected Blender archive path')
  if not(item.isfile() or item.isdir() or item.issym() or item.islnk()): raise ValueError('Special archive entry')
  if item.issym() or item.islnk():
   resolved=os.path.normpath(os.path.join(os.path.dirname(item.name) if item.issym() else '',item.linkname))
   if pathlib.PurePosixPath(item.linkname).is_absolute() or not(resolved==root or resolved.startswith(root+'/')): raise ValueError('External archive link')
 archive.extractall(destination,members=items)
`;
execFileSync("python3",["-I","-c",extraction,archive,directory,lock.archive.root],{stdio:"inherit",timeout:180000});
await writeFile(path.join(directory,"process.py"),driver,{mode:0o600});
for(const dependency of lock.dependencies)await copyFile(path.join(inputs,dependency.file),path.join(directory,dependency.file));
await writeFile(path.join(directory,"Dockerfile"),`FROM ${lock.baseImage}\nLABEL org.companion.game-blender.recipe="${recipeSha256}"\nCOPY ${lock.dependencies.map((d)=>d.file).join(" ")} /opt/companion/dependencies/\nRUN rpm --install --nodeps --noscripts --notriggers /opt/companion/dependencies/*.rpm\nCOPY ${lock.archive.root}/ /opt/blender/\nCOPY --chmod=0444 process.py /opt/companion/process.py\nENV LANG=C.UTF-8\nENTRYPOINT ["/opt/blender/blender","--background","--factory-startup","--disable-autoexec","--python-exit-code","1","--python","/opt/companion/process.py"]\n`);
// No registry authentication/pull or runtime download. The exact base must exist.
execFileSync(docker,["image","inspect",lock.baseImage],{stdio:"ignore"});
const tag=`companion-blender:${lock.version}-x64-${recipeSha256.slice(0,12)}`;
execFileSync(docker,["build","--platform",lock.platform,"--network","none","--pull=false","--tag",tag,directory],{stdio:"inherit",timeout:180000});
const [image]=JSON.parse(execFileSync(docker,["image","inspect",tag],{encoding:"utf8"}));
if(!/^sha256:[a-f0-9]{64}$/.test(image.Id)||image.Architecture!=="amd64"||image.Config.Labels["org.companion.game-blender.recipe"]!==recipeSha256)throw new Error("Provisioned Blender image identity mismatch.");
const version=execFileSync(docker,["run","--rm","--pull=never","--platform",lock.platform,"--network","none","--read-only","--cap-drop","ALL","--security-opt","no-new-privileges","--memory","2g","--pids-limit","128","--user","1000:1000","--entrypoint","/opt/blender/blender",image.Id,"--version"],{encoding:"utf8",timeout:30000});
if(version.split(/\r?\n/)[0]!==`Blender ${lock.version} LTS`)throw new Error("Unexpected Blender editor version.");
await mkdir(path.dirname(output),{recursive:true,mode:0o700});
await writeFile(output,JSON.stringify({schemaVersion:1,version:lock.version,hostArchitecture:process.arch,toolArchitecture:"x64",platform:lock.platform,imageId:image.Id,recipeSha256,driverSha256,dockerExecutable:docker},null,2),{mode:0o600});
console.log(`BLENDER_TOOLCHAIN_PROVISIONED ${lock.version} ${image.Id} ${output}`);
