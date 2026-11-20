import { gameModelOperation, type GameModelOperation } from "../packages/contracts/src/game-models";

/** Original procedural integration fixture, not a final game/asset acceptance. */
export function fixtureModelOperation():GameModelOperation{
  return gameModelOperation.parse({type:"model.scene",outputBase:"assets/robot",
    materials:[{id:"green",color:"#27aa8aff",metallic:0.3,roughness:0.3},{id:"gold",color:"#f3ba57ff",metallic:0.4,roughness:0.3},
      {id:"dark",color:"#192b40ff",roughness:0.5},{id:"eye",color:"#d9f4f1ff",emission:"#8ccfc5ff"}],
    objects:[
      {id:"body",geometry:{kind:"box",size:[0.9,0.6,1]},position:[0,0,1.55],bevel:0.12,material:"green",bindBone:"root-bone"},
      {id:"head",geometry:{kind:"sphere",radius:0.46},position:[0,0,2.4],smooth:true,material:"gold",bindBone:"head-bone"},
      {id:"eye-left",geometry:{kind:"sphere",radius:0.075,segments:12,rings:8},parent:"head",position:[-0.16,-0.39,0.07],material:"eye",smooth:true},
      {id:"eye-right",geometry:{kind:"sphere",radius:0.075,segments:12,rings:8},parent:"head",position:[0.16,-0.39,0.07],material:"eye",smooth:true},
      {id:"arm-left",geometry:{kind:"box",size:[0.25,0.3,0.7]},position:[-0.65,0,1.65],bevel:0.06,material:"green",bindBone:"left-bone"},
      {id:"arm-right",geometry:{kind:"box",size:[0.25,0.3,0.7]},position:[0.65,0,1.65],bevel:0.06,material:"green",bindBone:"right-bone"},
      {id:"hand-left",geometry:{kind:"sphere",radius:0.17},position:[-0.65,0,1.2],smooth:true,material:"gold",bindBone:"left-bone"},
      {id:"hand-right",geometry:{kind:"sphere",radius:0.17},position:[0.65,0,1.2],smooth:true,material:"gold",bindBone:"right-bone"},
      {id:"leg-left",geometry:{kind:"cylinder",radius:0.14,depth:0.7},position:[-0.25,0,0.65],material:"gold",bindBone:"root-bone"},
      {id:"leg-right",geometry:{kind:"cylinder",radius:0.14,depth:0.7},position:[0.25,0,0.65],material:"gold",bindBone:"root-bone"},
      {id:"foot-left",geometry:{kind:"box",size:[0.36,0.55,0.24]},position:[-0.25,-0.1,0.2],bevel:0.05,material:"dark",bindBone:"root-bone"},
      {id:"foot-right",geometry:{kind:"box",size:[0.36,0.55,0.24]},position:[0.25,-0.1,0.2],bevel:0.05,material:"dark",bindBone:"root-bone"},
      {id:"stand",geometry:{kind:"cylinder",radius:1.15,depth:0.08,segments:48},position:[0,0,0],material:"dark"},
    ],rig:{id:"robot-rig",bones:[{id:"root-bone",head:[0,0,0.2],tail:[0,0,1.8]},{id:"head-bone",parent:"root-bone",head:[0,0,2],tail:[0,0,2.8]},
      {id:"left-bone",parent:"root-bone",head:[-0.65,0,2],tail:[-0.65,0,1.1]},{id:"right-bone",parent:"root-bone",head:[0.65,0,2],tail:[0.65,0,1.1]}]},
    clips:[{id:"wave",frames:30,tracks:[{target:{kind:"bone",id:"right-bone"},channel:"rotation",keys:[{frame:0,value:[0,0,0]},{frame:15,value:[0,-75,0]},{frame:30,value:[0,0,0]}]}]}],
    preview:{position:[4,-6,3.6],target:[0,0,1.4],orthographicScale:3.8,samples:8,background:"#132136ff",lights:[
      {position:[-3,-4,6],target:[0,0,1.4],power:1400,size:5},{position:[4,-2,4],target:[0,0,1.4],power:900,size:4},{position:[2,3,5],target:[0,0,1.4],power:1800,size:3},
    ]}});
}

/** Original explicit deformable sleeve; blended vertices around its joint.
 * An engineering fixture, never a finished character or artistic acceptance. */
export function fixtureSkinnedModelOperation():GameModelOperation{
  const vertices:number[][]=[],triangles:number[][]=[],weights:{bone:string;weight:number}[][]=[];
  for(let row=0;row<9;row++){
    const z=row/4,t=Math.max(0,Math.min(1,z-.5));
    for(const [x,y] of [[-.4,-.12],[.4,-.12],[.4,.12],[-.4,.12]]){
      vertices.push([x!,y!,z]);weights.push(t===0?[{bone:"base",weight:1}]:t===1?[{bone:"tip",weight:1}]:[{bone:"base",weight:1-t},{bone:"tip",weight:t}]);
    }
    if(row)for(let side=0;side<4;side++){const a=(row-1)*4+side,b=(row-1)*4+(side+1)%4,c=row*4+side,d=row*4+(side+1)%4;triangles.push([a,b,c],[b,d,c]);}
  }
  triangles.push([0,2,1],[0,3,2],[32,33,34],[32,34,35]);
  return gameModelOperation.parse({type:"model.scene",outputBase:"assets/sleeve",materials:[{id:"copper",color:"#dd7744ff",roughness:.65}],
    objects:[{id:"sleeve",geometry:{kind:"mesh",vertices,triangles},material:"copper",skin:{weights},smooth:true}],
    rig:{id:"sleeve-rig",bones:[{id:"base",head:[0,0,0],tail:[0,0,1]},{id:"tip",parent:"base",head:[0,0,1],tail:[0,0,2]}]},
    clips:[{id:"bend",frames:30,tracks:[{target:{kind:"bone",id:"tip"},channel:"rotation",keys:[{frame:0,value:[0,0,0]},{frame:15,value:[0,0,-60]},{frame:30,value:[0,0,0]}]}]}],
    preview:{position:[3,-6,3],target:[0,0,1],orthographicScale:3.5,samples:8,lights:[{position:[-3,-4,6],target:[0,0,1],power:1600,size:5}]}});
}
