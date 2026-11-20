// Original, locally synthesized score and effects. No recording or network.
export class Sound {
 constructor(){this.muted=false;this.paused=true;this.beat=0;this.timer=setInterval(()=>this.music(),400);}
 async wake(muted){this.muted=muted;if(this.paused&&!this.context)return false;try{if(!this.context){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return false;this.context=new Audio();}if(muted||this.paused){await this.context.suspend();}else await this.context.resume();return this.context.state==='running';}catch{return false;}}
 tone(frequency,length,gain=.05,type='sine',pan=0){const c=this.context;if(!c||c.state!=='running'||this.muted||this.paused)return;const o=c.createOscillator(),g=c.createGain(),p=c.createStereoPanner();o.type=type;o.frequency.value=frequency;p.pan.value=Math.max(-1,Math.min(1,pan));g.gain.setValueAtTime(0,c.currentTime);g.gain.linearRampToValueAtTime(gain,c.currentTime+.008);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+length);o.connect(g).connect(p).connect(c.destination);o.start();o.stop(c.currentTime+length+.02);}
 music(){if(this.paused)return;const chords=[[220,277.18,329.63],[196,246.94,293.66],[174.61,220,261.63],[196,246.94,329.63]],chord=chords[Math.floor(this.beat/8)%4],pattern=[0,2,1,2,0,1,2,1];this.tone(chord[pattern[this.beat%8]]*(this.beat%8===6?2:1),.7,.018,'sine');if(this.beat%4===0)this.tone(chord[0]/2,1.15,.014,'triangle');this.beat++;}
 hit(event){if(event.kind==='lamp'){const scale=[523.25,587.33,659.25,783.99,880];this.tone(scale[(event.combo-1)%5],.32,.06,'sine',(event.x-320)/500);}else if(event.kind==='bumper')this.tone(146.83,.12,.035,'triangle');else if(event.kind==='wall')this.tone(110,.07,.018,'sine');else if(event.kind==='won'){for(let i=0;i<4;i++)setTimeout(()=>this.tone([523.25,659.25,783.99,1046.5][i],.5,.055),i*90);}}
 launch(){this.tone(261.63,.13,.045,'triangle');}
 stop(){clearInterval(this.timer);void this.context?.close();}
}
