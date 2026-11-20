import test from 'node:test';
import assert from 'node:assert/strict';
import {HeldInputs,type HeldAction} from '../examples/game-integrations/windmail-responsive/input';
import {VoyageChrome} from '../examples/game-integrations/windmail-responsive/chrome';
// Type-check the actual DOM integration; native browser qualification covers DOM.
type ChromeConstructor=typeof VoyageChrome;const typedChrome:ChromeConstructor|undefined=undefined;void typedChrome;
test('held game input preserves another finger or keyboard source until its own release',()=>{
 const changes:[HeldAction,boolean][]=[];const input=new HeldInputs((action,on)=>changes.push([action,on]));input.setEnabled(true);
 input.press('right','pointer:1');input.press('right','pointer:2');input.press('right','key:Enter');input.press('right','key:Enter');
 input.release('right','pointer:1');input.release('right','pointer:2');assert.deepEqual(changes,[['right',true]]);
 input.release('right','key:Enter');input.release('right','key:Enter');assert.deepEqual(changes,[['right',true],['right',false]]);
});
test('pause/disabled and cancellation release simultaneous steering and throttle without stale commands',()=>{
 const changes:[HeldAction,boolean][]=[];const input=new HeldInputs((action,on)=>changes.push([action,on]));input.press('drive','pointer:1');assert.deepEqual(changes,[]);
 input.setEnabled(true);input.press('drive','pointer:1');input.press('left','pointer:2');input.setEnabled(false);input.release('drive','pointer:1');input.press('left','pointer:2');
 assert.deepEqual(changes,[['drive',true],['left',true],['drive',false],['left',false]]);
 input.setEnabled(true);input.clear();assert.equal(changes.length,4);input.press('reverse','pointer:3');input.clear();assert.deepEqual(changes.slice(-2),[['reverse',true],['reverse',false]]);
});
