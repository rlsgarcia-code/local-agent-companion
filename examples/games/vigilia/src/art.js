import {Engine,Scene,FreeCamera,Vector3,Color3,Color4,HemisphericLight,DirectionalLight,MeshBuilder,StandardMaterial,TransformNode,Mesh,VertexData,ShadowGenerator} from 'babylonjs';
import {REGIONS,SITES,ROCKS} from './world';
export function createWorld(canvas){
  const engine=new Engine(canvas,true,{preserveDrawingBuffer:true,stencil:false});engine.setHardwareScalingLevel(Math.max(1,(devicePixelRatio||1)/1.5));
  const scene=new Scene(engine);scene.clearColor=Color4.FromHexString('#c4d5cbff');scene.fogMode=Scene.FOGMODE_EXP2;scene.fogColor=Color3.FromHexString('#c4d5cb');scene.fogDensity=.012;
  const camera=new FreeCamera('lookout',new Vector3(-7,24,-32),scene);camera.minZ=.1;camera.maxZ=240;camera.fov=.72;
  new HemisphericLight('sky',new Vector3(0,1,0),scene).intensity=.65;
  const sun=new DirectionalLight('sun',new Vector3(-.4,-1,.5),scene);sun.intensity=.65;sun.position.set(-30,45,-20);const shadows=new ShadowGenerator(1024,sun);shadows.usePercentageCloserFiltering=true;shadows.bias=.0005;
  const materials=new Map();function mat(color,glow=false){const key=color+glow;if(materials.has(key))return materials.get(key);const m=new StandardMaterial(key,scene);m.diffuseColor=Color3.FromHexString(color).toLinearSpace();m.specularColor=Color3.Black();if(glow)m.emissiveColor=m.diffuseColor.scale(.65);materials.set(key,m);return m;}
  function box(name,x,y,z,w,h,d,color,parent){const mesh=MeshBuilder.CreateBox(name,{width:w,height:h,depth:d},scene);mesh.position.set(x,y,z);mesh.material=mat(color);if(parent)mesh.parent=parent;return mesh;}
  function cylinder(name,x,y,z,diameter,height,color,vertices=12,parent){const mesh=MeshBuilder.CreateCylinder(name,{diameter,height,tessellation:vertices},scene);mesh.position.set(x,y,z);mesh.material=mat(color);if(parent)mesh.parent=parent;return mesh;}
  function island(name,cx,y,w,d,height,color){
    const corners=[[-w/2+3,-d/2],[w/2-3,-d/2],[w/2,-d/2+3],[w/2,d/2-3],[w/2-3,d/2],[-w/2+3,d/2],[-w/2,d/2-3],[-w/2,-d/2+3]],positions=[],indices=[];
    function triangle(a,b,c){const start=positions.length/3;positions.push(...a,...b,...c);indices.push(start,start+2,start+1);}
    for(let i=0;i<corners.length;i++){const a=corners[i],b=corners[(i+1)%corners.length];triangle([cx,y,0],[cx+b[0],y,b[1]],[cx+a[0],y,a[1]]);triangle([cx+a[0],y,a[1]],[cx+b[0],y,b[1]],[cx+b[0],y-height,b[1]]);triangle([cx+a[0],y,a[1]],[cx+b[0],y-height,b[1]],[cx+a[0],y-height,a[1]]);}
    const mesh=new Mesh(name,scene),data=new VertexData(),normals=[];VertexData.ComputeNormals(positions,indices,normals);data.positions=positions;data.indices=indices;data.normals=normals;data.applyToMesh(mesh);mesh.material=mat(color);mesh.receiveShadows=true;return mesh;
  }
  const ocean=box('lagoon',50,-1.1,0,300,.3,180,'#719f9c');
  const waveLines=[];for(let i=0;i<26;i++){const x=(i*31%170)-35,z=(i*19%80)-40;const line=box('foam',x,-.91,z,3+i%4,.012,.045,'#abc4b7');waveLines.push(line);}
  const gates=[],lamps=[],rings=[],notes=[];
  REGIONS.forEach((r,i)=>{
    island('eroded shore',r.x,-.25,30,28,.75,'#7a8b7c');island('land',r.x,.2,28,26,.45,r.color);
    box('east-west trail',r.x,.215,0,27,.02,2,'#dfd0a8');box('crossing trail',r.x,.22,1,2,.02,22,'#dfd0a8');
    for(let j=0;j<35;j++){
      const x=r.x-12+(j*7.337%24),z=-11+(j*5.331%22);if(Math.abs(z)<2||Math.abs(x-r.x)<6&&z>-1&&z<9||SITES.some(p=>Math.hypot(p.x-x,p.z-z)<2.7)||ROCKS.some(p=>Math.hypot(p.x-x,p.z-z)<2))continue;
      cylinder('reed stem',x,.7,z,.1,1.1,'#647b5e',5);const crown=MeshBuilder.CreateSphere('reed',{diameter:1+(j%3)*.22,segments:4},scene);crown.scaling.y=.55;crown.position.set(x,1.1,z);crown.material=mat(i===1?'#3f756f':'#6c997b');
    }
    for(let j=0;j<5;j++){const x=r.x-11+j*5.4,z=11.7;cylinder('wind tree',x,1.2,z,.24,2.5,'#6a7160',6);const crown=MeshBuilder.CreateSphere('tree crown',{diameter:3.3,segments:5},scene);crown.position.set(x,3.1,z);crown.scaling.set(1,.6,.8);crown.material=mat(i===2?'#8c9876':'#54877a');shadows.addShadowCaster(crown);}
    cylinder('lighthouse base',r.x,.5,7,2.2,.6,'#ddd3b6');cylinder('lighthouse',r.x,2.2,7,1.2,3.2,'#e4dcc5',8);cylinder('lantern roof',r.x,4.3,7,2.1,.25,'#657e73',8);
    for(const dx of [-.65,.65])box('lantern mullion',r.x+dx,3.7,7,.09,1,.09,'#5b7467');
    for(let j=0;j<3;j++){const stone=box('old arch post',r.x-10+j*2,1.1,-1,.6,1.8,.65,'#b1b69d');shadows.addShadowCaster(stone);}box('old arch lintel',r.x-8,2,-1,4.8,.35,.75,'#a8ae93');
    const lamp=MeshBuilder.CreateSphere('lantern',{diameter:1.4,segments:8},scene);lamp.position.set(r.x,3.7,7);lamp.material=mat('#6d8178');lamps.push(lamp);
    if(i<2){box('bridge',r.x+25,-.05,0,22,.4,3.3,'#b9a581');for(const z of [-1.6,1.6])box('bridge rail',r.x+25,.6,z,22,.08,.09,'#7c8671');const gate=box('sleeping bridge',r.x+14,.9,0,.3,2,3.3,'#d3bb77');gates.push(gate);}
  });
  ROCKS.forEach(r=>{const stone=MeshBuilder.CreateSphere('stone',{diameter:r.radius*2,segments:4},scene);stone.position.set(r.x,.7,r.z);stone.scaling.y=.7;stone.material=mat('#7d9388');});
  SITES.filter(p=>p.kind==='memory').forEach(p=>{cylinder('memory pedestal',p.x,.5,p.z,.7,.65,'#ede0b9',6);const scroll=box('inscribed copper',p.x,1,p.z,.58,.13,.62,'#ddb971');scroll.rotation.x=-.2;notes.push({site:p,mesh:scroll});});
  SITES.filter(p=>p.kind==='ring').forEach(p=>{
    cylinder('tuning pedestal',p.x,.55,p.z,1,.7,'#e5d8b7',8);const ring=MeshBuilder.CreateTorus('resonator',{diameter:1.4,thickness:.14,tessellation:20},scene);ring.position.set(p.x,1.3,p.z);ring.material=mat('#d0ab64');rings.push({site:p,mesh:ring});
    for(let n=0;n<4;n++)box('tone notch',p.x+Math.sin(n*Math.PI/2)*.57,.98,p.z+Math.cos(n*Math.PI/2)*.57,.12,.1,.12,'#657d72');
    // One/two/three inlays identify the same stones as the journal and interaction label.
    for(let n=0;n<=p.index;n++)box('inlay',p.x-.2+n*.2,.94,p.z-.4,.07,.02,.2,'#566b61');
  });
  box('jetty',-7,.12,-11,3,.3,7,'#bca885');box('mailbox',-7,.9,-10,.7,1.3,.6,'#5a7971');
  const player=new TransformNode('traveller',scene);cylinder('coat',0,.85,0,.67,1,'#344f50',7,player);const head=MeshBuilder.CreateSphere('head',{diameter:.5,segments:8},scene);head.parent=player;head.position.y=1.6;head.material=mat('#cda882');cylinder('hat',0,1.89,0,.84,.13,'#e6cc91',12,player);
  const scarf=box('scarf',0,1.29,-.3,.5,.16,.6,'#e9b75c',player);const left=box('boot',-.17,.28,0,.22,.4,.32,'#40514c',player),right=box('boot',.17,.28,0,.22,.4,.32,'#40514c',player);
  player.getChildMeshes().forEach(mesh=>shadows.addShadowCaster(mesh));
  const shadow=cylinder('traveller shadow',0,.231,0,1.15,.012,'#82977e',24);let phase=0;
  function draw(s,walking,dt){
    phase+=dt;player.position.set(s.x,.25,s.z);player.rotation.y=s.heading;shadow.position.x=s.x;shadow.position.z=s.z;
    const motion=s.reducedMotion?0:walking?Math.sin(phase*14)*.18:0;left.position.y=.28+motion;right.position.y=.28-motion;scarf.rotation.x=s.reducedMotion?0:Math.sin(phase*3)*.1;
    const ratio=engine.getRenderWidth()/engine.getRenderHeight(),height=ratio<.8?31:24;
    const desired=new Vector3(s.x,height,s.z-22);camera.position=Vector3.Lerp(camera.position,desired,s.reducedMotion?1:Math.min(1,dt*5));camera.setTarget(new Vector3(s.x,.3,s.z+1));
    notes.forEach(({site,mesh})=>{mesh.isVisible=!s.notes.includes(site.id);if(!s.reducedMotion)mesh.rotation.y=phase*.5;});
    rings.forEach(({site,mesh})=>{mesh.rotation.z=s.rings[site.region][site.index]*Math.PI/2;mesh.material=mat(s.lit[site.region]?'#f6d488':'#c79f56',s.lit[site.region]);});
    lamps.forEach((lamp,i)=>lamp.material=mat(s.lit[i]?'#ffe2a0':'#6d8178',s.lit[i]));gates.forEach((gate,i)=>gate.isVisible=!s.lit[i]);
    waveLines.forEach((line,i)=>line.scaling.x=s.reducedMotion?1:1+Math.sin(phase*.7+i)*.1);scene.render();
  }
  return {engine,draw,resize:()=>engine.resize(),dispose:()=>{scene.dispose();engine.dispose();}};
}
