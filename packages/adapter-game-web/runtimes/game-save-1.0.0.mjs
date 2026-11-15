/*! Companion game save runtime 1.0.0 | MIT | Copyright (c) 2026 */
export const saveRuntimeVersion='1.0.0';
const DATABASE='companion-game-saves-v1',STORE='slots',HARD_BYTES=256*1024,encoder=new TextEncoder();
class SaveFault extends Error{constructor(code){super('Game save operation did not complete.');this.code=code;}}
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const integer=value=>Number.isSafeInteger(value)&&value>0;
const identifier=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value);
const problem=(status,code,extra={})=>({status,code,...extra});

/** Copy only bounded JSON data; never invoke accessors/toJSON or normalize text. */
function json(value,maxBytes){
  let nodes=0;
  function copy(item,depth){
    if(++nodes>20000||depth>32)throw new SaveFault('data-limit');
    if(item===null||typeof item==='boolean')return item;
    if(typeof item==='number'){if(!Number.isFinite(item))throw new SaveFault('invalid-data');return item;}
    if(typeof item==='string'){if(encoder.encode(item).length>maxBytes)throw new SaveFault('data-limit');return item;}
    if(!item||typeof item!=='object')throw new SaveFault('invalid-data');
    const array=Array.isArray(item),prototype=Object.getPrototypeOf(item);
    if(!array&&prototype!==Object.prototype&&prototype!==null)throw new SaveFault('invalid-data');
    const descriptors=Object.getOwnPropertyDescriptors(item),keys=Reflect.ownKeys(descriptors).filter(key=>!array||key!=='length');
    if(keys.some(key=>typeof key!=='string'||key.length>128||['__proto__','constructor','prototype','toJSON'].includes(key)))throw new SaveFault('invalid-data');
    if(array&&(item.length>20000||keys.length!==item.length||keys.some(key=>!/^(?:0|[1-9][0-9]*)$/.test(key)||Number(key)>=item.length)))throw new SaveFault('invalid-data');
    const output=array?[]:Object.create(null);
    for(const key of keys.sort()){const descriptor=descriptors[key];if(!descriptor.enumerable||!own(descriptor,'value'))throw new SaveFault('invalid-data');output[key]=copy(descriptor.value,depth+1);}
    return output;
  }
  const data=copy(value,0),text=JSON.stringify(data);if(encoder.encode(text).length>maxBytes)throw new SaveFault('data-limit');
  return {data,text};
}
function freeze(value){if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
async function stamp(raw){
  if(raw===undefined)return null;
  if(typeof raw!=='string'||encoder.encode(raw).length>HARD_BYTES)throw new SaveFault('unsupported-record');
  if(!globalThis.crypto?.subtle)throw new SaveFault('crypto-unavailable');
  const digest=await globalThis.crypto.subtle.digest('SHA-256',encoder.encode(raw));return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
}

/** Native origin-local IndexedDB. No host/agent bridge, network or memory fallback.
 * validators/migrations are pure synchronous game functions, not engine tools. */
export function createGameSave(options){
  if(!options||typeof options!=='object'||!identifier(options.gameId)||!identifier(options.slot)||!integer(options.version)||options.version>100000||typeof options.validate!=='function')throw new TypeError('Game save requires stable gameId/slot, positive version and a validator.');
  const allowed=['gameId','slot','version','validate','migrations','maxBytes','indexedDB'];
  if(Object.keys(options).some(key=>!allowed.includes(key)))throw new TypeError('Unknown game save option.');
  const {gameId,slot,version,validate}=options,maxBytes=options.maxBytes??65536,migrationInput=options.migrations??{};
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>HARD_BYTES||!migrationInput||typeof migrationInput!=='object'||Array.isArray(migrationInput)||Object.keys(migrationInput).length>16||Object.entries(migrationInput).some(([from,fn])=>!integer(Number(from))||String(Number(from))!==from||Number(from)>=version||typeof fn!=='function'))throw new TypeError('Invalid game save bounds or migrations.');
  const migrations=Object.freeze(Object.assign(Object.create(null),migrationInput));
  const key=gameId+':'+slot,transactions=new Set(),pending=new Set();let db,opening,closed=false;
  const live=()=>{if(closed)throw new SaveFault('closed');};
  function open(){
    live();if(db)return Promise.resolve(db);if(opening)return opening;
    opening=new Promise((resolve,reject)=>{
      let settled=false,request;const timer=setTimeout(()=>finish(new SaveFault('storage-open-timeout')),5000);
      function finish(error,value){if(settled){value?.close();return;}settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value);}
      try{const factory=own(options,'indexedDB')?options.indexedDB:globalThis.indexedDB;if(!factory||typeof factory.open!=='function')throw new SaveFault('storage-unavailable');request=factory.open(DATABASE,1);}
      catch{finish(new SaveFault('storage-unavailable'));return;}
      request.onupgradeneeded=()=>{try{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);}catch{request.transaction?.abort();}};
      request.onerror=()=>finish(new SaveFault('storage-open-failed'));
      request.onblocked=()=>{}; // Bounded open timeout; never force-close another tab.
      request.onsuccess=()=>{
        const connection=request.result;if(closed||settled){connection.close();finish(new SaveFault(closed?'closed':'storage-open-timeout'));return;}
        db=connection;connection.onversionchange=()=>{connection.close();if(db===connection)db=undefined;};finish(undefined,connection);
      };
    }).finally(()=>{opening=undefined;});return opening;
  }
  async function transaction(mode,action){
    const connection=await open();live();
    return new Promise((resolve,reject)=>{
      let tx,value,timeout=false;
      try{tx=mode==='readwrite'?connection.transaction(STORE,mode,{durability:'strict'}):connection.transaction(STORE,mode);}
      catch{reject(new SaveFault('storage-transaction-unavailable'));return;}
      transactions.add(tx);const timer=setTimeout(()=>{timeout=true;try{tx.abort();}catch{}},5000);
      const cleanup=()=>{clearTimeout(timer);transactions.delete(tx);};
      tx.oncomplete=()=>{cleanup();resolve(value);};
      tx.onabort=()=>{cleanup();reject(new SaveFault(closed?'closed':timeout?'storage-transaction-timeout':tx.error?.name==='QuotaExceededError'?'storage-quota':'storage-aborted'));};
      tx.onerror=()=>{}; // Do not prevent the native request's transaction abort.
      const store=tx.objectStore(STORE),request=store.get(key);
      request.onsuccess=()=>{try{live();value=action(store,request.result);}catch(error){value=undefined;try{tx.abort();}catch{};}};
    });
  }
  const read=()=>transaction('readonly',(_store,raw)=>raw);
  function validateData(value){const encoded=json(value,maxBytes);try{if(validate(freeze(encoded.data))!==true)throw new SaveFault('invalid-data');}catch{throw new SaveFault('invalid-data');}return encoded;}
  function decode(raw){
    if(raw===undefined)return {status:'empty'};
    if(typeof raw!=='string'||encoder.encode(raw).length>maxBytes)return problem('invalid','record-limit');
    let record;try{record=JSON.parse(raw);}catch{return problem('invalid','record-json');}
    if(!record||typeof record!=='object'||Array.isArray(record))return problem('invalid','record-schema');
    if(record.schemaVersion!==1)return problem('incompatible','record-version');
    if(Object.keys(record).sort().join('|')!=='data|gameId|revision|schemaVersion|slot|version'||record.gameId!==gameId||record.slot!==slot||!integer(record.revision)||!integer(record.version)||record.version>100000)return problem('invalid','record-schema');
    try{json(record.data,maxBytes);}catch{return problem('invalid','record-data');}
    if(record.version>version)return problem('incompatible','future-version',{version:record.version});
    if(record.version<version)return {status:'migration-required',version:record.version,revision:record.revision,record};
    try{const data=validateData(record.data);return {status:'loaded',record,data:data.data,text:data.text};}
    catch{return problem('invalid','record-data');}
  }
  async function inspect(){const raw=await read(),currentStamp=await stamp(raw);return {raw,stamp:currentStamp,decoded:decode(raw)};}
  function expected(input){if(!input||!own(input,'expected')||input.expected!==null&&(typeof input.expected!=='string'||!/^[a-f0-9]{64}$/.test(input.expected)))throw new SaveFault('expected-stamp-required');return input.expected;}
  function perform(action){
    if(closed)return Promise.resolve(problem('unavailable','closed'));
    const promise=Promise.resolve().then(action).catch(error=>problem('unavailable',error instanceof SaveFault?error.code:'storage-operation-failed'));
    pending.add(promise);void promise.finally(()=>pending.delete(promise));return promise;
  }
  function wire(data,revision){const result=JSON.stringify({schemaVersion:1,gameId,slot,version,revision,data});if(encoder.encode(result).length>maxBytes)throw new SaveFault('data-limit');return result;}
  async function replace(before,next,status){
    const nextStamp=await stamp(next);live();
    // Hashing/migration happens outside the transaction. Compare original bytes
    // again inside one native readwrite transaction, covering separate tabs.
    const committed=await transaction('readwrite',(store,current)=>{
      if(current!==before.raw)return false;
      if(next===undefined)store.delete(key);else store.put(next,key);return true;
    });
    return committed?{status,stamp:nextStamp}:problem('conflict','record-changed');
  }
  return Object.freeze({
    load:()=>perform(async()=>{
      const current=await inspect(),state=current.decoded;
      if(state.status==='loaded')return {status:'loaded',stamp:current.stamp,version,revision:state.record.revision,data:JSON.parse(state.text)};
      if(state.status==='migration-required')return {status:state.status,stamp:current.stamp,version:state.version,targetVersion:version,revision:state.revision};
      return {...state,stamp:current.stamp};
    }),
    save:(data,input)=>perform(async()=>{
      const wanted=expected(input);let encoded;try{encoded=validateData(data);}catch(error){return problem('invalid-input',error instanceof SaveFault?error.code:'invalid-data');}
      const before=await inspect(),state=before.decoded;if(before.stamp!==wanted)return problem('conflict','record-changed');
      if(!['empty','loaded'].includes(state.status))return problem('blocked',state.code??state.status,{stamp:before.stamp});
      if(state.status==='loaded'&&state.text===encoded.text)return {status:'unchanged',stamp:before.stamp,revision:state.record.revision};
      const revision=state.status==='loaded'?state.record.revision+1:1;if(!integer(revision))return problem('blocked','revision-limit');
      let next;try{next=wire(encoded.data,revision);}catch{return problem('invalid-input','data-limit');}
      const result=await replace(before,next,'saved');return result.status==='saved'?{...result,revision}:result;
    }),
    migrate:input=>perform(async()=>{
      const wanted=expected(input),before=await inspect(),state=before.decoded;
      if(before.stamp!==wanted)return problem('conflict','record-changed');
      if(state.status!=='migration-required')return problem('blocked','migration-not-required');
      if(version-state.version>16)return problem('blocked','migration-limit');
      let data=state.record.data;
      try{for(let from=state.version;from<version;from++){if(typeof migrations[from]!=='function')return problem('blocked','migration-unavailable');data=json(migrations[from](freeze(json(data,maxBytes).data)),maxBytes).data;}data=validateData(data).data;}
      catch{return problem('invalid-input','migration-failed');}
      const revision=state.record.revision+1;if(!integer(revision))return problem('blocked','revision-limit');
      let next;try{next=wire(data,revision);}catch{return problem('invalid-input','data-limit');}
      const result=await replace(before,next,'migrated');return result.status==='migrated'?{...result,revision,version}:result;
    }),
    discard:input=>perform(async()=>{
      const wanted=expected(input);if(input.confirm!==true)return problem('blocked','discard-confirmation-required');
      const before=await inspect();if(before.stamp!==wanted)return problem('conflict','record-changed');
      return replace(before,undefined,'discarded');
    }),
    close:async()=>{closed=true;for(const tx of transactions)try{tx.abort();}catch{}await Promise.allSettled([...pending]);db?.close();db=undefined;},
  });
}
