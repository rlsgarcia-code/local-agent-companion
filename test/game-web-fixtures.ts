/** Small integration fixtures, never advertised as completed portfolio games. */
export function webFixture(engine: "phaser" | "babylon") {
  const source = engine === "phaser" ? `import Phaser from 'phaser';
import { color } from './palette';
import './style.css';
new Phaser.Game({type:Phaser.CANVAS,canvas:document.querySelector('#game'),width:640,height:360,backgroundColor:'#173b30',
 scene:{create(){const seed=this.add.circle(320,180,24,color);this.input.keyboard.on('keydown-SPACE',()=>{seed.x+=30;});}}});`
    : `import { Engine, Scene, FreeCamera, Vector3, HemisphericLight, MeshBuilder, StandardMaterial, Color3 } from 'babylonjs';
import './style.css';
const canvas=document.querySelector('#game');const engine=new Engine(canvas,true);const scene=new Scene(engine);
const camera=new FreeCamera('camera',new Vector3(0,2,-6),scene);camera.setTarget(Vector3.Zero());
new HemisphericLight('sun',new Vector3(0,1,0),scene);const seed=MeshBuilder.CreateSphere('seed',{diameter:1.5},scene);
const material=new StandardMaterial('seed-color',scene);material.diffuseColor=new Color3(.95,.7,.3);seed.material=material;
window.addEventListener('keydown',e=>{if(e.code==='Space')seed.position.x+=.4;});engine.runRenderLoop(()=>scene.render());
window.addEventListener('resize',()=>engine.resize());`;
  return new Map([
    ["game.web.json", JSON.stringify({ schemaVersion: 1, engineVersion: engine === "phaser" ? "4.2.1" : "9.35.0", entry: "src/main.ts" })],
    ["src/main.ts", source], ["src/palette.ts", "export const color = 0xf5c06a;"], ["src/style.css", "body{background:#173b30}canvas{outline:0}"],
    ["assets/fixture.txt", "Local fixture asset"],
  ]);
}
