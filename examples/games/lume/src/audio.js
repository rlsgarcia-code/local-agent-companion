// Original pentatonic score and effects. No samples, remote fetch or autoplay.
const melody=[0,7,12,9,7,4,2,7,0,4,9,12,7,2,4,0];
export class Audio{
  constructor(){this.context=null;this.nodes=new Set();this.muted=false;this.active=false;this.timer=null;this.index=0;}
  async unlock(){try{if(!this.context){const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return false;this.context=new Context();this.master=this.context.createGain();this.master.gain.value=.25;this.master.connect(this.context.destination);}await this.context.resume();return true;}catch{return false;}}
  note(frequency,start,length,gain=.1,type='sine'){
    if(!this.context||this.muted||!this.active)return;const c=this.context,o=c.createOscillator(),v=c.createGain();o.type=type;o.frequency.setValueAtTime(frequency,start);v.gain.setValueAtTime(0,start);v.gain.linearRampToValueAtTime(gain,start+.02);v.gain.exponentialRampToValueAtTime(.0001,start+length);o.connect(v);v.connect(this.master);o.start(start);o.stop(start+length+.04);this.nodes.add(o);o.onended=()=>{this.nodes.delete(o);o.disconnect();v.disconnect();};
  }
  start(){this.active=true;if(this.timer||!this.context)return;const tick=()=>{if(this.active&&!this.muted&&this.context.state==='running'){const t=this.context.currentTime;this.note(220*2**(melody[this.index%melody.length]/12),t,1.9,.075);if(this.index%4===0)this.note(this.index%8===0?110:146.83,t,3,.04);this.index++;}};tick();this.timer=setInterval(tick,620);}
  effect(name){if(!this.context)return;const previous=this.active;this.active=true;const t=this.context.currentTime,sets={jump:[330,440],seed:[660,880,1320],checkpoint:[440,554,660],complete:[440,554,660,880],respawn:[220,165]};for(const [i,hz]of (sets[name]||[]).entries())this.note(hz,t+i*.075,.18,.12,name==='respawn'?'triangle':'sine');this.active=previous;}
  stop(){this.active=false;if(this.timer){clearInterval(this.timer);this.timer=null;}for(const node of this.nodes)try{node.stop();}catch{}this.nodes.clear();}
  mute(value){this.muted=value;if(this.master)this.master.gain.setTargetAtTime(value?0:.25,this.context.currentTime,.03);if(value){for(const node of this.nodes)try{node.stop();}catch{}this.nodes.clear();}}
  async close(){this.stop();await this.context?.close().catch(()=>{});}
}
