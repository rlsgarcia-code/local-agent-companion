// Structural synthetic MP4 metadata. Payload is not AAC and must never be used
// as native decoder/playback evidence; the real pipeline qualification is separate.
const u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
const u16=(n:number)=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;};
const box=(type:string,...parts:Buffer[])=>{const data=Buffer.concat(parts);return Buffer.concat([u32(data.length+8),Buffer.from(type),data]);};
const full=(type:string,...parts:Buffer[])=>box(type,u32(0),...parts);
const descriptor=(tag:number,...parts:Buffer[])=>{const data=Buffer.concat(parts);if(data.length>127)throw Error("Fixture descriptor is intentionally small");return Buffer.concat([Buffer.from([tag,data.length]),data]);};
export function structuralAudioMp4({rate=48000,channels=2,frames=48000,movieRate=1000}:{rate?:number;channels?:number;frames?:number;movieRate?:number}={}){
 const movieDuration=Math.max(1,Math.round(frames*movieRate/rate)),samples=Math.ceil(frames/1024),tail=frames-(samples-1)*1024,rateIndex=[96000,88200,64000,48000,44100,32000,24000,22050].indexOf(rate),config=Buffer.concat([u16(2<<11|rateIndex<<7|channels<<3),Buffer.from([0x56,0xe5,0])]);
 const esds=full('esds',descriptor(3,u16(1),Buffer.from([0]),descriptor(4,Buffer.from([64,21,0,0,0]),u32(128000),u32(128000),descriptor(5,config)),descriptor(6,Buffer.from([2]))));
 const mp4a=box('mp4a',Buffer.alloc(6),u16(1),Buffer.alloc(8),u16(2),u16(16),Buffer.alloc(4),u32(rate*65536),esds);
 const stsd=full('stsd',u32(1),mp4a),stts=full('stts',u32(samples>1?2:1),...(samples>1?[u32(samples-1),u32(1024)]:[]),u32(1),u32(tail));
 const stsc=full('stsc',u32(1),u32(1),u32(samples),u32(1)),stsz=full('stsz',u32(0),u32(samples),...Array.from({length:samples},()=>u32(4)));
 const reference=full('dref',u32(1),box('url ',u32(1))),dinf=box('dinf',reference),smhd=full('smhd',Buffer.alloc(4));
 const mdhd=full('mdhd',Buffer.alloc(8),u32(rate),u32(frames),Buffer.alloc(4)),hdlr=full('hdlr',u32(0),Buffer.from('soun'),Buffer.alloc(12));
 const tkhd=box('tkhd',u32(3),Buffer.alloc(8),u32(1),u32(0),u32(movieDuration),Buffer.alloc(60));
 const mvhd=full('mvhd',Buffer.alloc(8),u32(movieRate),u32(movieDuration),Buffer.alloc(80)),ftyp=box('ftyp',Buffer.from('isom'),u32(512),Buffer.from('isomiso2mp41'));
 const movie=(offset:number)=>box('moov',mvhd,box('trak',tkhd,box('mdia',mdhd,hdlr,box('minf',smhd,dinf,box('stbl',stsd,stts,stsc,stsz,full('stco',u32(1),u32(offset)))))));
 const moov=movie(0);return Buffer.concat([ftyp,movie(ftyp.length+moov.length+8),box('mdat',Buffer.alloc(samples*4))]);
}
