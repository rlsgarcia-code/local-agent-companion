// Explicit administrative, offline provisioning. Never called by a game or agent.
import {createHash} from 'node:crypto';
import {readFile,writeFile,lstat,mkdir,mkdtemp,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),values=new Map();for(let i=0;i<args.length;i+=2){if(!['--inputs','--output','--docker'].includes(args[i])||!args[i+1]||values.has(args[i]))throw Error('Use --inputs, --output, --docker with explicit values');values.set(args[i],args[i+1]);}
if(!values.has('--output'))throw Error('Choose a new immutable --output provisioning record');
const output=path.resolve(values.get('--output'));try{await lstat(output);throw Error('Provisioning output already exists; preserve it');}catch(e){if(e.code!=='ENOENT')throw e;}
const lock=JSON.parse(await readFile(path.join(root,'packages/adapter-game-audio-codec/toolchain.lock.json'),'utf8'));
const inputs=path.resolve(values.get('--inputs')??path.join(root,'.cache/game-audio-inputs/ffmpeg-'+lock.version)),docker=values.get('--docker')??(process.platform==='darwin'?'/usr/local/bin/docker':'/usr/bin/docker');
if(!path.isAbsolute(docker))throw Error('Use an absolute installed Docker executable');
const local=host=>/^(?:unix:\/\/\/|npipe:\/\/)/.test(host),command=(args,options={})=>execFileSync(docker,args,{maxBuffer:16*1024*1024,...options});
if(process.env.DOCKER_HOST&&!local(process.env.DOCKER_HOST))throw Error('Remote container services are not permitted');
const [context]=JSON.parse(command(['context','inspect']).toString());if(!local(context.Endpoints?.docker?.Host??''))throw Error('Local Docker IPC is required');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
for(const expected of lock.inputs){const p=path.join(inputs,expected.file),metadata=await lstat(p);if(!metadata.isFile()||metadata.isSymbolicLink()||metadata.nlink!==1||metadata.size!==expected.size||hash(await readFile(p))!==expected.sha256)throw Error('Signed codec input differs from lock: '+expected.file);}
const driver=await readFile(path.join(root,'packages/adapter-game-audio-codec/image/process.py')),driverSha256=hash(driver),recipeSha256=hash(canonical({lock,driverSha256,imagePolicy:1}));
const directory=await mkdtemp(path.join(inputs,'image-'+recipeSha256.slice(0,12)+'-'));
const verification=command(['run','--rm','--pull=never','--platform',lock.platform,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','1000:1000','--tmpfs','/tmp:rw,nosuid,noexec,size=64m,mode=1777','--mount',`type=bind,src=${inputs},dst=/source,readonly`,'--entrypoint','/bin/sh',lock.baseImage,'-c',`mkdir -m 700 /tmp/keys && gpg --batch --no-options --homedir /tmp/keys --import /source/ffmpeg-devel.asc && gpg --batch --no-options --homedir /tmp/keys --no-auto-key-retrieve --status-fd 1 --verify /source/ffmpeg-${lock.version}.tar.xz.asc /source/ffmpeg-${lock.version}.tar.xz`],{encoding:'utf8'});
if(!verification.split('\n').some(line=>line.startsWith('[GNUPG:] VALIDSIG '+lock.publisherFingerprint+' ')))throw Error('The exact publisher signature was not verified');
await writeFile(path.join(directory,'source-signature.txt'),verification);
const extract=`import pathlib,sys,tarfile
source,destination,root=sys.argv[1:]
with tarfile.open(source,'r:xz') as archive:
 items=archive.getmembers();seen=set()
 if len(items)>40000 or sum(x.size for x in items)>256*1024**2: raise ValueError('Source archive exceeds bounds')
 for item in items:
  p=pathlib.PurePosixPath(item.name)
  if p.is_absolute() or '..' in p.parts or not p.parts or p.parts[0]!=root or item.name in seen or not(item.isfile() or item.isdir()): raise ValueError('Unsafe source archive entry')
  seen.add(item.name)
 archive.extractall(destination,members=items)
`;
execFileSync('python3',['-I','-c',extract,path.join(inputs,`ffmpeg-${lock.version}.tar.xz`),directory,`ffmpeg-${lock.version}`],{timeout:60000});
await writeFile(path.join(directory,'audio-process.py'),driver,{mode:0o600});
const configure=lock.configure.map(value=>{if(!/^[a-zA-Z0-9_.,=/+-]+$/.test(value))throw Error('Invalid fixed configure flag');return value;}).join(' ');
const dockerfile=`FROM ${lock.baseImage} AS builder
COPY ffmpeg-${lock.version}/ /opt/codec-source/
WORKDIR /opt/codec-source
RUN ./configure ${configure} && make -j2 && make install
FROM ${lock.baseImage}
LABEL org.companion.game-audio.recipe="${recipeSha256}"
COPY --from=builder /opt/game-audio/ffmpeg/ /opt/game-audio/ffmpeg/
COPY --chmod=0444 audio-process.py /opt/companion/audio-process.py
COPY --from=builder /opt/codec-source/COPYING.LGPLv2.1 /opt/companion/COPYING.FFmpeg.LGPLv2.1
ENV LANG=C.UTF-8
ENTRYPOINT ["/usr/bin/python3","-I","/opt/companion/audio-process.py"]
`;
await writeFile(path.join(directory,'Dockerfile'),dockerfile);
command(['build','--platform',lock.platform,'--network=none','--pull=false','--iidfile',path.join(directory,'image.id'),directory],{stdio:'inherit',timeout:600000});
const imageId=(await readFile(path.join(directory,'image.id'),'utf8')).trim();if(!/^sha256:[a-f0-9]{64}$/.test(imageId))throw Error('No immutable codec image ID');
const [image]=JSON.parse(command(['image','inspect',imageId]).toString());if(image.Architecture!=='amd64'||image.Config?.Labels?.['org.companion.game-audio.recipe']!==recipeSha256)throw Error('Codec image differs from its fixed recipe');
const run=args=>command(['run','--rm','--pull=never','--platform',lock.platform,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','1000:1000','--entrypoint','/opt/game-audio/ffmpeg/bin/ffmpeg',imageId,...args],{encoding:'utf8'});
const version=run(['-version']);if(!version.includes('ffmpeg version '+lock.version)||version.includes('--enable-gpl')||version.includes('--enable-nonfree'))throw Error('Unexpected codec version or optional license configuration');
await writeFile(path.join(directory,'binary-version.txt'),version);
await writeFile(path.join(directory,'binary-license.txt'),run(['-L']));
for(const name of ['encoders','decoders','protocols','formats'])await writeFile(path.join(directory,name+'.txt'),run(['-'+name]));
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,JSON.stringify({schemaVersion:1,version:lock.version,hostArchitecture:process.arch,toolArchitecture:'x64',platform:lock.platform,imageId,driverSha256,recipeSha256,dockerExecutable:docker},null,2)+'\n',{flag:'wx',mode:0o600});
console.log('GAME_AUDIO_CODEC_PREPARED '+output);console.log('SOURCE_AND_BUILD_EVIDENCE '+directory);
