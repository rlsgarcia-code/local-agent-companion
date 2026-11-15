// Original pentatonic score. All sound is synthesized locally after a gesture.
export class Sound{
  context=null;master=null;muted=false;timer=null;bar=0;
  async start(muted){this.muted=muted;try{if(!this.context){this.context=new AudioContext();this.master=this.context.createGain();this.master.gain.value=.12;this.master.connect(this.context.destination);}await this.context.resume();this.master.gain.setTargetAtTime(muted?0:.12,this.context.currentTime,.05);if(!this.timer){this.music();this.timer=setInterval(()=>this.music(),3600);}}catch{}}
  note(frequency,duration=1.4,delay=0,type='sine'){if(!this.context||this.context.state!=='running'||this.muted)return;const now=this.context.currentTime+delay,o=this.context.createOscillator(),g=this.context.createGain();o.type=type;o.frequency.value=frequency;g.gain.setValueAtTime(0,now);g.gain.linearRampToValueAtTime(.32,now+.035);g.gain.exponentialRampToValueAtTime(.001,now+duration);o.connect(g);g.connect(this.master);o.start(now);o.stop(now+duration+.05);o.onended=()=>{o.disconnect();g.disconnect();};}
  music(){const notes=[174.61,220,261.63,329.63,293.66,261.63,220,196];const n=notes[this.bar++%notes.length];this.note(n,3.2);this.note(n*1.5,2.8,.6);this.note(n*2,2,.95);}
  event(kind,tone=1){if(kind==='lit'||kind==='ending'){[261.63,329.63,392,523.25].forEach((n,i)=>this.note(n,2,i*.17));}else this.note([196,261.63,329.63,392][tone]||261.63,.8);}
  pause(){clearInterval(this.timer);this.timer=null;void this.context?.suspend().catch(()=>{});}
}
