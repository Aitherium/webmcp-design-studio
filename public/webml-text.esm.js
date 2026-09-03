/* webmcp-studio-runtime — generated, minified */
var Dr=Object.defineProperty,Gr=Object.getOwnPropertyNames,A=(e,t)=>function(){return e&&(t=(0,e[Gr(e)[0]])(e=0)),t},re=(e,t)=>{for(var r in t)Dr(e,r,{get:t[r],enumerable:!0})};function $r(e){return e===408||e===429||e>=500}function nt(e){return async(t,r)=>{const n=((r-t+1)/1048576).toFixed(1);let o="";for(let i=1;i<=ve;i++){const s=new AbortController;let a=!1;const u=()=>setTimeout(()=>{a=!0,s.abort()},Pe);let d=u();const l=()=>{clearTimeout(d),d=u()};try{let c;try{c=await fetch(e,{headers:{Range:`bytes=${t}-${r}`},cache:"force-cache",signal:s.signal})}catch(m){if(o=m instanceof Error?m.message:String(m),a&&(o=`stalled (no response for ${Pe/1e3}s)`),i<ve){await Ye(250*2**(i-1));continue}const p=typeof navigator<"u"&&navigator.onLine===!1;throw new Error(`bonsai-gguf: fetch failed for ${n} MB range ${t}-${r} of ${e} after ${ve} attempts${p?" (browser reports OFFLINE)":""}. `+(a?`The server accepted the connection but never answered (stalled ${Pe/1e3}s). `:"")+`If the screen also flickered, the GPU driver reset and took this request with it \u2014 that is a GPU fault, not a network one. Last error: ${o}`)}if(c.status!==206&&c.status!==200){if(o=`HTTP ${c.status}`,$r(c.status)&&i<ve){await Ye(250*2**(i-1));continue}throw new Error(`bonsai-gguf: range GET ${t}-${r} (${n} MB) of ${e} returned ${c.status}`)}try{const m=c.body;if(!m)return new Uint8Array(await c.arrayBuffer());const p=m.getReader(),f=[];let g=0;for(;;){const{done:S,value:v}=await p.read();if(S)break;v&&(l(),f.push(v),g+=v.byteLength)}const h=new Uint8Array(g);let b=0;for(const S of f)h.set(S,b),b+=S.byteLength;return h}catch(m){if(a){if(o=`stalled mid-body (no progress for ${Pe/1e3}s)`,i<ve){await Ye(250*2**(i-1));continue}throw new Error(`bonsai-gguf: range GET ${t}-${r} (${n} MB) of ${e} stalled mid-body (no progress for ${Pe/1e3}s) after ${ve} attempts. Last error: ${o}`)}throw new Error(`bonsai-gguf: reading ${n} MB range body failed (device out of memory?): ${m instanceof Error?m.message:String(m)}`)}}finally{clearTimeout(d)}}throw new Error(`bonsai-gguf: range ${t}-${r} exhausted retries: ${o}`)}}function Ir(e){const t=e.filter(Boolean);if(t.length===0)throw new Error("bonsai-gguf: mirroredRangeFetcher needs at least one URL");if(t.length===1)return nt(t[0]);const r=t.map(n=>nt(n));return async(n,o)=>{const i=[];for(let s=0;s<r.length;s++)try{return await r[s](n,o)}catch(a){i.push(`${t[s]}: ${a instanceof Error?a.message:String(a)}`),s+1<r.length&&console.warn(`[bonsai-gguf] mirror ${s+1}/${r.length} failed, trying next`)}throw new Error(`bonsai-gguf: all ${r.length} mirrors failed for range ${n}-${o}:
`+i.map((s,a)=>`  [${a+1}] ${s}`).join(`
`))}}var ve,Ye,Pe,It,Mt=A({m0(){"use strict";ve=3,Ye=e=>new Promise(t=>setTimeout(t,e)),Pe=2e4,It=class{constructor(e){this.filled=0,this.cursor=0,this.url=e.url,this.fetchRange=e.fetchRange??nt(e.url),this.contentLength=e.contentLength,this.initialWindow=e.initialWindow??1<<20,this.buf=new Uint8Array(0)}get position(){return this.cursor}async ensure(e){if(e<=this.filled)return;let t=Math.max(e,this.filled+this.initialWindow);this.contentLength!==void 0&&(t=Math.min(t,this.contentLength));const r=await this.fetchRange(this.filled,t-1),n=new Uint8Array(this.filled+r.length);if(n.set(this.buf.subarray(0,this.filled),0),n.set(r,this.filled),this.buf=n,this.filled+=r.length,this.filled<e)throw new Error(`bonsai-gguf: underfilled window (have ${this.filled}, need ${e}) \u2014 server may not support ranges`)}async view(e){return await this.ensure(this.cursor+e),new DataView(this.buf.buffer,this.buf.byteOffset+this.cursor,e)}async u8(){const e=(await this.view(1)).getUint8(0);return this.cursor+=1,e}async u32(){const e=(await this.view(4)).getUint32(0,!0);return this.cursor+=4,e}async i32(){const e=(await this.view(4)).getInt32(0,!0);return this.cursor+=4,e}async f32(){const e=(await this.view(4)).getFloat32(0,!0);return this.cursor+=4,e}async f64(){const e=(await this.view(8)).getFloat64(0,!0);return this.cursor+=8,e}async u16(){const e=(await this.view(2)).getUint16(0,!0);return this.cursor+=2,e}async i16(){const e=(await this.view(2)).getInt16(0,!0);return this.cursor+=2,e}async i8(){const e=(await this.view(1)).getInt8(0);return this.cursor+=1,e}async u64(){const e=await this.view(8),t=e.getUint32(0,!0),r=e.getUint32(4,!0);this.cursor+=8;const n=r*4294967296+t;if(!Number.isSafeInteger(n))throw new Error(`bonsai-gguf: u64 ${n} exceeds MAX_SAFE_INTEGER`);return n}async i64(){return this.u64()}async string(){const e=await this.u64();await this.ensure(this.cursor+e);const t=this.buf.subarray(this.cursor,this.cursor+e);return this.cursor+=e,new TextDecoder("utf-8").decode(t)}seek(e){this.cursor=e}async bytes(e,t){return await this.ensure(e+t),this.buf.slice(e,e+t)}}}});function Mr(){return new Promise((e,t)=>{const r=indexedDB.open(Wt,Ct);r.onupgradeneeded=()=>{const n=r.result;n.objectStoreNames.contains(ke)||n.createObjectStore(ke)},r.onsuccess=()=>e(r.result),r.onerror=()=>t(r.error)})}function Wr(e,t){return new Promise((r,n)=>{const i=e.transaction(ke,"readonly").objectStore(ke).get(t);i.onsuccess=()=>{const s=i.result;r(s===void 0?void 0:s instanceof Uint8Array?s:new Uint8Array(s))},i.onerror=()=>n(i.error)})}function Cr(e,t,r){return new Promise((n,o)=>{const i=e.transaction(ke,"readwrite"),s=r.slice();i.objectStore(ke).put(s.buffer,t),i.oncomplete=()=>n(),i.onerror=()=>o(i.error),i.onabort=()=>o(i.error)})}function Ur(e,t,r){let n=null;const o=()=>{if(!n){try{navigator.storage?.persist?.()}catch{}n=Mr().catch(()=>null)}return n};return async(i,s)=>{const a=`${e}#${i}-${s}`,u=await o();if(u)try{const l=await Wr(u,a);if(l)return r?.({bytes:l.byteLength,fromCache:!0}),l}catch{}const d=await t(i,s);return r?.({bytes:d.byteLength,fromCache:!1}),u&&Cr(u,a,d).catch(()=>{}),d}}var Wt,ke,Ct,Kr=A({m1(){"use strict";Wt="bonsai-weights",ke="ranges",Ct=1}});function Xe(e){const t=Ut[e];if(!t)throw new Error(`bonsai-gguf: unsupported ggml type ${e} (not in TYPE_TRAITS)`);return t}function Fr(e,t){const{blockSize:r,typeSize:n}=Xe(e);if(t%r!==0)throw new Error(`bonsai-gguf: element count ${t} not a multiple of block size ${r} for ${Xe(e).name}`);return t/r*n}var Ut,ye,rt,Kt,Ft,Oe=A({m2(){"use strict";Ut={0:{blockSize:1,typeSize:4,name:"F32"},1:{blockSize:1,typeSize:2,name:"F16"},8:{blockSize:32,typeSize:34,name:"Q8_0"},41:{blockSize:128,typeSize:18,name:"Q1_0"},42:{blockSize:128,typeSize:34,name:"Q2_0"}},ye=128,rt=128,Kt=18,Ft=34}});function Qt(e,t){return e+(t-e%t)%t}async function zt(e,t){switch(t){case 0:return e.u8();case 1:return e.i8();case 2:return e.u16();case 3:return e.i16();case 4:return e.u32();case 5:return e.i32();case 6:return e.f32();case 7:return await e.u8()!==0;case 8:return e.string();case 10:return e.u64();case 11:return e.i64();case 12:return e.f64();default:throw new Error(`bonsai-gguf: cannot read scalar of value-type ${t}`)}}async function Qr(e,t){if(t===9){const r=await e.u32(),n=await e.u64();if(r===9)throw new Error("bonsai-gguf: nested arrays are not permitted by the spec");const o=new Array(n);for(let i=0;i<n;i++)o[i]=await zt(e,r);return o}return zt(e,t)}async function zr(e){const t=await e.u32();if(t!==jt)throw new Error(`bonsai-gguf: bad magic 0x${t.toString(16)} (expected 0x46554747)`);const r=await e.u32();if(r!==3)throw new Error(`bonsai-gguf: unsupported GGUF version ${r} (need 3)`);const n=await e.u64(),o=await e.u64(),i={version:r,tensorCount:n,metadataKvCount:o},s=new Map;for(let l=0;l<o;l++){const c=await e.string(),m=await e.u32(),p=await Qr(e,m);s.set(c,p)}const a=Hr(s,"general.alignment",32),u=[];for(let l=0;l<n;l++){const c=await e.string(),m=await e.u32(),p=new Array(m);for(let S=0;S<m;S++)p[S]=await e.u64();const f=await e.u32(),g=await e.u64(),h=p.reduce((S,v)=>S*v,1);Xe(f);const b=Fr(f,h);u.push({name:c,dims:p,type:f,relOffset:g,nElements:h,nBytes:b})}const d=Qt(e.position,a);return jr(u,a),{header:i,kv:s,tensors:u,tensorDataBase:d,alignment:a}}function jr(e,t){if(e.length<2)return;const r=[...e].sort((n,o)=>n.relOffset-o.relOffset);for(let n=0;n<r.length-1;n++){const o=r[n],i=r[n+1].relOffset-o.relOffset,s=Qt(o.nBytes,t);if(i===s)continue;const a=Xe(o.type),u=o.nBytes>0?i/o.nBytes:0;throw new Error(`bonsai-gguf: tensor '${o.name}' (type ${o.type} = ${a.name}) occupies ${i} bytes in the file but this build computes ${o.nBytes} (aligned ${s}) from ${a.blockSize} weights/${a.typeSize} bytes per block \u2014 a factor of ${u.toFixed(4)}. The declared type id does not match the file's actual block geometry, so every read of this tensor would be at the wrong stride and would produce plausible-looking WRONG values rather than an error. If this is a '*_g64' ternary file, it uses group 64 under the same type id 42 and is NOT loadable by this runtime \u2014 use the group-128 '*-Q2_0.gguf' build.`)}}function Hr(e,t,r){const n=e.get(t);return typeof n=="number"?n:typeof n=="bigint"?Number(n):r}var jt,Ht=A({m3(){"use strict";Oe(),jt=1179993927}}),Yt,Xt=A({m4(){"use strict";Yt=class{constructor(e){this.kv=e}raw(e){return this.kv.get(e)}str(e,t){const r=this.kv.get(e);if(typeof r=="string")return r;if(t!==void 0)return t;throw new Error(`bonsai-gguf: missing string key '${e}'`)}num(e,t){const r=this.kv.get(e);if(typeof r=="number")return r;if(typeof r=="bigint")return Number(r);if(t!==void 0)return t;throw new Error(`bonsai-gguf: missing numeric key '${e}'`)}numOpt(e){const t=this.kv.get(e);if(typeof t=="number")return t;if(typeof t=="bigint")return Number(t)}strArray(e){const t=this.kv.get(e);if(Array.isArray(t))return t;throw new Error(`bonsai-gguf: missing string-array key '${e}'`)}numArray(e){const t=this.kv.get(e);if(Array.isArray(t))return t.map(Number);throw new Error(`bonsai-gguf: missing numeric-array key '${e}'`)}get arch(){const e=this.str("general.architecture");return e==="dspark"?"qwen35":e}a(e){return`${this.arch}.${e}`}resolveArchConfig(){return{arch:this.arch,contextLength:this.num(this.a("context_length")),embeddingLength:this.num(this.a("embedding_length")),blockCount:this.num(this.a("block_count")),feedForwardLength:this.num(this.a("feed_forward_length")),headCount:this.num(this.a("attention.head_count")),headCountKv:this.num(this.a("attention.head_count_kv")),keyLength:this.numOpt(this.a("attention.key_length")),valueLength:this.numOpt(this.a("attention.value_length")),rmsEps:this.num(this.a("attention.layer_norm_rms_epsilon"),1e-6),ropeDimensionCount:this.numOpt(this.a("rope.dimension_count")),ropeDimensionSections:(()=>{const t=this.kv.get(this.a("rope.dimension_sections"));return Array.isArray(t)?t.map(Number):[]})(),ropeFreqBase:this.numOpt(this.a("rope.freq_base"))??1e4,ropeScalingType:(()=>{const t=this.kv.get(this.a("rope.scaling.type"));return typeof t=="string"?t:"none"})(),ropeScalingFactor:this.numOpt(this.a("rope.scaling.factor")),ssmConvKernel:this.numOpt(this.a("ssm.conv_kernel")),ssmInnerSize:this.numOpt(this.a("ssm.inner_size")),ssmStateSize:this.numOpt(this.a("ssm.state_size")),ssmGroupCount:this.numOpt(this.a("ssm.group_count")),ssmTimeStepRank:this.numOpt(this.a("ssm.time_step_rank")),fullAttentionInterval:this.numOpt(this.a("full_attention_interval"))}}resolveTokenizer(){return{model:this.str("tokenizer.ggml.model","gpt2"),tokens:this.strArray("tokenizer.ggml.tokens"),merges:(()=>{const e=this.kv.get("tokenizer.ggml.merges");return Array.isArray(e)?e:[]})(),tokenType:(()=>{const e=this.kv.get("tokenizer.ggml.token_type");return Array.isArray(e)?e.map(Number):[]})(),bosTokenId:this.numOpt("tokenizer.ggml.bos_token_id"),eosTokenId:this.numOpt("tokenizer.ggml.eos_token_id")}}}}}),Vt,Jt=A({m5(){"use strict";Vt=class{constructor(e){this.byName=new Map,this.ordered=[],this.tensorDataBase=e.tensorDataBase;for(const t of e.tensors){const r=this.toEntry(t,e.tensorDataBase);this.byName.set(r.name,r),this.ordered.push(r)}this.ordered.sort((t,r)=>t.absStart-r.absStart)}toEntry(e,t){const r=t+e.relOffset;return{name:e.name,type:e.type,dims:e.dims,absStart:r,nBytes:e.nBytes,absEnd:r+e.nBytes}}get(e){const t=this.byName.get(e);if(!t)throw new Error(`bonsai-tensors: no tensor named '${e}'`);return t}has(e){return this.byName.has(e)}withPrefix(e){return this.ordered.filter(t=>t.name.startsWith(e))}coalesce(e,t=1<<20,r=64<<20){const n=[...e].sort((i,s)=>i.absStart-s.absStart),o=[];for(const i of n){const s=o[o.length-1];s&&i.absStart-s.absEnd<=t&&i.absEnd-s.absStart<=r?(s.absEnd=Math.max(s.absEnd,i.absEnd),s.nBytes=s.absEnd-s.absStart,s.members.push(i)):o.push({absStart:i.absStart,absEnd:i.absEnd,nBytes:i.nBytes,members:[i]})}return o}coalesceBlock(e){return this.coalesce(this.withPrefix(`blk.${e}.`))}}}});function Yr(e){const t=e.ssmTimeStepRank??0,r=e.ssmGroupCount??0,n=e.ssmStateSize??0,o=e.ssmInnerSize??t*n,i=r*n,s=r*n,a=i+s+o,u=e.ssmConvKernel??0;if(t<=0||r<=0||n<=0||u<=0)throw new Error(`bonsai-config: '${e.arch}' has no DeltaNet layers \u2014 this in-browser runtime only runs the qwen35 hybrid (Bonsai-27B). Dense sizes run on a local node or the hosted lane instead. (numVHeads=${t}, numKHeads=${r}, headDim=${n}, convKernel=${u})`);if(t%r!==0)throw new Error(`bonsai-config: numVHeads ${t} not divisible by numKHeads ${r}`);if(o!==t*n)throw new Error(`bonsai-config: ssm.inner_size ${o} != numVHeads*headDim ${t*n}`);return{numVHeads:t,numKHeads:r,headDim:n,qDim:i,kDim:s,vDim:o,convDim:a,convKernel:u,vPerKHead:t/r}}function Xr(e,t){const r=t.blockCount,n=t.keyLength&&t.keyLength>0?t.keyLength:t.embeddingLength/t.headCount,o=t.headCount*n,i=o*2,s=[];for(let a=0;a<r;a++){const u=`blk.${a}.`;if(e.ordered.some(f=>f.name.startsWith(u)&&f.name.includes("ssm"))){s.push("linear-attn");continue}if(!(e.has(`${u}attn_k.weight`)||e.has(`${u}attn_v.weight`)||e.ordered.some(f=>f.name.startsWith(u)&&/attn_(k|v)\b/.test(f.name))))throw new Error(`bonsai-config: block ${a} has neither ssm_* nor attn_k/v tensors \u2014 cannot classify layer`);const c=`${u}attn_q.weight`;if(!e.has(c))throw new Error(`bonsai-config: block ${a} has attn_k/v but no '${c}' \u2014 cannot determine whether its attention is gated (qwen35) or plain (qwen3)`);const m=e.get(c).dims,p=m.length>=2?m[m.length-1]:m[0];if(p===i)s.push("full-attn");else if(p===o)s.push("dense-attn");else throw new Error(`bonsai-config: block ${a} '${c}' has output width ${p}, which matches neither plain attention (nHeads*headDim = ${o}) nor gated attention (2*nHeads*headDim = ${i}). headCount=${t.headCount}, headDim=${n} (key_length=${t.keyLength??"absent"}, embedding_length=${t.embeddingLength}). Refusing to guess \u2014 the wrong choice produces fluent garbage, not an error.`)}return s}function Vr(e,t){const r=[];for(let n=0;n<t;n++){const o=`blk.${n}.post_attention_norm.weight`,i=`blk.${n}.ffn_norm.weight`;if(e.has(o))r.push(o);else if(e.has(i))r.push(i);else throw new Error(`bonsai-config: block ${n} has neither '${o}' nor '${i}' \u2014 cannot locate the pre-FFN norm`)}return r}function Jr(e){const t=e.keyLength&&e.keyLength>0?e.keyLength:e.embeddingLength/e.headCount;let r;return e.ssmInnerSize!==void 0&&e.headCount>0&&e.ssmInnerSize%e.headCount===0&&(r=e.ssmInnerSize/e.headCount),{headDim:t,deltaNetDv:r}}function Zr(e){const{headDim:t,deltaNetDv:r}=Jr(e);if(!Number.isInteger(t)||t<=0)throw new Error(`bonsai-config: head_dim (embedding_length ${e.embeddingLength} / head_count ${e.headCount}) = ${t} is not a positive integer \u2014 cannot size attention kernels`);if(t>pe)throw new Error(`bonsai-config: head_dim ${t} exceeds the WGSL fixed array bound ${pe} (softmax_attn.wgsl acc[${pe}]) \u2014 refusing to load; the kernel would read out of bounds on the GPU`);if(r!==void 0&&r>pe)throw new Error(`bonsai-config: DeltaNet d_v ${r} (ssm.inner_size ${e.ssmInnerSize} / head_count ${e.headCount}) exceeds the WGSL fixed array bound ${pe} (deltanet.wgsl err/o[${pe}]) \u2014 refusing to load`);const n=r!==void 0?`, DeltaNet d_v=${r}`:"";return{message:`head_dim=${t}${n} (<= ${pe})`}}function eo(e,t){const r=Xr(t,e),n=[],o=[];r.forEach((a,u)=>(a==="linear-attn"?o:n).push(u));const i=o.length>0?Yr(e):void 0,s=Vr(t,e.blockCount);return{...e,layerKinds:r,fullAttnLayers:n,linearAttnLayers:o,deltaNet:i,ffnNormNames:s}}function to(e){const t=e.fullAttnLayers.length+e.linearAttnLayers.length;if(t!==e.blockCount)return{ok:!1,message:`layer kinds (${t}) != blockCount (${e.blockCount})`};if(e.linearAttnLayers.length===0){const r=e.layerKinds.filter(n=>n==="dense-attn").length;return{ok:!0,message:`dense: ${r} plain-attn / ${e.blockCount-r} gated-attn, no DeltaNet`}}return e.blockCount===64&&e.fullAttnLayers.length!==16&&console.warn(`bonsai-config: Bonsai-27B expected 16 full-attn layers (64 blocks), got ${e.fullAttnLayers.length}. This may be a model variant; loading anyway.`),{ok:!0,message:`${e.fullAttnLayers.length} full-attn / ${e.linearAttnLayers.length} linear-attn`}}var pe,Zt=A({m6(){"use strict";pe=256}});function no(){const e=[];for(let o=33;o<=126;o++)e.push(o);for(let o=161;o<=172;o++)e.push(o);for(let o=174;o<=255;o++)e.push(o);const t=[...e];let r=0;for(let o=0;o<256;o++)e.includes(o)||(e.push(o),t.push(256+r),r++);const n=new Map;for(let o=0;o<e.length;o++)n.set(e[o],String.fromCodePoint(t[o]));return n}function ro(e,t,r=[]){const n=new Map;e.forEach((l,c)=>n.set(l,c));const o=new Map;t.forEach((l,c)=>o.set(l,c));const i=no(),s=new Map;i.forEach((l,c)=>s.set(l,c));const a=[],u=r.length===e.length;e.forEach((l,c)=>{(u?r[c]===tn||r[c]===nn:l.length>=5&&l.startsWith("<|")&&l.endsWith("|>"))&&a.push([l,c])}),a.sort((l,c)=>c[0].length-l[0].length);const d=new Map(a);return{vocab:n,idToToken:e,mergeRank:o,byteEncoder:i,byteDecoder:s,specialTokens:d}}function oo(e,t){if(e.length<2)return e;let r=e;for(;;){let n=1/0,o=-1;for(let i=0;i<r.length-1;i++){const s=t.get(`${r[i]} ${r[i+1]}`);s!==void 0&&s<n&&(n=s,o=i)}if(o===-1)break;r=[...r.slice(0,o),r[o]+r[o+1],...r.slice(o+2)]}return r}function io(e){let t=it.get(e);if(t===void 0){if(e.specialTokens.size===0)t=null;else{const r=[...e.specialTokens.keys()].map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|");t=new RegExp(r,"g")}it.set(e,t)}return t}function en(e,t,r){let n=e;for(;n.length>0;){ot.lastIndex=0;const o=ot.exec(n);if(!o)break;const i=o[0],a=new TextEncoder().encode(i),u=Array.from(a,l=>t.byteEncoder.get(l)),d=oo(u,t.mergeRank);for(const l of d){const c=t.vocab.get(l);if(c!==void 0)r.push(c);else for(const m of l){const p=t.vocab.get(m);p!==void 0&&r.push(p)}}n=n.slice(i.length)}}function ao(e,t){const r=[],n=io(t);let o=0;if(n){n.lastIndex=0;let i;for(;(i=n.exec(e))!==null;)i.index>o&&en(e.slice(o,i.index),t,r),r.push(t.specialTokens.get(i[0])),o=i.index+i[0].length}return o<e.length&&en(e.slice(o),t,r),r}function so(e,t){let r="";for(const o of e){const i=t.idToToken[o];i!==void 0&&(r+=i)}const n=[];for(const o of r){const i=t.byteDecoder.get(o);i!==void 0&&n.push(i)}return new TextDecoder("utf-8",{fatal:!1}).decode(new Uint8Array(n))}var tn,nn,ot,it,uo=A({m7(){"use strict";tn=3,nn=4,ot=/'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu,it=new WeakMap}});function lo(e,t=!0,r){let n="";if(r&&r.length>0){n+=`<|im_start|>system
`,e[0]?.role==="system"&&(n+=e[0].content+`

`),n+=`# Tools

You may call one or more functions to assist with the user query.

`,n+=`You are provided with function signatures within <tools></tools> XML tags:
`,n+="<tools>";for(const i of r)n+=`
`+JSON.stringify(i);n+=`
</tools>

`,n+=`For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:
`,n+=`<tool_call>
`,n+=`{"name": <function-name>, "arguments": <args-json-object>}
`,n+="</tool_call>",n+=`<|im_end|>
`}else e[0]?.role==="system"&&(n+=`<|im_start|>system
${e[0].content}<|im_end|>
`);const o=r&&r.length>0&&e[0]?.role==="system"||!r&&e[0]?.role==="system"?1:0;for(let i=o;i<e.length;i++){const s=e[i];if(s.role==="user")n+=`<|im_start|>user
${s.content}<|im_end|>
`;else if(s.role==="assistant"){let a=s.content,u=s.reasoning_content||"";if(u?n+=`<|im_start|>assistant
<think>
${u.trim()}
</think>

`:n+=`<|im_start|>assistant
`,a&&(n+=a),s.tool_calls&&s.tool_calls.length>0)for(const d of s.tool_calls){a&&(n+=`
`);const l=d.function||d;n+=`<tool_call>
`,n+=JSON.stringify({name:l.name,arguments:typeof l.arguments=="string"?JSON.parse(l.arguments):l.arguments}),n+=`
</tool_call>`}n+=`<|im_end|>
`}else s.role==="tool"&&(n+=`<|im_start|>user
<tool_response>
${s.content}
</tool_response><|im_end|>
`)}return t&&(n+=`<|im_start|>assistant
<think>

</think>

`),n}var rn=A({m8(){"use strict"}}),on,an=A({m9(){"use strict";uo(),rn(),on=class{constructor(e){this.tables=ro(e.tokens,e.merges,e.tokenType),this.bosTokenId=e.bosTokenId,this.eosTokenId=e.eosTokenId,this.thinkStartId=this.tables.specialTokens.get("<think>"),this.thinkEndId=this.tables.specialTokens.get("</think>");const t=new Set;e.eosTokenId!==void 0&&t.add(e.eosTokenId);for(const r of["<|im_end|>","<|endoftext|>"]){const n=this.tables.specialTokens.get(r);n!==void 0&&t.add(n)}this.stopIds=t}get vocabSize(){return this.tables.idToToken.length}encode(e){return ao(e,this.tables)}decode(e){return so(e,this.tables)}encodeChat(e,t){return this.encode(lo(e,!0,t))}isStop(e){return this.stopIds.has(e)}isEos(e){return this.eosTokenId!==void 0&&e===this.eosTokenId}}}}),I,sn,Ve=A({m10(){"use strict";I={MAP_READ:1,MAP_WRITE:2,COPY_SRC:4,COPY_DST:8,STORAGE:128,UNIFORM:64},sn={READ:1,WRITE:2}}});function co(e,t){return t>e.limits.maxStorageBufferBindingSize}async function un(e,t,r){const n=await t(r.absStart,r.absEnd-1),o=[];for(const i of r.members){const s=i.absStart-r.absStart,a=n.subarray(s,s+i.nBytes);if(co(e,i.nBytes)){const l=e.limits.maxStorageBufferBindingSize,c=l===ln?" \u2014 this is the WebGPU DEFAULT limit, so the device was almost certainly created without requiredLimits; mirror adapter.limits in requestDevice()":" \u2014 this adapter genuinely caps here; a chunked upload path is required";throw new Error(`bonsai-upload: tensor '${i.name}' (${i.nBytes} B) exceeds maxStorageBufferBindingSize (${l})${c}`)}const u=i.type===cn?ho(a):i.type===dn?po(a):mo(a),d=e.createBuffer({size:u.byteLength,usage:I.STORAGE|I.COPY_DST|I.COPY_SRC,label:i.name});e.queue.writeBuffer(d,0,u),o.push({entry:i,buffer:d})}return o}function ho(e){const t=Math.floor(e.length/We),r=new Uint8Array(t*at);for(let n=0;n<t;n++)r.set(e.subarray(n*We,n*We+We),n*at);return r}function po(e){const t=Math.floor(e.length/Ce),r=new Uint8Array(t*st);for(let n=0;n<t;n++)r.set(e.subarray(n*Ce,n*Ce+Ce),n*st);return r}function mo(e){const t=fo(e.length,4);if(t===e.length)return e;const r=new Uint8Array(t);return r.set(e),r}function fo(e,t){return e+(t-e%t)%t}var ln,cn,dn,We,at,Ce,st,go=A({m11(){"use strict";Ve(),ln=134217728,cn=41,dn=42,We=18,at=20,Ce=34,st=36}}),hn,bo=A({m12(){"use strict";Oe(),go(),hn=class{constructor(e,t,r){this.device=e,this.registry=t,this.fetchRange=r,this.buffers=new Map,this.loadedLayers=new Set,this.inflight=new Map}has(e){return this.buffers.has(e)}get(e){const t=this.buffers.get(e);if(!t)throw new Error(`bonsai-weights: '${e}' not resident (load its layer first)`);return t}typeOf(e){return this.registry.get(e).type}weightQuantType(){if(this.blockQuantType!==void 0)return this.blockQuantType;const e=n=>n===0||n===1,t=this.registry.ordered.filter(n=>n.name.startsWith("blk.")&&!e(n.type));if(t.length===0)throw new Error("bonsai-weights: no quantized 'blk.*' weight tensors in the registry \u2014 cannot determine the model's weight quant type");const r=new Map;for(const n of t)r.has(n.type)||r.set(n.type,n.name);for(const[n,o]of r)if(n!==41&&n!==42)throw new Error(`bonsai-weights: block tensor '${o}' has unsupported quant type ${n} (supported: Q1_0=41, Q2_0=42)`);if(r.size>1){const n=[...r].map(([o,i])=>`${o} (e.g. '${i}')`).join(", ");throw new Error(`bonsai-weights: decoder blocks mix quant types \u2014 ${n}. The block projections dispatch once per context, so a mixed file would silently run some layers through the wrong kernel and emit fluent garbage. Use projectQuantized per tensor to support this.`)}return this.blockQuantType=t[0].type,this.blockQuantType}register(e){for(const t of e)this.buffers.set(t.entry.name,t.buffer)}async loadGlobals(e){const t=e.filter(r=>this.registry.has(r)).map(r=>this.registry.get(r));for(const r of this.registry.coalesce(t))this.register(await un(this.device,this.fetchRange,r))}ensureLayer(e){if(this.loadedLayers.has(e))return Promise.resolve();const t=this.inflight.get(e);if(t)return t;const r=this.loadLayer(e).finally(()=>this.inflight.delete(e));return this.inflight.set(e,r),r}async loadLayer(e){for(const t of this.registry.coalesceBlock(e))this.register(await un(this.device,this.fetchRange,t));this.loadedLayers.add(e)}prefetchLayer(e){e<0||this.loadedLayers.has(e)||this.registry.coalesceBlock(e).length!==0&&this.ensureLayer(e).catch(()=>{})}get residentLayerCount(){return this.loadedLayers.size}evictLayer(e,t){this.inflight.delete(e);for(const r of t){const n=this.buffers.get(r);n&&(n.destroy(),this.buffers.delete(r))}this.loadedLayers.delete(e)}}}}),pn,mn,fn=A({m13(){"use strict";pn=["quantize_q8_0","q1_0_dequant","q1_0_q8_0_matmul","q2_0_dequant","q2_0_q8_0_matmul","kv_quant_4bit","rmsnorm","rope_imrope","softmax_attn","softmax_attn_batched","causal_conv1d","deltanet","deltanet_gate","deltanet_seq","swiglu","sampling","logit_topk","vae_ops","elementwise","elementwise_inplace"],mn=class{constructor(e,t){this.device=e,this.sources=t,this.cache=new Map}get(e,t="main"){const r=t==="main"?e:`${e}:${t}`,n=this.cache.get(r);if(n)return n;const o=this.sources[e];if(!o)throw new Error(`bonsai-pipelines: no WGSL source registered for '${e}'`);const i=this.device.createShaderModule({code:o,label:e}),s=this.device.createComputePipeline({label:r,layout:"auto",compute:{module:i,entryPoint:t}});return this.cache.set(r,s),s}warmAll(){for(const e of pn)if(this.sources[e]){if(e==="logit_topk"){this.get(e,"hist_main"),this.get(e,"gather_main");continue}if(e==="vae_ops"){this.get(e,"conv2d_main"),this.get(e,"groupnorm_main"),this.get(e,"upsample_nearest_main");continue}this.get(e)}}}}});function _o(e){return new gn(e)}var gn,wo=A({m14(){"use strict";Mt(),Kr(),Ht(),Xt(),Jt(),Zt(),an(),bo(),fn(),gn=class{constructor(e){this.deps=e}async load(e){const t=e.mirrorUrls?.length?e.mirrorUrls:[e.modelUrl],r=this.deps.fetchRange??Ir(t),n=this.deps.fetchRange?r:Ur(e.modelUrl,r),o=e.onProgress??(()=>{});o({phase:"parse",percent:2,detail:"range-fetching header + KV"});const i=new It({url:e.modelUrl,fetchRange:n}),s=await zr(i),a=new Yt(s.kv);o({phase:"config",percent:30,detail:`arch=${a.arch}`});const u=new Vt(s),d=a.resolveArchConfig(),l=eo(d,u),c=to(l),m=Zr(l);console.log(`bonsai: kernel dims OK \u2014 ${m.message}`),o({phase:"tokenizer",percent:45,detail:"building BPE tables"});const p=new on(a.resolveTokenizer());o({phase:"pipelines",percent:60,detail:"compiling WGSL"});const f=new mn(this.deps.device,this.deps.kernelSources);f.warmAll(),o({phase:"globals",percent:75,detail:"uploading embeddings + LM head + norms"});const g=new hn(this.deps.device,u,n),h=["token_embd.weight","output_norm.weight"];await g.loadGlobals(h);for(const v of h)if(!g.has(v))throw new Error(`bonsai-runtime: required tensor '${v}' was not found in the GGUF file. The model file may be corrupted or incomplete \u2014 try clearing your browser cache and reloading, or switch to a different model size.`);const b=["output.weight"];try{await g.loadGlobals(b)}catch(v){console.warn(`bonsai-runtime: optional globals not loaded: ${v.message}`)}o({phase:"ready",percent:100});const S={device:this.deps.device,parsed:s,meta:a,registry:u,config:l,tokenizer:p,pipelines:f,weights:g,scheduleOk:c.ok,scheduleMessage:c.message};return this.model=S,S}get loaded(){return this.model}}}});function bn(e){const t=(e&32768)>>15,r=(e&31744)>>10,n=e&1023;return r===0?(t?-1:1)*Math.pow(2,-14)*(n/1024):r===31?n?NaN:t?-1/0:1/0:(t?-1:1)*Math.pow(2,r-15)*(1+n/1024)}function vo(e,t=0){if(e.length-t<Kt)throw new Error("readQ1Block: need 18 bytes");const r=e[t]|e[t+1]<<8,n=e.subarray(t+2,t+2+16);return{d:bn(r),qs:new Uint8Array(n)}}function ko(e,t){return e[t>>3]>>(t&7)&1}function yo(e){const t=new Float32Array(ye);for(let r=0;r<ye;r++)t[r]=ko(e.qs,r)?e.d:-e.d;return t}function So(e,t=0){if(e.length-t<Ft)throw new Error("readQ2Block: need 34 bytes");const r=e[t]|e[t+1]<<8,n=e.subarray(t+2,t+2+32);return{d:bn(r),qs:new Uint8Array(n)}}function Eo(e,t){const r=t>>2,n=(t&3)<<1;return e[r]>>n&3}function Lo(e){const t=new Float32Array(rt);for(let r=0;r<rt;r++){const n=Eo(e.qs,r);t[r]=(n-1)*e.d}return t}var _n,Ao,wn=A({m15(){"use strict";Oe(),_n=new Float32Array(1),Ao=new Uint32Array(_n.buffer)}}),ut,To,xo,Po=A({m16(){"use strict";ut="Numerics ported from owner-owned fork",To=`/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * \xA9 2026 Aitherium, LLC. Original work.
 * ${ut}: github.com/PrismML-Eng/llama.cpp @ branch "prism"
 * GGUF container: public spec ggml-org/ggml docs/gguf.md (format v3).
 * NO third-party WebGPU kernel source was consulted (HF Spaces bonsai-* excluded).
 */`,xo=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// ${ut}: github.com/PrismML-Eng/llama.cpp @ branch "prism"
// NO third-party WebGPU kernel source was consulted (HF Spaces bonsai-* excluded).`}}),Oo=A({m17(){"use strict";wo(),Mt(),Ht(),Xt(),Oe(),Jt(),Zt(),wn(),fn(),an(),rn(),Po()}});function Bo(e){if(e?.isFallbackAdapter===!0)return"software";const t=e?.vendor?.trim().toLowerCase();return t?kn.includes(t)?"software":vn.includes(t)?"integrated":"unknown":"unknown"}function qo(e,t){if(t?.mobile)return 4;switch(e){case"software":case"integrated":return 8;default:return t?.windowsTdr?64:0}}var vn,kn,No=A({m18(){"use strict";vn=["intel","arm","qualcomm","imgtec"],kn=["microsoft"]}});function yn(e,t){return Math.floor((e+t-1)/t)}function Ro(e,t){ht.set(e,Math.max(0,Math.floor(t)))}function Sn(e){ae.has(e)||ae.set(e,{enc:e.createCommandEncoder(),dispatches:0})}function lt(e){const t=ae.get(e);t&&(ae.delete(e),e.queue.submit([t.enc.finish()]))}function Ue(e){const t=ae.get(e);return t?{enc:t.enc,batched:!0}:{enc:e.createCommandEncoder(),batched:!1}}function Ke(e,t){t.batched||e.queue.submit([t.enc.finish()])}function En(e){let t=pt.get(e);return t||(t=new Map,pt.set(e,t)),t}function Do(e){let t=mt.get(e);return t||(t={created:0,reused:0},mt.set(e,t)),t}function ct(e,t){return`${e}:${t}`}function Ln(e,t,r,n,o=!1){const i=En(e),s=ct(t,r),a=i.get(s),u=Do(e);if(globalThis.__BONSAI_NO_POOL===!0)return u.created++,e.createBuffer({size:r,usage:t,label:n});if(a&&a.length>0){u.reused++;const d=a.pop();if(o)return d;const l=Ue(e);return l.enc.clearBuffer(d,0,r),Ke(e,l),d}return u.created++,e.createBuffer({size:r,usage:t,label:n})}function An(e,t){let r=Je.get(e);r||(r=[],Je.set(e,r)),r.push(t)}function Tn(e){const t=Je.get(e);if(!t)return;const r=En(e);for(const n of t){const o=n[Ze];if(o===void 0){try{n.destroy()}catch{}continue}let i=r.get(o);i||(i=[],r.set(o,i)),i.push(n)}t.length=0}function H(e,t,r,n){const o=Math.max(4,dt(t)),i=Ln(e,ft,o,r,n?.queueInit===!0);return i[Ze]=ct(ft,o),i}function Go(e,t,r){const n=Math.max(16,dt(t)),o=Ln(e,gt,n,r,!0);return o[Ze]=ct(gt,n),o}function dt(e){return e+(4-e%4)%4}function M(e,t,r){return e.createBindGroup({layout:t.getBindGroupLayout(0),entries:r.map((n,o)=>({binding:o,resource:{buffer:n}}))})}function W(e,t,r,n,o){const i=ae.get(e),s=i?i.enc:e.createCommandEncoder(),a=s.beginComputePass();a.setPipeline(t),a.setBindGroup(0,r);const u=yn(n,o);if(u<=Fe)a.dispatchWorkgroups(u);else{const l=Fe,c=yn(u,l);if(c>Fe)throw new Error(`bonsai-dispatch: ${u} workgroups exceeds even a 2-D grid (${Fe}^2). This is a context-length bug upstream, not a dispatch bug \u2014 chunk the work.`);a.dispatchWorkgroups(l,c)}if(a.end(),!i){e.queue.submit([s.finish()]);return}i.dispatches++;const d=ht.get(e)??0;d>0&&i.dispatches>=d&&(console.debug(`[bonsai] TDR budget limit reached: submitted ${i.dispatches} dispatches, opening new batch to stay under GPU watchdog deadline`),ae.delete(e),e.queue.submit([i.enc.finish()]),ae.set(e,{enc:e.createCommandEncoder(),dispatches:0}))}function $o(e,t){let r=et.get(e);r||(r=new Map,et.set(e,r));const n=r.get(t);return n&&n.length?n.pop():e.createBuffer({size:t,usage:I.MAP_READ|I.COPY_DST,label:"readback"})}function Io(e,t,r){const n=et.get(e);if(!n){r.destroy();return}let o=n.get(t);if(o||(o=[],n.set(t,o)),o.length>=4){r.destroy();return}o.push(r)}async function Se(e,t,r){lt(e);const n=dt(r),o=$o(e,n),i=e.createCommandEncoder();i.copyBufferToBuffer(t,0,o,0,n),e.queue.submit([i.finish()]),await o.mapAsync(sn.READ);const s=o.getMappedRange().slice(0,r);return o.unmap(),Io(e,n,o),s}function Mo(e){const t=new ArrayBuffer(Wo(e.length*4)),r=new DataView(t);return e.forEach((n,o)=>{n.u32!==void 0?r.setUint32(o*4,n.u32,!0):r.setFloat32(o*4,n.f32??0,!0)}),t}function Wo(e){return e+(16-e%16)%16}var ae,ht,Je,pt,mt,Ze,ft,gt,Fe,et,Ee=A({m19(){"use strict";Ve(),ae=new WeakMap,ht=new WeakMap,Je=new WeakMap,pt=new WeakMap,mt=new WeakMap,Ze=Symbol("aither.poolKey"),ft=I.STORAGE|I.COPY_DST|I.COPY_SRC,gt=I.UNIFORM|I.COPY_DST,Fe=65535,et=new WeakMap}});function xn(e){if(e?.isFallbackAdapter===!0)return"software";const t=e?.vendor?.trim().toLowerCase();return t?qn.includes(t)?"software":Bn.includes(t)?"integrated":"unknown":"unknown"}function Co(e){return Be()?!1:e!=="software"}function Be(){if(typeof navigator>"u")return!1;const e=navigator.userAgent??"";if(/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(e))return!0;const t=navigator.maxTouchPoints??0;return/Macintosh/i.test(e)&&t>1}function Uo(){return!Be()}function Ko(e){return Be()?!1:e?Co(xn(e)):!0}var Pn,On,Bn,qn,bt=A({m20(){"use strict";Pn=6e4,On=18e4,Bn=["intel","arm","qualcomm","imgtec"],qn=["microsoft"]}});function _t(e){return wt.find(t=>t.id===e)}function Nn(e){const t=_t(e)??_t(ze);return Fo(t)}function Fo(e){const t=e.url.split("/").pop();return t?`${Rn.replace(/\/+$/,"")}/${t}`:e.url}function Qo(){if(typeof navigator>"u")return ze;const e=navigator;if(e.connection?.saveData||e.connection?.effectiveType&&/2g/.test(e.connection.effectiveType))return"bonsai-1.7b";const r=e.deviceMemory??4;return Be()?r>=6?"bonsai-4b":"bonsai-1.7b":r>=8?"bonsai-8b":ze}function zo(e){const t=typeof navigator<"u"&&navigator.deviceMemory||4,r=t>=16?32768:t>=8?16384:t>=4?8192:4096;return Math.min(r,e.contextWindow)}var Qe,Rn,wt,ze,Dn=A({m21(){"use strict";bt(),Qe="https://huggingface.co/prism-ml",Rn="https://weights.aitherium.com",wt=[{id:"bonsai-1.7b",label:"Bonsai 1.7B",params:"1.7B",sizeMb:236,url:`${Qe}/Bonsai-1.7B-gguf/resolve/main/Bonsai-1.7B-Q1_0.gguf`,contextWindow:32768,blurb:"The lightest size \u2014 236 MB, runs on phones and older laptops.",arch:"qwen3"},{id:"bonsai-4b",label:"Bonsai 4B",params:"4B",sizeMb:545,url:`${Qe}/Bonsai-4B-gguf/resolve/main/Bonsai-4B-Q1_0.gguf`,contextWindow:32768,blurb:"Balanced: smarter than 1.7B, quick to download and run.",arch:"qwen3"},{id:"bonsai-8b",label:"Bonsai 8B",params:"8B",sizeMb:1104,url:`${Qe}/Bonsai-8B-gguf/resolve/main/Bonsai-8B-Q1_0.gguf`,contextWindow:65536,blurb:"Better reasoning, ~1 GB. Desktop GPU recommended.",arch:"qwen3"},{id:"bonsai-27b-text",label:"Bonsai 27B (Reasoning)",params:"27B",sizeMb:3627,url:`${Qe}/Bonsai-27B-gguf/resolve/main/Bonsai-27B-Q1_0.gguf`,contextWindow:262144,blurb:"Full reasoning brain. 3.6 GB, needs a real desktop GPU.",arch:"qwen35"}],ze="bonsai-4b"}}),Gn={};re(Gn,{WGSL_SOURCES:()=>rr});var $n,In,Mn,Wn,Cn,Un,Kn,Fn,Qn,zn,jn,Hn,Yn,Xn,Vn,Jn,Zn,er,tr,nr,rr,jo=A({m22(){"use strict";$n=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   - depthwise causal 1-D conv over q/k/v projections (short left-padded kernel).
//
// Part of the DeltaNet linear-attention path. Depthwise (per-channel) causal convolution
// with left padding = kernel_size-1, followed by the activation applied in the caller.
// Matches the fork ssm_conv1d contract; the exact activation ordering is transcribed in
// deltanet.wgsl. State carry for streaming decode lives in ssm_state.ts.

struct ConvP {
  n_tokens : u32,
  channels : u32,
  kernel   : u32,   // ssm.conv_kernel
  _p0 : u32,
};

@group(0) @binding(0) var<storage, read>       x       : array<f32>;   // [n_tokens * channels]
@group(0) @binding(1) var<storage, read>       weight  : array<f32>;   // [channels * kernel]
@group(0) @binding(2) var<storage, read>       bias    : array<f32>;   // [channels]
@group(0) @binding(3) var<storage, read_write> out     : array<f32>;   // [n_tokens * channels]
@group(0) @binding(4) var<uniform>             p       : ConvP;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,
        @builtin(local_invocation_id) lid_ : vec3<u32>,
        @builtin(num_workgroups) nwg_ : vec3<u32>) {
  // one thread per (token, channel)
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression, so the working 27B numerics are untouched.
  let idx = (wg_.x + wg_.y * nwg_.x) * 64u + lid_.x;
  let total = p.n_tokens * p.channels;
  if (idx >= total) { return; }
  let token = idx / p.channels;
  let ch    = idx % p.channels;

  var sum : f32 = bias[ch];
  for (var kk : u32 = 0u; kk < p.kernel; kk = kk + 1u) {
    // causal: output token t depends on inputs [t-(kernel-1) .. t]; left-pad with 0
    let offset = i32(token) - i32(p.kernel - 1u - kk);
    if (offset >= 0) {
      let xv = x[u32(offset) * p.channels + ch];
      sum = sum + xv * weight[ch * p.kernel + kk];
    }
  }
  out[idx] = sum;   // activation applied by caller (SiLU) per fork ordering
}
`,In=`// ============================================================================
// DEPRECATED / NOT ON THE LIVE PATH (verified 2026-07-24).
//
// Token generation uses deltanet_seq.wgsl. This kernel's only dispatcher is
// ops.ts::deltanetStep, which has ZERO callers.
//
// IT ALSO CARRIES OLDER RECURRENCE ALGEBRA than deltanet_seq.wgsl (decay applied
// at a different point), so reading it as "the" delta rule will mislead you \u2014
// an ultracode pass did exactly that. Diff against deltanet_seq.wgsl, or better
// against the authoritative fork:
//   github.com/PrismML-Eng/llama.cpp @ prism
//     src/models/delta-net-base.cpp :: build_delta_net_autoregressive
//     src/models/qwen35.cpp         :: build_layer_attn_linear
// (that repo is PUBLIC and fetchable \u2014 see TECH_DEBT D-837.)
//
// Do not "fix" this file expecting model behaviour to change.
// ============================================================================
// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   - gated DeltaNet recurrence ...... src/llama-model.cpp:1797-1799 (qwen35 shares QWEN3NEXT SSM path)
//   - ssm tensors .................... src/llama-arch.cpp:431-439 (ssm_conv1d/beta/g_a/g_b/a/norm)
//
// HIGHEST ARCHITECTURAL RISK (\xA78 risk #2). Gated delta-rule linear attention on the 48
// linear layers. Per-head state matrix S (d_k x d_v) persisted across decode steps
// (ssm_state.ts). This is the SINGLE-STEP DECODE recurrence (one token). Prefill uses a
// chunked/parallel scan built on the same algebra (implemented in TS-driven dispatch).
//
// Recurrence (per token), transcribed from the fork's DeltaNet reference:
//     err = v - S^T k            (d_v)          "delta" prediction error
//     S   = S * diag(g)          (decay/gate along d_k)
//     S   = S + beta * (k outer err)            rank-1 update
//     o   = S^T q                (d_v)          output
//
// CORRECTNESS NOTE: the exact placement of the gate (before vs after the delta term) and
// whether beta multiplies err or (err scaled) MUST be pinned by the Milestone-5 golden
// vector against the fork before this layer is trusted. The structure below encodes the
// design's stated form; it is the reference the M5 test validates, not an assumed-correct
// final answer.  One workgroup per head; S held in storage (persisted between calls).

struct DeltaP {
  d_k   : u32,
  d_v   : u32,
  head  : u32,
  _p0   : u32,
};

@group(0) @binding(0) var<storage, read>        q     : array<f32>;   // [d_k]
@group(0) @binding(1) var<storage, read>        k     : array<f32>;   // [d_k]
@group(0) @binding(2) var<storage, read>        v     : array<f32>;   // [d_v]
@group(0) @binding(3) var<storage, read>        g     : array<f32>;   // [d_k] gate (diag)
@group(0) @binding(4) var<storage, read>        beta  : array<f32>;   // [1] scalar beta
@group(0) @binding(5) var<storage, read_write>  state : array<f32>;   // [d_k * d_v] persisted S
@group(0) @binding(6) var<storage, read_write>  out   : array<f32>;   // [d_v]
@group(0) @binding(7) var<uniform>              p     : DeltaP;

@compute @workgroup_size(1)
fn main() {
  let dk = p.d_k;
  let dv = p.d_v;
  let b  = beta[0];

  // err = v - S^T k    (S is [d_k x d_v], row i = state[i*dv + j])
  var err : array<f32, 256>;   // d_v <= 256
  for (var j : u32 = 0u; j < dv; j = j + 1u) {
    var sTk : f32 = 0.0;
    for (var i : u32 = 0u; i < dk; i = i + 1u) {
      sTk = sTk + state[i * dv + j] * k[i];
    }
    err[j] = v[j] - sTk;
  }

  // S = S*diag(g) + beta * (k outer err); then o = S^T q
  var o : array<f32, 256>;
  for (var j : u32 = 0u; j < dv; j = j + 1u) { o[j] = 0.0; }

  for (var i : u32 = 0u; i < dk; i = i + 1u) {
    let gi = g[i];
    let ki = k[i];
    let qi = q[i];
    for (var j : u32 = 0u; j < dv; j = j + 1u) {
      let s_new = state[i * dv + j] * gi + b * ki * err[j];
      state[i * dv + j] = s_new;
      o[j] = o[j] + s_new * qi;   // accumulate S^T q with the updated state
    }
  }

  for (var j : u32 = 0u; j < dv; j = j + 1u) { out[j] = o[j]; }
}
`,Mn=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
//
// Gated-DeltaNet per-(token,v-head) scalars, computed from the alpha/beta projections
// and the learnable A_log / dt_bias, exactly as Qwen3-Next's GatedDeltaNet:
//   beta_t = sigmoid(beta_raw)                                  (write strength, (0,1))
//   g_t    = exp( ssm_a * softplus(alpha_raw + dt_bias) ) (decay, (0,1]; ssm_a = -exp(A_log) pre-baked)
// One thread per (token, v-head). H = num_v_heads. Inputs are [n_tokens*H]; A_log and
// dt_bias are per-v-head [H]. softplus is evaluated in the numerically-stable form.

struct GateP { n_tokens : u32, heads : u32, _p0 : u32, _p1 : u32 };

@group(0) @binding(0) var<storage, read>        alpha_raw : array<f32>;   // [n_tokens*H]
@group(0) @binding(1) var<storage, read>        beta_raw  : array<f32>;   // [n_tokens*H]
@group(0) @binding(2) var<storage, read>        a_log     : array<f32>;   // [H]
@group(0) @binding(3) var<storage, read>        dt_bias   : array<f32>;   // [H]
@group(0) @binding(4) var<storage, read_write>  g_out     : array<f32>;   // [n_tokens*H]
@group(0) @binding(5) var<storage, read_write>  beta_out  : array<f32>;   // [n_tokens*H]
@group(0) @binding(6) var<uniform>              p         : GateP;

fn softplus(x : f32) -> f32 {
  // log(1+exp(x)) stable: max(x,0) + log(1 + exp(-|x|))
  return max(x, 0.0) + log(1.0 + exp(-abs(x)));
}

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,
        @builtin(local_invocation_id) lid_ : vec3<u32>,
        @builtin(num_workgroups) nwg_ : vec3<u32>) {
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression, so the working 27B numerics are untouched.
  let idx = (wg_.x + wg_.y * nwg_.x) * 64u + lid_.x;
  let total = p.n_tokens * p.heads;
  if (idx >= total) { return; }
  let h = idx % p.heads;

  let sp = softplus(alpha_raw[idx] + dt_bias[h]);
  // ssm_a is stored PRE-BAKED as -exp(A_log) in the GGUF (verified: blk.0.ssm_a
  // = -0.2629, negative) - the fork multiplies it in DIRECTLY (qwen35.cpp:
  // "gate = alpha_softplus * ssm_a  // -A_log.exp() * softplus"). Applying
  // -exp() AGAIN gave ~3x wrong decay in all 48 DeltaNet layers.
  let a  = a_log[h] * sp;            // <= 0 (a_log holds -exp(A_log) pre-baked)
  g_out[idx]    = exp(a);            // (0,1]
  beta_out[idx] = 1.0 / (1.0 + exp(-beta_raw[idx]));
}
`,Wn=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
//
// Gated DeltaNet (Qwen3-Next) sequential recurrence \u2014 the WHOLE token sequence for a
// layer in ONE dispatch, no host readback. Per v-head state S is [d_k \xD7 d_v] (d_k==d_v==
// head_dim). q/k are grouped: each v-head h reads the k/q of k-head (h / v_per_k). q,k are
// already L2-normalized; v is already conv+SiLU'd; g (decay) and beta (write strength) are
// precomputed per (token,v-head) by deltanet_gate.
//
// Recurrence, per token t, per v-head h (from modeling_qwen3_next GatedDeltaNet):
//   Sdec[i,j] = g_t * S[i,j]                    (scalar decay per head/step)
//   kv[j]     = sum_i Sdec[i,j] * k[i]          (retrieve current key)
//   err[j]    = v[j] - kv[j]
//   S[i,j]    = Sdec[i,j] + k[i] * (beta_t * err[j])   (rank-1 write)
//   o[j]      = (sum_i S[i,j] * q[i]) / sqrt(d_k)      (read-out)
//
// Parallelism: one thread per (v-head h, value-column j). Thread (h,j) owns column j of
// head h's state \u2014 columns are disjoint across threads, so the update is race-free and the
// per-token loop runs inside the thread with NO barriers. Grid = heads * head_dim threads.

struct SeqP {
  n_tokens  : u32,
  v_heads   : u32,   // num_v_heads (48)
  k_heads   : u32,   // num_k_heads (16)
  head_dim  : u32,   // d_k == d_v (128)
  v_per_k   : u32,   // v_heads / k_heads (3)
  _p0 : u32, _p1 : u32, _p2 : u32,
};

@group(0) @binding(0) var<storage, read>        q     : array<f32>;   // [n_tokens * k_heads * head_dim]
@group(0) @binding(1) var<storage, read>        k     : array<f32>;   // [n_tokens * k_heads * head_dim]
@group(0) @binding(2) var<storage, read>        v     : array<f32>;   // [n_tokens * v_heads * head_dim]
@group(0) @binding(3) var<storage, read>        gdec  : array<f32>;   // [n_tokens * v_heads]
@group(0) @binding(4) var<storage, read>        beta  : array<f32>;   // [n_tokens * v_heads]
@group(0) @binding(5) var<storage, read_write>  state : array<f32>;   // [v_heads * head_dim * head_dim]
@group(0) @binding(6) var<storage, read_write>  out   : array<f32>;   // [n_tokens * v_heads * head_dim]
@group(0) @binding(7) var<uniform>              p     : SeqP;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,
        @builtin(local_invocation_id) lid_ : vec3<u32>,
        @builtin(num_workgroups) nwg_ : vec3<u32>) {
  let d   = p.head_dim;
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression, so the working 27B numerics are untouched.
  let idx = (wg_.x + wg_.y * nwg_.x) * 64u + lid_.x;
  let total = p.v_heads * d;
  if (idx >= total) { return; }

  let h = idx / d;            // v-head
  let j = idx % d;            // value column this thread owns
  // Fork-verified GQA mapping: ggml_repeat_4d TILES cyclically (dst head i1*ne01+k1
  // reads src head k1), so v-head h uses k-head (h % k_heads) - NOT h / v_per_k
  // (interleave). The old mapping paired 32 of 48 v-heads with the wrong q/k.
  let kh = h % p.k_heads;     // shared k/q head for this v-head (cyclic, fork parity)
  let sbase = h * d * d;      // base of head h's [d\xD7d] state
  let inv_scale = inverseSqrt(f32(d));

  for (var t : u32 = 0u; t < p.n_tokens; t = t + 1u) {
    let qb = (t * p.k_heads + kh) * d;
    let vb = (t * p.v_heads + h) * d;
    let g  = gdec[t * p.v_heads + h];
    let b  = beta[t * p.v_heads + h];

    // pass 1: kv[j] = sum_i (g*S[i,j]) * k[i]
    var kv : f32 = 0.0;
    for (var i : u32 = 0u; i < d; i = i + 1u) {
      kv = kv + g * state[sbase + i * d + j] * k[qb + i];
    }
    let err = v[vb + j] - kv;

    // pass 2: write S[:,j] and read out o[j] = (sum_i S_new[i,j] * q[i]) / sqrt(d)
    var o : f32 = 0.0;
    for (var i : u32 = 0u; i < d; i = i + 1u) {
      let s_new = g * state[sbase + i * d + j] + k[qb + i] * (b * err);
      state[sbase + i * d + j] = s_new;
      o = o + s_new * q[qb + i];
    }
    out[vb + j] = o * inv_scale;
  }
}
`,Cn=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   - residual add / mul / copy helpers used between decoder sub-layers.
//
// Op selector via a uniform: 0=add, 1=mul, 2=copy(a). Element-wise over length n.

struct EW { n : u32, op : u32, _p0 : u32, _p1 : u32 };

@group(0) @binding(0) var<storage, read>       a   : array<f32>;
@group(0) @binding(1) var<storage, read>       b   : array<f32>;
@group(0) @binding(2) var<storage, read_write> out : array<f32>;
@group(0) @binding(3) var<uniform>             p   : EW;

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,
        @builtin(local_invocation_id) lid_ : vec3<u32>,
        @builtin(num_workgroups) nwg_ : vec3<u32>) {
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression, so the working 27B numerics are untouched.
  let i = (wg_.x + wg_.y * nwg_.x) * 256u + lid_.x;
  if (i >= p.n) { return; }
  switch (p.op) {
    case 0u: { out[i] = a[i] + b[i]; }   // residual add
    case 1u: { out[i] = a[i] * b[i]; }
    default: { out[i] = a[i]; }          // copy
  }
}
`,Un=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// In-place elementwise (io = io OP b) \u2014 single read_write binding for the accumulator to
// avoid the read/read_write aliasing WebGPU rejects. Pairs with elementwise.wgsl.
// op: 0=add, 1=mul, 2=copy(no-op), 3=silu (unary: io = io*sigmoid(io), b ignored).
struct EW { n : u32, op : u32, _p0 : u32, _p1 : u32 };
@group(0) @binding(0) var<storage, read_write> io : array<f32>;
@group(0) @binding(1) var<storage, read>       b  : array<f32>;
@group(0) @binding(2) var<uniform>             p  : EW;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,
        @builtin(local_invocation_id) lid_ : vec3<u32>,
        @builtin(num_workgroups) nwg_ : vec3<u32>) {
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression, so the working 27B numerics are untouched.
  let i = (wg_.x + wg_.y * nwg_.x) * 256u + lid_.x;
  if (i >= p.n) { return; }
  switch (p.op) {
    case 0u: { io[i] = io[i] + b[i]; }
    case 1u: { io[i] = io[i] * b[i]; }
    case 3u: { let z = io[i]; io[i] = z / (1.0 + exp(-z)); }   // SiLU
    case 4u: { io[i] = io[i] / (1.0 + exp(-b[i])); }          // io *= sigmoid(b) (attn out-gate)
    default: { }
  }
}
`,Kn=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//
// 4-bit KV cache quantizer. One workgroup per (pos, kv_head) ROW; the 128 lanes cooperate
// over head_dim (DPT=2 dims/lane, head_dim=128 on every Bonsai size). Contract (matches
// reference.ts packKvRow4bit):
//     scale = roundF16(max_abs / 7)          // f16 emitted as u32 low 16 bits
//     raw   = clamp(roundAwayFromZero(x/scaleStored) + 8, 0, 15)
//     packed row = head_dim nibbles, 8 per u32, LSB-first
// The attention kernel (softmax_attn_batched) dequantizes with (f32(raw) - 8.0) * scale.
// raw 0 is unreachable (|x|/amax <= 1 so x/scale <= 7/1 after the f16 round); the clamp
// exists because scale is f16-rounded and x/scale can exceed 7 by a hair, so raw 15 (all
// ones) is the saturating ceiling for the largest magnitudes \u2014 exactly symmetric to Q8_0.
//
// Output layout per row (4-byte aligned):
//   scales[row]        : u32  \u2014 f16 scale in the LOW 16 bits
//   packed[row\xB7words + w] : u32 \u2014 8 nibbles per word, word 0 holds elements 0..7, etc.
// Requires head_dim % 8 == 0 for the flat element index -> word index (e>>3) mapping used
// by the attention kernel to be row-local, AND head_dim <= 128 because one workgroup is
// exactly 128 lanes with one dim per lane. Both asserted on the host (KvCache ctor); a
// head_dim > 128 would leave the tail of every row unquantized silently, so it must throw.

const QK4 : u32 = 8u;   // nibbles per u32
const WG4 : u32 = 128u; // lanes per row (matches head_dim on every Bonsai size)
const DPT : u32 = 2u;   // dims per lane (head_dim <= 256 asserted on the host)

struct QP {
  head_dim : u32,
  n_rows   : u32,
  row_base : u32,   // dest row offset = posBase * n_heads_kv (absolute position base)
  _p0      : u32,
};

@group(0) @binding(0) var<storage, read>       x      : array<f32>;  // n_rows * head_dim
@group(0) @binding(1) var<storage, read_write> packed : array<u32>;  // n_rows * words_per_row
@group(0) @binding(2) var<storage, read_write> scales : array<u32>;  // n_rows
@group(0) @binding(3) var<uniform>             p      : QP;

var<workgroup> shared_amax : array<f32, 128>;
// Quantized NIBBLES are exchanged as u32 (low 4 bits used). They must NOT be round-tripped
// through f32 workgroup memory: a value > 127 would be a signalling NaN bit pattern as f32
// and the GPU canonicalizes NaN on store/load (same rule as quantize_q8_0.wgsl).
var<workgroup> shared_q : array<u32, 128>;

@compute @workgroup_size(128)
fn main(@builtin(workgroup_id) wg : vec3<u32>, @builtin(local_invocation_id) lid : vec3<u32>,
        @builtin(num_workgroups) nwg : vec3<u32>) {
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression. One WORKGROUP per row, dispatched with workgroupSize=1 on the
  // host (never 128 \u2014 that would divide the group count by 128 and quantize 1/128th of rows).
  let row  = wg.x + wg.y * nwg.x;
  let lane = lid.x;
  let hd   = p.head_dim;
  if (row >= p.n_rows) { return; }

  // per-lane load + abs
  let xv = x[row * hd + lane];
  shared_amax[lane] = abs(xv);
  workgroupBarrier();

  // tree reduce max-abs across 128 lanes
  var stride : u32 = 64u;
  loop {
    if (stride == 0u) { break; }
    if (lane < stride) {
      shared_amax[lane] = max(shared_amax[lane], shared_amax[lane + stride]);
    }
    workgroupBarrier();
    stride = stride >> 1u;
  }

  let amax = shared_amax[0];
  // round scale through f16 exactly (pack/unpack) so quantization uses the stored scale \u2014
  // the attention kernel divides by THIS value, not by the full-precision amax/7.
  let scale_f16 = pack2x16float(vec2<f32>(amax / 7.0, 0.0)) & 0xffffu;
  let scale     = unpack2x16float(scale_f16).x;
  let id        = select(0.0, 1.0 / scale, scale != 0.0);

  // quantize this lane's value to a 0..15 nibble. WGSL round() rounds half away from zero,
  // which is the SAME tie rule the CPU reference implements (Math.sign*Math.round).
  let raw = clamp(round(xv * id) + 8.0, 0.0, 15.0);
  shared_q[lane] = u32(raw) & 0xFu;
  workgroupBarrier();

  if (lane == 0u) {
    let row_abs = p.row_base + row;
    scales[row_abs] = scale_f16;
    let words = (hd + QK4 - 1u) / QK4;
    for (var w : u32 = 0u; w < words; w = w + 1u) {
      var v : u32 = 0u;
      for (var k : u32 = 0u; k < QK4; k = k + 1u) {
        let idx = w * QK4 + k;
        v = v | (select(0u, shared_q[idx], idx < hd) << (k * 4u));
      }
      packed[row_abs * words + w] = v;
    }
  }
}
`,Fn=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
//
// SELECT THE TOP-K LOGITS ON THE GPU, so decode stops shipping the whole vocabulary to the
// host every single token.
//
// \u2500\u2500 WHY (measured 2026-07-31) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// sampleToken() read back the ENTIRE logits row \u2014 vocab 248,320 x 4 B \u2248 993 KB \u2014 per token,
// then picked the top-k in JS. Once the attention kernel was parallelised, that readback
// became the single largest cost in the decode loop. Splitting the sample phase into its two
// halves settled which half, and it was not the half the code comments worried about:
//
//     sample=83.9ms  [readback=83.4ms  select=0.4ms]     (4B, 1285-token context)
//
// The JS selection pass over a quarter-million floats costs FOUR TENTHS of a millisecond.
// The transfer around it costs two hundred times that, and it scales with nothing useful \u2014
// it is the same 993 KB whether the answer is one token or a thousand. So the fix is not a
// better loop, it is to stop moving the data: select on the device and return a few hundred
// bytes. Pooling the staging buffer first was tried and did NOT move the number.
//
// \u2500\u2500 HOW, AND WHY IT IS EXACT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// A parallel exact top-k is awkward in WGSL (no cross-workgroup reduction primitive), and a
// per-block top-1 is NOT exact \u2014 the whole top-k can live inside one block. So: threshold,
// then gather.
//
//   pass 1 \`hist\`   \u2014 histogram every logit into NBINS bins over a FIXED logit range.
//                     Fixed, so no max-reduction pass is needed first; out-of-range values
//                     clamp into the end bins, which keeps them findable rather than lost.
//   host            \u2014 read NBINS u32 (4 KB), walk from the top bin down accumulating counts
//                     until at least K have been seen. That bin's lower edge is a threshold
//                     T with a PROVEN property: at least K logits are >= T.
//   pass 2 \`gather\` \u2014 append every (index, value) with value >= T into a compact list via an
//                     atomic counter. Read back only the counter and that list.
//
// Every logit >= T is collected, and at least K logits are >= T, so the true top-K is a
// SUBSET of what comes back. The host then does an exact top-k over a few hundred candidates
// instead of 248,320 \u2014 the same code that already cost 0.4 ms, now on a smaller input.
//
// OVERFLOW IS NOT SILENTLY WRONG. If more candidates clear T than the output can hold, the
// gather writes what fits and the counter keeps counting, so the host sees count > capacity
// and FALLS BACK to the full readback. That is slow and correct, which is the right way
// round; dropping candidates would silently change which token is sampled, and a sampling
// bug reads as the model being dumb rather than as a bug.

struct TopKP {
  vocab      : u32,
  n_bins     : u32,
  lo         : f32,   // histogram range, in logit units
  hi         : f32,
  threshold  : f32,   // gather: keep values >= this (ignored by the hist entry point)
  capacity   : u32,   // gather: max pairs the output buffers can hold
  _p0 : u32, _p1 : u32,
};

@group(0) @binding(0) var<storage, read>        logits  : array<f32>;
@group(0) @binding(1) var<storage, read_write>  hist    : array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write>  out_idx : array<u32>;
@group(0) @binding(3) var<storage, read_write>  out_val : array<f32>;
// [0] = number of candidates that cleared the threshold, INCLUDING any that did not fit.
@group(0) @binding(4) var<storage, read_write>  counter : array<atomic<u32>>;
@group(0) @binding(5) var<uniform>              p       : TopKP;

// One thread per logit. 256 is a safe workgroup size everywhere (the spec guarantees 256).
const WG : u32 = 256u;

/** Bin index for a logit value: bin 0 is the TOP of the range, so walking bins in ascending
 *  order walks logits in DESCENDING order \u2014 which is the direction the host needs. */
fn bin_of(v : f32) -> u32 {
  let span = max(p.hi - p.lo, 1e-6);
  // Fraction from the TOP of the range.
  let f = (p.hi - v) / span;
  let b = i32(floor(f * f32(p.n_bins)));
  // Clamp rather than discard: a logit above \`hi\` belongs in the top bin and a logit below
  // \`lo\` in the bottom one. Discarding out-of-range values would make the count wrong, and
  // the threshold derived from it wrong, in the one case that matters most \u2014 an unusually
  // confident token sitting above the assumed range.
  return u32(clamp(b, 0, i32(p.n_bins) - 1));
}

@compute @workgroup_size(256)
fn hist_main(@builtin(global_invocation_id) gid : vec3<u32>,
             @builtin(num_workgroups) nwg : vec3<u32>) {
  // Grid-stride, so the dispatch size does not have to divide the vocabulary and a 2-D
  // workgroup grid (dispatch1D folds past 65535) still covers every element exactly once.
  let stride = nwg.x * nwg.y * WG;
  let start = gid.x + gid.y * nwg.x * WG;
  var i = start;
  loop {
    if (i >= p.vocab) { break; }
    atomicAdd(&hist[bin_of(logits[i])], 1u);
    i = i + stride;
  }
}

@compute @workgroup_size(256)
fn gather_main(@builtin(global_invocation_id) gid : vec3<u32>,
               @builtin(num_workgroups) nwg : vec3<u32>) {
  let stride = nwg.x * nwg.y * WG;
  let start = gid.x + gid.y * nwg.x * WG;
  var i = start;
  loop {
    if (i >= p.vocab) { break; }
    let v = logits[i];
    if (v >= p.threshold) {
      // The counter is incremented even when the slot does not fit, so the host can tell
      // "collected everything" from "there were more than we could hold" and fall back.
      let slot = atomicAdd(&counter[0], 1u);
      if (slot < p.capacity) {
        out_idx[slot] = i;
        out_val[slot] = v;
      }
    }
    i = i + stride;
  }
}
`,Qn=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   - Q1_0 dequant ................... ggml/src/ggml-quants.c:419-437  (QK1_0=128)
//
// Standalone Q1_0 dequant for verification (Milestone 2 round-trip) and any non-hot-path
// wholesale dequant of small tensors. Contract (matches reference.ts dequantQ1Block):
//   block = { f16 d ; u8 qs[16] } = 18 bytes, 128 weights.
//   bit order LSB-first: weight j uses byte qs[j>>3], bit (j & 7).
//   bit == 1 -> +d ;  bit == 0 -> -d   (binary {-1,+1}; NOT ternary \u2014 no zero).
//
// Input packing: each 18-byte block is laid out as 5 u32 (padded) \u2014 word0 low16 = f16 d,
// bytes 2..17 = the 16 sign bytes. We pass blocks as array<u32> with 5 words per block
// (last word half-used) to stay 4-byte aligned. One thread per 128-weight block.

const QK1_0 : u32 = 128u;
const WORDS_PER_BLOCK : u32 = 5u;   // 20 bytes reserved per block (18 used)

@group(0) @binding(0) var<storage, read>       blocks : array<u32>;   // n_blocks * 5
@group(0) @binding(1) var<storage, read_write> out_w  : array<f32>;   // n_blocks * 128
@group(0) @binding(2) var<uniform>             n_blocks : u32;

fn byte_at(block_base: u32, byte_index: u32) -> u32 {
  // byte_index is 0..17 within the block; word = byte_index/4, shift = (byte_index%4)*8
  let word = blocks[block_base + (byte_index >> 2u)];
  let sh   = (byte_index & 3u) * 8u;
  return (word >> sh) & 0xffu;
}

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,
        @builtin(local_invocation_id) lid_ : vec3<u32>,
        @builtin(num_workgroups) nwg_ : vec3<u32>) {
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression, so the working 27B numerics are untouched.
  let block = (wg_.x + wg_.y * nwg_.x) * 64u + lid_.x;
  if (block >= n_blocks) { return; }
  let bb = block * WORDS_PER_BLOCK;

  // f16 d in the low 16 bits of word 0
  let d = unpack2x16float(blocks[bb] & 0xffffu).x;

  let out_base = block * QK1_0;
  for (var j : u32 = 0u; j < QK1_0; j = j + 1u) {
    // sign bytes start at byte offset 2 within the block
    let byte = byte_at(bb, 2u + (j >> 3u));
    let bit  = (byte >> (j & 7u)) & 1u;
    out_w[out_base + j] = select(-d, d, bit == 1u);
  }
}
`,zn=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   - q1_0\xB7q8_0 dot .................. ggml/src/ggml-cpu/quants.c:127-175 (ggml_vec_dot_q1_0_q8_0)
//   - Q1_0 block layout .............. ggml/src/ggml-common.h (QK1_0=128, block_q1_0)
//
// THE core kernel \u2014 reproduces ggml_vec_dot_q1_0_q8_0 EXACTLY. Binary sign selection,
// two-level scaling, integer accumulation. K-TILED with the activation row staged in
// workgroup shared memory: one workgroup owns 64 output cols of ONE row, so the row's
// activation is loaded once per K-tile and reused across all 64 cols (a 64x cut in
// activation global-memory traffic vs the scalar one-thread-per-element version). Weights
// are streamed per-col from global (sequential within a col = cache-friendly).
//
// NUMERICS ARE BIT-IDENTICAL to the scalar kernel: the f32 accumulation ORDER is preserved
// (blocks i ascending, sub-blocks k ascending; the 32-lane acc is INTEGER so order-free).
// Only memory traffic and the workgroup->(row,col) mapping changed.
//
// NON-NEGOTIABLE (verification checklist \xA710):
//   1. bit order LSB-first: weight j uses qs[j>>3], bit (j&7).
//   2. bit==1 -> +q8 ; bit==0 -> -q8  (binary, never zero).
//   3. accumulate sign-selected int8 in i32 FIRST, then * d1(per-32), sum, then * d0(per-128).
//
// Buffers:
//   weights  : array<u32> \u2014 Q1_0, 5 words/block (word0 low16 = f16 d0, bytes2..17 = signs)
//   act_d    : array<u32> \u2014 per-32 f16 activation scales d1 (low 16 bits), one per q8 block
//   act_qs   : array<u32> \u2014 per-32 int8 activations, 8 words/block (4 int8 per word)
//   out      : array<f32> \u2014 [n_rows * n_cols] output features
//   dims     : uniform {K, n_cols, n_rows, col_tiles}  col_tiles = ceil(n_cols/64)
//
// Dispatch: n_rows * col_tiles workgroups of 64 threads. workgroup wg -> row = wg/col_tiles,
// col = (wg%col_tiles)*64 + local. A workgroup NEVER straddles two rows, so the staged
// activation is unambiguous.

const QK1_0 : u32 = 128u;
const WORDS_PER_Q1 : u32 = 5u; // 20-byte GPU block (18 used + 2 pad) \u2014 matches upload.ts repack
const WORDS_PER_Q8 : u32 = 8u;
const TILE_Q1 : u32 = 32u;     // Q1_0 blocks per K-tile (32*128 = 4096 K elements)

struct Dims { K : u32, n_cols : u32, n_rows : u32, col_tiles : u32 };

@group(0) @binding(0) var<storage, read> weights : array<u32>;
@group(0) @binding(1) var<storage, read> act_d   : array<u32>;
@group(0) @binding(2) var<storage, read> act_qs  : array<u32>;
@group(0) @binding(3) var<storage, read_write> out : array<f32>;
@group(0) @binding(4) var<uniform> dims : Dims;

// Staged activation for the current K-tile (shared across all 64 cols of this workgroup's
// row). TILE_Q1 q1-blocks -> TILE_Q1*4 q8-blocks: scales + 8 words each.
var<workgroup> sh_d  : array<u32, 128>;   // TILE_Q1 * 4
var<workgroup> sh_qs : array<u32, 1024>;  // TILE_Q1 * 4 * 8

fn q1_byte(block_base: u32, byte_index: u32) -> u32 {
  let word = weights[block_base + (byte_index >> 2u)];
  return (word >> ((byte_index & 3u) * 8u)) & 0xffu;
}

fn sext8(b: u32) -> i32 {
  return (i32(b) ^ 0x80) - 0x80;
}

@compute @workgroup_size(64)
fn main(@builtin(local_invocation_id) lid : vec3<u32>,
        @builtin(workgroup_id) wid : vec3<u32>,
        @builtin(num_workgroups) nwg : vec3<u32>) {
  let local = lid.x;                 // 0..63
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression, so the working 27B numerics are untouched.
  let wg = wid.x + wid.y * nwg.x;
  let row   = wg / dims.col_tiles;   // uniform across the workgroup
  if (row >= dims.n_rows) { return; } // uniform: whole workgroup returns or none
  let col = (wg % dims.col_tiles) * 64u + local;
  let valid = col < dims.n_cols;

  let n_q1 = dims.K / QK1_0;
  let a_row_q8_base = row * (dims.K / 32u);

  var result : f32 = 0.0;

  var c0 : u32 = 0u;
  loop {
    if (c0 >= n_q1) { break; }
    let cn = min(TILE_Q1, n_q1 - c0);   // q1-blocks in this tile (uniform)
    let n_q8 = cn * 4u;                  // q8-blocks in this tile
    let q8_base = a_row_q8_base + c0 * 4u;

    // Cooperative, coalesced load of this tile's activation into shared (all 64 threads).
    var t : u32 = local;
    loop { if (t >= n_q8) { break; } sh_d[t] = act_d[q8_base + t]; t = t + 64u; }
    t = local;
    loop { if (t >= n_q8 * WORDS_PER_Q8) { break; } sh_qs[t] = act_qs[q8_base * WORDS_PER_Q8 + t]; t = t + 64u; }
    workgroupBarrier();

    if (valid) {
      var il : u32 = 0u;
      loop {
        if (il >= cn) { break; }
        let i  = c0 + il;
        let wb = (col * n_q1 + i) * WORDS_PER_Q1;
        let d0 = unpack2x16float(weights[wb] & 0xffffu).x;   // per-128 weight scale

        var block_sum : f32 = 0.0;
        for (var k : u32 = 0u; k < 4u; k = k + 1u) {
          let qb    = il * 4u + k;                              // shared q8-block index
          let d1    = unpack2x16float(sh_d[qb] & 0xffffu).x;    // per-32 activation scale
          let qs_sh = qb * WORDS_PER_Q8;

          // Hoist the 4 sign bytes for this 32-weight sub-block out of the lane loop.
          // The old q1_byte(wb, 2 + (j>>3)) was a GLOBAL weight read PER LANE \u2014 32 reads
          // that hit only 2 distinct words, re-fetched ~16x each. Weight bandwidth is the
          // decode bottleneck, so this ~8x cut on the hot path matters. Bytes 2+k*4 .. +3.
          let sbb  = 2u + k * 4u;
          let sb0  = q1_byte(wb, sbb);
          let sb1  = q1_byte(wb, sbb + 1u);
          let sb2  = q1_byte(wb, sbb + 2u);
          let sb3  = q1_byte(wb, sbb + 3u);

          var acc : i32 = 0;                                    // INTEGER accumulation (order-free)
          // Process the 32 activations as 8 words \xD7 4 int8s; sign byte = w>>1, bit = (w&1)*4+m.
          for (var wi : u32 = 0u; wi < 8u; wi = wi + 1u) {
            let aword = sh_qs[qs_sh + wi];                      // int8s from shared (one read/4 lanes)
            var sbyte = sb0;
            if (wi >= 6u) { sbyte = sb3; } else if (wi >= 4u) { sbyte = sb2; } else if (wi >= 2u) { sbyte = sb1; }
            let bitbase = (wi & 1u) * 4u;
            for (var m : u32 = 0u; m < 4u; m = m + 1u) {
              let bit = (sbyte >> (bitbase + m)) & 1u;
              let q8  = sext8((aword >> (m * 8u)) & 0xffu);
              acc = acc + select(-q8, q8, bit == 1u);
            }
          }
          block_sum = block_sum + d1 * f32(acc);               // * per-32 scale (k order)
        }
        result = result + d0 * block_sum;                      // * per-128 scale (i order)
        il = il + 1u;
      }
    }
    workgroupBarrier();                 // all threads done reading shared before next tile overwrites
    c0 = c0 + TILE_Q1;
  }

  if (valid) { out[row * dims.n_cols + col] = result; }
}
`,jn=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   - Q2_0 dequant ................... ggml/src/ggml-quants.c ~450 (QK2_0=128)
//
// Standalone Q2_0 dequant for verification (Milestone 2 round-trip) and any non-hot-path
// wholesale dequant of small tensors. Contract (matches reference.ts dequantQ2Block):
//   block = { f16 d ; u8 qs[32] } = 34 bytes, 128 weights.
//   2-bit order LSB-first: weight j uses byte qs[j>>2], bits at ((j&3)<<1).
//   bit pattern (00,01,10,11) -> (\u22121,0,+1,+2) -> (\u2212d,0,+d,+2d) via formula: (q\u22121)\xB7d.
//
// Input packing: each 34-byte block is laid out as 9 u32 (padded) \u2014 word0 low16 = f16 d,
// bytes 2..33 = the 32 packed 2-bit bytes. We pass blocks as array<u32> with 9 words per block
// (last word partially used) to stay 4-byte aligned. One thread per 128-weight block.

const QK2_0 : u32 = 128u;
const WORDS_PER_BLOCK : u32 = 9u;   // 36 bytes reserved per block (34 used + 2 pad)

@group(0) @binding(0) var<storage, read>       blocks : array<u32>;   // n_blocks * 9
@group(0) @binding(1) var<storage, read_write> out_w  : array<f32>;   // n_blocks * 128
@group(0) @binding(2) var<uniform>             n_blocks : u32;

fn byte_at(block_base: u32, byte_index: u32) -> u32 {
  // byte_index is 0..33 within the block; word = byte_index/4, shift = (byte_index%4)*8
  let word = blocks[block_base + (byte_index >> 2u)];
  let sh   = (byte_index & 3u) * 8u;
  return (word >> sh) & 0xffu;
}

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,
        @builtin(local_invocation_id) lid_ : vec3<u32>,
        @builtin(num_workgroups) nwg_ : vec3<u32>) {
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression, so the working 27B numerics are untouched.
  let block = (wg_.x + wg_.y * nwg_.x) * 64u + lid_.x;
  if (block >= n_blocks) { return; }
  let bb = block * WORDS_PER_BLOCK;

  // f16 d in the low 16 bits of word 0
  let d = unpack2x16float(blocks[bb] & 0xffffu).x;

  let out_base = block * QK2_0;
  for (var j : u32 = 0u; j < QK2_0; j = j + 1u) {
    // 2-bit bytes start at byte offset 2 within the block; 4 values per byte
    let byte_index = 2u + (j >> 2u);
    let byte = byte_at(bb, byte_index);
    // LSB-first: 2 bits at offset ((j & 3) << 1)
    let bit_offset = (j & 3u) << 1u;
    let q = (byte >> bit_offset) & 3u;
    // Dequant formula: (q - 1) * d; q \u2208 {0,1,2,3} -> {-1,0,1,2} * d
    out_w[out_base + j] = f32(i32(q) - 1) * d;
  }
}
`,Hn=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   - q2_0\xB7q8_0 dot .................. ggml/src/ggml-cpu/quants.c (ggml_vec_dot_q2_0_q8_0)
//   - Q2_0 block layout .............. ggml/src/ggml-common.h (QK2_0=128, block_q2_0)
//
// THE core Q2_0 kernel \u2014 reproduces ggml_vec_dot_q2_0_q8_0 EXACTLY. 2-bit dequant,
// two-level scaling, integer accumulation. K-TILED with the activation row staged in
// workgroup shared memory: one workgroup owns 64 output cols of ONE row, so the row's
// activation is loaded once per K-tile and reused across all 64 cols (a 64x cut in
// activation global-memory traffic vs the scalar one-thread-per-element version). Weights
// are streamed per-col from global (sequential within a col = cache-friendly).
//
// NUMERICS ARE BIT-IDENTICAL to the scalar kernel: the f32 accumulation ORDER is preserved
// (blocks i ascending, sub-blocks k ascending; the 32-lane acc is INTEGER so order-free).
// Only memory traffic and the workgroup->(row,col) mapping changed.
//
// NON-NEGOTIABLE (verification checklist):
//   1. 2-bit order LSB-first: weight j uses qs[j>>2], bits at ((j&3)<<1).
//   2. bit pattern (00,01,10,11) -> (-1,0,+1,+2) via formula (q-1).
//   3. accumulate (q2bit[lane] - 1) * q8[lane] in i32 FIRST, then * d1(per-32), sum, then * d0(per-128).
//
// Buffers:
//   weights  : array<u32> \u2014 Q2_0, 9 words/block (word0 low16 = f16 d0, bytes2..33 = 2-bit qs)
//   act_d    : array<u32> \u2014 per-32 f16 activation scales d1 (low 16 bits), one per q8 block
//   act_qs   : array<u32> \u2014 per-32 int8 activations, 8 words/block (4 int8 per word)
//   out      : array<f32> \u2014 [n_rows * n_cols] output features
//   dims     : uniform {K, n_cols, n_rows, col_tiles}  col_tiles = ceil(n_cols/64)
//
// Dispatch: n_rows * col_tiles workgroups of 64 threads. workgroup wg -> row = wg/col_tiles,
// col = (wg%col_tiles)*64 + local. A workgroup NEVER straddles two rows, so the staged
// activation is unambiguous.

const QK2_0 : u32 = 128u;
const WORDS_PER_Q2 : u32 = 9u; // 36-byte GPU block (34 used + 2 pad) \u2014 matches upload.ts repack
const WORDS_PER_Q8 : u32 = 8u;
const TILE_Q2 : u32 = 32u;     // Q2_0 blocks per K-tile (32*128 = 4096 K elements)

struct Dims { K : u32, n_cols : u32, n_rows : u32, col_tiles : u32 };

@group(0) @binding(0) var<storage, read> weights : array<u32>;
@group(0) @binding(1) var<storage, read> act_d   : array<u32>;
@group(0) @binding(2) var<storage, read> act_qs  : array<u32>;
@group(0) @binding(3) var<storage, read_write> out : array<f32>;
@group(0) @binding(4) var<uniform> dims : Dims;

// Staged activation for the current K-tile (shared across all 64 cols of this workgroup's
// row). TILE_Q2 q2-blocks -> TILE_Q2*4 q8-blocks: scales + 8 words each.
var<workgroup> sh_d  : array<u32, 128>;   // TILE_Q2 * 4
var<workgroup> sh_qs : array<u32, 1024>;  // TILE_Q2 * 4 * 8

fn q2_byte(block_base: u32, byte_index: u32) -> u32 {
  let word = weights[block_base + (byte_index >> 2u)];
  return (word >> ((byte_index & 3u) * 8u)) & 0xffu;
}

fn sext8(b: u32) -> i32 {
  return (i32(b) ^ 0x80) - 0x80;
}

@compute @workgroup_size(64)
fn main(@builtin(local_invocation_id) lid : vec3<u32>,
        @builtin(workgroup_id) wid : vec3<u32>,
        @builtin(num_workgroups) nwg : vec3<u32>) {
  let local = lid.x;                 // 0..63
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression, so the working 27B numerics are untouched.
  let wg = wid.x + wid.y * nwg.x;
  let row   = wg / dims.col_tiles;   // uniform across the workgroup
  if (row >= dims.n_rows) { return; } // uniform: whole workgroup returns or none
  let col = (wg % dims.col_tiles) * 64u + local;
  let valid = col < dims.n_cols;

  let n_q2 = dims.K / QK2_0;
  let a_row_q8_base = row * (dims.K / 32u);

  var result : f32 = 0.0;

  var c0 : u32 = 0u;
  loop {
    if (c0 >= n_q2) { break; }
    let cn = min(TILE_Q2, n_q2 - c0);   // q2-blocks in this tile (uniform)
    let n_q8 = cn * 4u;                  // q8-blocks in this tile
    let q8_base = a_row_q8_base + c0 * 4u;

    // Cooperative, coalesced load of this tile's activation into shared (all 64 threads).
    var t : u32 = local;
    loop { if (t >= n_q8) { break; } sh_d[t] = act_d[q8_base + t]; t = t + 64u; }
    t = local;
    loop { if (t >= n_q8 * WORDS_PER_Q8) { break; } sh_qs[t] = act_qs[q8_base * WORDS_PER_Q8 + t]; t = t + 64u; }
    workgroupBarrier();

    if (valid) {
      var il : u32 = 0u;
      loop {
        if (il >= cn) { break; }
        let i  = c0 + il;
        let wb = (col * n_q2 + i) * WORDS_PER_Q2;
        let d0 = unpack2x16float(weights[wb] & 0xffffu).x;   // per-128 weight scale

        var block_sum : f32 = 0.0;
        for (var k : u32 = 0u; k < 4u; k = k + 1u) {
          let qb    = il * 4u + k;                              // shared q8-block index
          let d1    = unpack2x16float(sh_d[qb] & 0xffffu).x;    // per-32 activation scale
          let qs_sh = qb * WORDS_PER_Q8;

          // Q2_0 packing: 32 weights in 8 bytes (4 weights per byte, 2 bits each).
          // Hoist the 8 packed bytes for this 32-weight sub-block to avoid per-lane reads.
          // Bytes 2 + k*8 .. +7 (8 bytes per 32-lane sub-block, LSB-first 2-bit order).
          let sbb  = 2u + k * 8u;
          let sb0  = q2_byte(wb, sbb);
          let sb1  = q2_byte(wb, sbb + 1u);
          let sb2  = q2_byte(wb, sbb + 2u);
          let sb3  = q2_byte(wb, sbb + 3u);
          let sb4  = q2_byte(wb, sbb + 4u);
          let sb5  = q2_byte(wb, sbb + 5u);
          let sb6  = q2_byte(wb, sbb + 6u);
          let sb7  = q2_byte(wb, sbb + 7u);

          var acc : i32 = 0;                                    // INTEGER accumulation (order-free)
          // Process the 32 activations as 8 words \xD7 4 int8s. Each lane j within the 32 spans
          // 2 bits at byte (j>>2), offset ((j&3)<<1).
          for (var wi : u32 = 0u; wi < 8u; wi = wi + 1u) {
            let aword = sh_qs[qs_sh + wi];                      // int8s from shared (one read/4 lanes)
            var sbyte = sb0;
            if (wi == 1u) { sbyte = sb1; }
            else if (wi == 2u) { sbyte = sb2; }
            else if (wi == 3u) { sbyte = sb3; }
            else if (wi == 4u) { sbyte = sb4; }
            else if (wi == 5u) { sbyte = sb5; }
            else if (wi == 6u) { sbyte = sb6; }
            else if (wi == 7u) { sbyte = sb7; }
            // Extract 4 2-bit values from sbyte and their paired q8 activations.
            for (var m : u32 = 0u; m < 4u; m = m + 1u) {
              let bit_offset = m << 1u;  // 2 bits at ((m & 3) << 1)
              let q2 = (sbyte >> bit_offset) & 3u;  // extract 2-bit value
              let q8 = sext8((aword >> (m * 8u)) & 0xffu);
              acc = acc + (i32(q2) - 1) * q8;  // formula: (q - 1) * a8
            }
          }
          block_sum = block_sum + d1 * f32(acc);               // * per-32 scale (k order)
        }
        result = result + d0 * block_sum;                      // * per-128 scale (i order)
        il = il + 1u;
      }
    }
    workgroupBarrier();                 // all threads done reading shared before next tile overwrites
    c0 = c0 + TILE_Q2;
  }

  if (valid) { out[row * dims.n_cols + col] = result; }
}
`,Yn=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   - Q8_0 quant ..................... ggml/src/ggml-quants.c (quantize_row_q8_0, QK8_0=32)
//
// Activation quantizer. One workgroup per 32-element block. Contract (matches
// reference.ts quantizeQ8Block):  d = max(|x|)/127 ;  qs[j] = round(x[j]/d) clamped
// [-127,127] ;  d==0 -> qs=0.  d is emitted as f16 bits so the matmul reads exactly the
// value the CPU reference rounds to.
//
// Output layout per block (kept 4-byte aligned): one u32 for the f16 d (low 16 bits),
// then 8 u32 packing the 32 signed int8 qs (4 per u32, little-endian byte order).

const QK8_0 : u32 = 32u;

@group(0) @binding(0) var<storage, read>        activations : array<f32>;   // n_blocks * 32
@group(0) @binding(1) var<storage, read_write>  out_d       : array<u32>;    // n_blocks (f16 in low 16)
@group(0) @binding(2) var<storage, read_write>  out_qs      : array<u32>;    // n_blocks * 8

var<workgroup> shared_amax : array<f32, 32>;
// Quantized int8 values are exchanged as INTEGERS (low 8 bits used). They must NOT be
// round-tripped through f32 workgroup memory: a negative int8's bit pattern is a NaN as
// f32, and the GPU canonicalizes NaN on store/load, corrupting every negative activation
// to 0x7FC00000 (\u22482.1e9) \u2014 which then blows the matmul up ~160,000\xD7. Use a u32 scratch.
var<workgroup> shared_q : array<u32, 32>;

@compute @workgroup_size(32)
fn main(@builtin(workgroup_id) wg : vec3<u32>, @builtin(local_invocation_id) lid : vec3<u32>,
        @builtin(num_workgroups) nwg : vec3<u32>) {
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression, so the working 27B numerics are untouched.
  let block = wg.x + wg.y * nwg.x;
  let lane  = lid.x;
  let base  = block * QK8_0;

  // per-lane load + abs
  let x = activations[base + lane];
  shared_amax[lane] = abs(x);
  workgroupBarrier();

  // tree reduce max-abs across 32 lanes
  var stride : u32 = 16u;
  loop {
    if (stride == 0u) { break; }
    if (lane < stride) {
      shared_amax[lane] = max(shared_amax[lane], shared_amax[lane + stride]);
    }
    workgroupBarrier();
    stride = stride >> 1u;
  }

  let amax = shared_amax[0];
  // round d through f16 exactly (pack/unpack) so quantization uses the stored scale
  let d_f16 = pack2x16float(vec2<f32>(amax / 127.0, 0.0)) & 0xffffu;
  let d     = unpack2x16float(d_f16).x;
  let id    = select(0.0, 1.0 / d, d != 0.0);

  // quantize this lane's value; keep the low 8 bits (two's-complement int8) in a u32
  var q : i32 = i32(round(x * id));
  q = clamp(q, -127, 127);

  // Exchange the 32 quantized bytes via the INTEGER scratch (no f32/NaN round-trip).
  shared_q[lane] = u32(q) & 0xffu;
  workgroupBarrier();

  if (lane == 0u) {
    out_d[block] = d_f16;
    for (var w : u32 = 0u; w < 8u; w = w + 1u) {
      let o = w * 4u;
      out_qs[block * 8u + w] =
          shared_q[o + 0u]
        | (shared_q[o + 1u] << 8u)
        | (shared_q[o + 2u] << 16u)
        | (shared_q[o + 3u] << 24u);
    }
  }
}
`,Xn=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   - RMSNorm ........................ y = x / sqrt(mean(x^2)+eps) * w ; eps from GGUF KV
//
// One workgroup per row; two-pass reduce (sum of squares -> normalize). f32 accumulation
// regardless of f16 storage. Matches reference.ts rmsnorm.

struct Params { n : u32, eps : f32, _p0 : u32, _p1 : u32 };

@group(0) @binding(0) var<storage, read>       x      : array<f32>;   // n_rows * n
@group(0) @binding(1) var<storage, read>       weight : array<f32>;   // n
@group(0) @binding(2) var<storage, read_write> y      : array<f32>;   // n_rows * n
@group(0) @binding(3) var<uniform>             params : Params;

const WG : u32 = 256u;
var<workgroup> partial : array<f32, WG>;

@compute @workgroup_size(WG)
fn main(@builtin(workgroup_id) wg : vec3<u32>, @builtin(local_invocation_id) lid : vec3<u32>,
        @builtin(num_workgroups) nwg : vec3<u32>) {
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression, so the working 27B numerics are untouched.
  let row = wg.x + wg.y * nwg.x;
  let n    = params.n;
  let base = row * n;
  let tid  = lid.x;

  var ss : f32 = 0.0;
  var i : u32 = tid;
  loop {
    if (i >= n) { break; }
    let v = x[base + i];
    ss = ss + v * v;
    i = i + WG;
  }
  partial[tid] = ss;
  workgroupBarrier();

  var stride : u32 = WG >> 1u;
  loop {
    if (stride == 0u) { break; }
    if (tid < stride) { partial[tid] = partial[tid] + partial[tid + stride]; }
    workgroupBarrier();
    stride = stride >> 1u;
  }

  let mean = partial[0] / f32(n);
  let scale = inverseSqrt(mean + params.eps);

  var o : u32 = tid;
  loop {
    if (o >= n) { break; }
    y[base + o] = x[base + o] * scale * weight[o];
    o = o + WG;
  }
}
`,Vn=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   - IMROPE ......................... src/llama-model.cpp:2494-2496 (interleaved, NOT NEOX)
//
// Interleaved multimodal RoPE. "Interleaved" = the t/h/w SECTION cycling per pair
// (all equal for text), NOT component pairing. Pairing is NEOX-style (p, p+rot/2) \u2014
// ggml routes GGML_ROPE_TYPE_IMROPE through rotate_pairs(n_dims, n_dims/2).
// theta_base from qwen35.rope.freq_base,
// rotary width from qwen35.rope.dimension_count. Applied to Q and K after projection,
// before attention.  NOTE (\xA78 risk #5): the interleaved index mapping is a common port
// bug \u2014 the golden-vector test (Milestone 4) pins this against a fork-derived reference.
//
// Pairing used here (fork-verified 2026-07-22): pair p touches components
// (p, p+rot/2). The freq for pair p is theta = pos * freq_base^(-2p/rot).

struct RopeP {
  n_heads   : u32,
  head_dim  : u32,
  rot_dim   : u32,   // rope.dimension_count (<= head_dim)
  pos_base  : u32,   // position of the first token in this batch
  freq_base : f32,
  scale     : f32,   // linear rope scaling factor (1.0 = none)
  _p0 : u32, _p1 : u32,
};

@group(0) @binding(0) var<storage, read_write> data : array<f32>;   // [n_tokens * n_heads * head_dim]
@group(0) @binding(1) var<uniform>             p    : RopeP;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,
        @builtin(local_invocation_id) lid_ : vec3<u32>,
        @builtin(num_workgroups) nwg_ : vec3<u32>) {
  // one thread per (token, head, pair)
  let pairs_per_head = p.rot_dim / 2u;
  let per_token = p.n_heads * pairs_per_head;
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression, so the working 27B numerics are untouched.
  let idx = (wg_.x + wg_.y * nwg_.x) * 64u + lid_.x;

  let token = idx / per_token;
  let rem   = idx % per_token;
  let head  = rem / pairs_per_head;
  let pair  = rem % pairs_per_head;

  let head_base = (token * p.n_heads + head) * p.head_dim;
  // NEOX-style pairing (p, p + rot/2): ggml routes GGML_ROPE_TYPE_IMROPE through
  // rotate_pairs(n_dims, n_dims/2) \u2014 the "interleaved" in IMROPE is the t/h/w SECTION
  // cycling, NOT component pairing. For text all sections carry the same position
  // (e-stream unused: sections [11,11,10,0] cover all 32 pairs), so pairing is the
  // ONLY layout difference. The old (2p, 2p+1) pairing scrambled positional phase.
  let i0 = head_base + pair;            // (p, p + rot/2)
  let i1 = i0 + pairs_per_head;

  let pos   = f32(p.pos_base + token) * p.scale;
  let exponent = -2.0 * f32(pair) / f32(p.rot_dim);
  let theta = pos * pow(p.freq_base, exponent);
  let c = cos(theta);
  let s = sin(theta);

  let x0 = data[i0];
  let x1 = data[i1];
  data[i0] = x0 * c - x1 * s;
  data[i1] = x0 * s + x1 * c;
}
`,Jn=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   - temperature / top-k / top-p sampling (card defaults temp 0.7, top-k 20, top-p 0.95)
//
// v1 strategy: this kernel computes the argmax fast path (temp ~ 0) and a temperature-
// scaled max for numerical stability; full top-k/top-p nucleus truncation is done on the
// host over the reduced candidate set for v1 (simpler + exact), with a GPU bitonic top-k
// as the follow-up optimisation. Runs over the final logits row (~151K vocab).

struct SampleP { vocab : u32, temperature : f32, _p0 : u32, _p1 : u32 };

@group(0) @binding(0) var<storage, read>       logits  : array<f32>;   // [vocab]
@group(0) @binding(1) var<storage, read_write> argmax  : array<u32>;   // [1] best token id
@group(0) @binding(2) var<storage, read_write> maxval  : array<f32>;   // [1] max logit
@group(0) @binding(3) var<uniform>             p       : SampleP;

const WG : u32 = 256u;
var<workgroup> best_val : array<f32, WG>;
var<workgroup> best_idx : array<u32, WG>;

@compute @workgroup_size(WG)
fn main(@builtin(local_invocation_id) lid : vec3<u32>) {
  let tid = lid.x;
  var bv : f32 = -3.0e38;
  var bi : u32 = 0u;
  var i : u32 = tid;
  loop {
    if (i >= p.vocab) { break; }
    let l = logits[i];
    if (l > bv) { bv = l; bi = i; }
    i = i + WG;
  }
  best_val[tid] = bv;
  best_idx[tid] = bi;
  workgroupBarrier();

  var stride : u32 = WG >> 1u;
  loop {
    if (stride == 0u) { break; }
    if (tid < stride) {
      if (best_val[tid + stride] > best_val[tid]) {
        best_val[tid] = best_val[tid + stride];
        best_idx[tid] = best_idx[tid + stride];
      }
    }
    workgroupBarrier();
    stride = stride >> 1u;
  }

  if (tid == 0u) {
    argmax[0] = best_idx[0];
    maxval[0] = best_val[0];
  }
}
`,Zn=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   - scaled-dot-product attention with causal mask + GQA (head_count / head_count_kv).
//
// Full-attention layers (16 of 64). Online (flash-style) softmax to bound memory over
// long context. One workgroup per (query token, query head). K/V read from the 4-bit KV
// cache and dequantized inline (see kvcache.ts / elementwise KV unpack helpers).
// v1: f32 K/V input path (dequant done host/pre-pass); 4-bit inline unpack is a follow-up.

struct AttnP {
  head_dim   : u32,
  n_kv       : u32,   // number of cached keys (context length so far)
  q_head     : u32,   // this query head index
  kv_head    : u32,   // mapped KV head (GQA: q_head / (n_head/n_head_kv))
  scale      : f32,   // 1/sqrt(head_dim)
  _p0 : u32, _p1 : u32, _p2 : u32,
};

@group(0) @binding(0) var<storage, read>       q  : array<f32>;   // [head_dim] for this query
@group(0) @binding(1) var<storage, read>       k  : array<f32>;   // [n_kv * head_dim]
@group(0) @binding(2) var<storage, read>       v  : array<f32>;   // [n_kv * head_dim]
@group(0) @binding(3) var<storage, read_write> out : array<f32>;  // [head_dim]
@group(0) @binding(4) var<uniform>             p   : AttnP;

@compute @workgroup_size(1)
fn main() {
  let hd = p.head_dim;

  // online softmax accumulators
  var m : f32 = -3.0e38;             // running max
  var l : f32 = 0.0;                 // running denom
  var acc : array<f32, 256>;         // running weighted V (head_dim <= 256)
  for (var d : u32 = 0u; d < hd; d = d + 1u) { acc[d] = 0.0; }

  for (var t : u32 = 0u; t < p.n_kv; t = t + 1u) {
    // score = scale * dot(q, k_t)
    var s : f32 = 0.0;
    let kb = t * hd;
    for (var d : u32 = 0u; d < hd; d = d + 1u) { s = s + q[d] * k[kb + d]; }
    s = s * p.scale;

    let m_new = max(m, s);
    let correction = exp(m - m_new);
    let w = exp(s - m_new);
    l = l * correction + w;
    let vb = t * hd;
    for (var d : u32 = 0u; d < hd; d = d + 1u) {
      acc[d] = acc[d] * correction + w * v[vb + d];
    }
    m = m_new;
  }

  let inv = select(0.0, 1.0 / l, l > 0.0);
  for (var d : u32 = 0u; d < hd; d = d + 1u) { out[d] = acc[d] * inv; }
}
`,er=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
//
// Batched causal GQA softmax attention \u2014 the WHOLE (token \xD7 head) grid in ONE dispatch,
// reading Q/K/V straight from the resident buffers. Replaces the per-(token,head) host loop
// that submitted ~n_tokens\xB7n_heads\xB73 GPU commands per layer (the dominant prefill cost).
// One WORKGROUP per (query token, query head); online (flash-style) softmax over the causal
// key range. GQA maps each query head to kv_head = q_head / (n_heads / n_heads_kv).
//
//   q       : [n_tokens \xB7 n_heads   \xB7 head_dim]   (this batch's queries, post-RoPE)
//   k_cache : [kv_len   \xB7 n_heads_kv \xB7 head_dim]  (all keys so far, incl. this batch)
//   v_cache : [kv_len   \xB7 n_heads_kv \xB7 head_dim]
//   out     : [n_tokens \xB7 n_heads   \xB7 head_dim]
// Causal: query at absolute position (pos_base + t) attends to cache positions [0, pos_base+t].
//
// \u2500\u2500 WHY THIS IS PARALLEL OVER head_dim (measured 2026-07-31) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// This kernel was \`@workgroup_size(1)\`: ONE GPU thread per (token, head), walking the entire
// KV cache serially and reading head_dim floats one at a time. For a DECODE step n_tokens is
// 1, so the whole dispatch was n_heads threads \u2014 32 of a 5090's 21,760 lanes \u2014 each doing
// kv_len\xB7head_dim\xB72 serial scalar ops, per layer, per token. Cost was therefore LINEAR in
// context length with a ~1-lane constant, and every read was strided by head_dim (one lane
// touching a whole cache line and using 4 bytes of it).
//
// That is invisible until the prompt grows. Measured on Bonsai-4B, same box, same session:
//
//     prompt tokens   forward/token   tok/s
//     20              111 ms          7.6
//     169             ~128 ms         7.8
//     1285            646 ms          1.0        <- the shipped greeter prompt
//
// The greeter sends its framing plus getToolDefinitions() \u2014 1290 tokens \u2014 so aitherium.com
// visitors were getting ~1 tok/s while the microbenchmark (a 20-token prompt) reported 7.6
// and the engine was blamed. NOTHING regressed in this file; the prompt crossed the point
// where an O(kv_len) single-lane loop dominates the 545 MB of weight matmuls around it.
//
// So: one workgroup per (token, head), WG threads cooperating over head_dim.
//   - thread \`tid\` owns dims {tid, tid+WG, \u2026}, keeping q and the output accumulator in
//     REGISTERS (never workgroup storage \u2014 head_dim\xB7WG floats would blow the 16 KB
//     guaranteed workgroup-storage limit; only the WG-float reduction scratch lives there).
//   - at each position the q\xB7k dot product is a tree reduction across the workgroup, so
//     adjacent threads read ADJACENT k_cache/v_cache elements \u2014 coalesced, one cache line
//     serving the whole warp instead of one lane.
// The position loop stays serial and in the same order, which is what keeps the online
// softmax exact; only the dot product's summation order changes (sequential -> tree), and a
// tree reduction is no less accurate than the sequential sum it replaces. Correctness is
// gated by the whole-model GPU-vs-CPU differential in selftest/, which requires argmax
// agreement \u2014 an attention bug corrupts every downstream logit and shows up there.

struct BAttnP {
  n_tokens   : u32,
  n_heads    : u32,
  n_heads_kv : u32,
  head_dim   : u32,
  pos_base   : u32,   // absolute position of this batch's first token
  scale      : f32,   // 1/sqrt(head_dim)
  mode : u32, _p1 : u32,   // mode: 0 = f32 cache (default), 1 = 4-bit packed cache
};

@group(0) @binding(0) var<storage, read>       q          : array<f32>;
@group(0) @binding(1) var<storage, read>       k_cache    : array<u32>;
@group(0) @binding(2) var<storage, read>       v_cache    : array<u32>;
@group(0) @binding(3) var<storage, read_write> out        : array<f32>;
@group(0) @binding(4) var<uniform>             p          : BAttnP;
// 4-bit mode only (mode==1): per-(pos,kv_head) f16 scales, one u32 per row (f16 in low 16
// bits). In f32 mode these are 4-byte DUMMY buffers, always bound but NEVER indexed \u2014 the
// uniform \`if (p.mode == 1u)\` guard is what keeps them unread, because \`select()\` would
// evaluate both operands and index them OOB at large positions.
@group(0) @binding(5) var<storage, read> k_scale_buf : array<u32>;
@group(0) @binding(6) var<storage, read> v_scale_buf : array<u32>;

// 4-bit dequant read. mode==1: element e (row-aligned, head_dim%8==0 asserted on the host)
// is a NIBBLE: word e>>3, nibble e&7, value (raw-8)*scale. mode==0: the buffer holds raw
// f32 bytes and bitcast reinterprets them \u2014 byte-identical to the historical array<f32>
// binding. The scale is passed in, never re-fetched here.
fn readK(mode : u32, e : u32, scale : f32) -> f32 {
  if (mode == 1u) {
    let w = e >> 3u;
    let n = e & 7u;
    let raw = (k_cache[w] >> (n * 4u)) & 0xFu;
    return (f32(raw) - 8.0) * scale;
  }
  return bitcast<f32>(k_cache[e]);
}
fn readV(mode : u32, e : u32, scale : f32) -> f32 {
  if (mode == 1u) {
    let w = e >> 3u;
    let n = e & 7u;
    let raw = (v_cache[w] >> (n * 4u)) & 0xFu;
    return (f32(raw) - 8.0) * scale;
  }
  return bitcast<f32>(v_cache[e]);
}

// 128 lanes: WebGPU GUARANTEES maxComputeInvocationsPerWorkgroup >= 256 and
// maxComputeWorkgroupSizeX >= 256, so this is portable, and it equals head_dim on every
// Bonsai size (1.7B/4B/8B/27B all use 128) \u2014 i.e. exactly one dim per lane, no tail.
const WG : u32 = 128u;
// head_dim <= 256 (asserted by the host), so at most 2 dims per lane.
const DPT : u32 = 2u;

// Reduction scratch: WG floats = 512 bytes, far under the 16 KB guaranteed limit.
var<workgroup> red : array<f32, 128>;

@compute @workgroup_size(128)
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,
        @builtin(local_invocation_id) lid_ : vec3<u32>,
        @builtin(num_workgroups) nwg_ : vec3<u32>) {
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // wg_.x. The index is now the WORKGROUP's, not the invocation's: the whole workgroup
  // cooperates on one (token, head).
  let idx = wg_.x + wg_.y * nwg_.x;
  let total = p.n_tokens * p.n_heads;
  // UNIFORM across the workgroup (it depends only on workgroup_id), so returning here before
  // the barriers below is legal \u2014 a non-uniform early return would be undefined behaviour.
  if (idx >= total) { return; }

  let tid = lid_.x;
  let hd  = p.head_dim;
  let t   = idx / p.n_heads;         // query token in this batch
  let h   = idx % p.n_heads;         // query head
  let kv_head = h / (p.n_heads / p.n_heads_kv);

  let q_base = (t * p.n_heads + h) * hd;
  let kv_per_pos = p.n_heads_kv * hd;
  let last = p.pos_base + t;         // inclusive causal limit

  // This lane's slice of q and of the output accumulator, held in registers.
  var qv  : array<f32, 2>;
  var acc : array<f32, 2>;
  for (var i : u32 = 0u; i < DPT; i = i + 1u) {
    let d = tid + i * WG;
    qv[i]  = select(0.0, q[q_base + d], d < hd);
    acc[i] = 0.0;
  }

  // online softmax accumulators \u2014 identical algebra to the scalar version, and every lane
  // carries the same m/l because they all consume the same reduced score.
  var m : f32 = -3.0e38;
  var l : f32 = 0.0;

  for (var pos : u32 = 0u; pos <= last; pos = pos + 1u) {
    // Per-(pos,kv_head) f16 scales, fetched ONCE per position. The \`if\` is a uniform branch
    // (the same value for every lane in the workgroup), so it cannot diverge a barrier; it
    // is deliberately NOT a \`select()\`, which would read the dummy 4-byte scale buffer OOB
    // in f32 mode once sIdx grows past element 0.
    var kScale : f32 = 0.0;
    var vScale : f32 = 0.0;
    if (p.mode == 1u) {
      let sIdx = pos * p.n_heads_kv + kv_head;
      kScale = unpack2x16float(k_scale_buf[sIdx]).x;
      vScale = unpack2x16float(v_scale_buf[sIdx]).x;
    }
    let k_base = pos * kv_per_pos + kv_head * hd;
    var part : f32 = 0.0;
    for (var i : u32 = 0u; i < DPT; i = i + 1u) {
      let d = tid + i * WG;
      if (d < hd) { part = part + qv[i] * readK(p.mode, k_base + d, kScale); }
    }
    red[tid] = part;
    workgroupBarrier();

    // Tree reduction. The barrier is OUTSIDE the \`if\`, because a barrier inside non-uniform
    // control flow is undefined behaviour; the trip count is a constant so every lane runs
    // the same number of iterations.
    var stride : u32 = WG / 2u;
    loop {
      if (stride == 0u) { break; }
      if (tid < stride) { red[tid] = red[tid] + red[tid + stride]; }
      workgroupBarrier();
      stride = stride / 2u;
    }

    let s = red[0] * p.scale;

    let m_new = max(m, s);
    let corr  = exp(m - m_new);
    let w     = exp(s - m_new);
    l = l * corr + w;
    let v_base = pos * kv_per_pos + kv_head * hd;
    for (var i : u32 = 0u; i < DPT; i = i + 1u) {
      let d = tid + i * WG;
      if (d < hd) { acc[i] = acc[i] * corr + w * readV(p.mode, v_base + d, vScale); }
    }
    m = m_new;

    // Every lane has now READ red[0]; without this the next iteration's \`red[tid] = part\`
    // could overwrite it while a slower lane is still reading. Silent wrong scores, not a
    // crash \u2014 the failure mode this whole file exists to avoid.
    workgroupBarrier();
  }

  let inv = select(0.0, 1.0 / l, l > 0.0);
  for (var i : u32 = 0u; i < DPT; i = i + 1u) {
    let d = tid + i * WG;
    if (d < hd) { out[q_base + d] = acc[i] * inv; }
  }
}
`,tr=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   - SwiGLU ......................... down( silu(gate(x)) * up(x) ), silu(z)=z*sigmoid(z)
//
// This kernel is ONLY the element-wise silu(gate)*up stage; gate/up/down are Q1_0 matmuls
// (q1_0_q8_0_matmul.wgsl). Matches reference.ts swigluMul.

@group(0) @binding(0) var<storage, read>       gate : array<f32>;
@group(0) @binding(1) var<storage, read>       up   : array<f32>;
@group(0) @binding(2) var<storage, read_write> out  : array<f32>;
@group(0) @binding(3) var<uniform>             n    : u32;

fn silu(z : f32) -> f32 { return z / (1.0 + exp(-z)); }

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,
        @builtin(local_invocation_id) lid_ : vec3<u32>,
        @builtin(num_workgroups) nwg_ : vec3<u32>) {
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression, so the working 27B numerics are untouched.
  let i = (wg_.x + wg_.y * nwg_.x) * 256u + lid_.x;
  if (i >= n) { return; }
  out[i] = silu(gate[i]) * up[i];
}
`,nr=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation.
//
// THE THREE OPS THE VAE DECODER NEEDS AND THE TRANSFORMER DOES NOT.
//
// In-browser image generation was written off as needing a foreign kernel family. It does
// not. \`:8798\` serves FLUX.2 Klein 4B, and the giveaway is in its own tensor names \u2014
// \`transformer_blocks.0.attn.to_q\` \u2014 MMDiT is a diffusion TRANSFORMER: attention + MLP over
// latent patches, which the existing kernels already do. Its text encoder is Qwen3-4B, the
// same architecture family as the Bonsai text models that already run in a visitor's browser.
//
// What genuinely has no equivalent is the VAE DECODER, and only three ops of it. From the
// shipped model's own vae/config.json (AutoencoderKLFlux2):
//
//     block_out_channels : [128, 256, 512, 512]
//     up_block_types     : 4 x UpDecoderBlock2D
//     layers_per_block   : 2
//     latent_channels    : 32
//     norm_num_groups    : 32
//     act_fn             : silu
//
// so the decode graph is: conv_in -> mid(resnet + attn) -> 4 x (2 resnets + 2x upsample)
// -> GroupNorm -> SiLU -> conv_out(3ch). Attention and SiLU already exist. These are the rest.
//
// LAYOUT: NCHW, f32, batch 1 \u2014 one image at a time is what a browser does, and NCHW keeps a
// channel's plane contiguous, which is what makes GroupNorm's reduction a simple range.
//
// PERFORMANCE NOTE, learned the expensive way on softmax_attn_batched: a kernel written as
// one-thread-per-output looks fine and silently becomes the bottleneck when the tensor grows.
// The last up block runs at full output resolution, so at 1024x1024x128 that is 134M outputs.
// conv2d here is one thread per OUTPUT ELEMENT with the reduction inside it \u2014 correct, and
// deliberately the simple version first, because the transformer kernels earned their
// optimisations only after a CPU differential proved them right. Optimise after it is correct
// and after a measurement says which part is slow, not before.

struct ConvP {
  in_c   : u32,
  out_c  : u32,
  h      : u32,   // input height
  w      : u32,   // input width
  k      : u32,   // square kernel size (1 or 3 here)
  pad    : u32,
  stride : u32,
  _p0    : u32,
};

@group(0) @binding(0) var<storage, read>       x       : array<f32>;  // [in_c*h*w]
@group(0) @binding(1) var<storage, read>       weight  : array<f32>;  // [out_c*in_c*k*k]
@group(0) @binding(2) var<storage, read>       bias    : array<f32>;  // [out_c]
@group(0) @binding(3) var<storage, read_write> y       : array<f32>;  // [out_c*oh*ow]
@group(0) @binding(4) var<uniform>             p       : ConvP;

fn out_h() -> u32 { return (p.h + 2u * p.pad - p.k) / p.stride + 1u; }
fn out_w() -> u32 { return (p.w + 2u * p.pad - p.k) / p.stride + 1u; }

/**
 * 2-D convolution, NCHW, one thread per output element.
 *
 * Zero padding is done by SKIPPING out-of-range taps rather than by materialising a padded
 * input. Materialising would allocate another full tensor per layer \u2014 at decoder resolutions
 * that is hundreds of megabytes of pure copy, on a device that is also holding a language
 * model.
 */
@compute @workgroup_size(64)
fn conv2d_main(@builtin(global_invocation_id) gid : vec3<u32>,
               @builtin(num_workgroups) nwg : vec3<u32>) {
  let oh = out_h();
  let ow = out_w();
  let total = p.out_c * oh * ow;
  let idx = gid.x + gid.y * nwg.x * 64u;
  if (idx >= total) { return; }

  let ox = idx % ow;
  let oy = (idx / ow) % oh;
  let oc = idx / (ow * oh);

  var acc : f32 = bias[oc];
  for (var ic : u32 = 0u; ic < p.in_c; ic = ic + 1u) {
    let x_plane = ic * p.h * p.w;
    let w_base = ((oc * p.in_c) + ic) * p.k * p.k;
    for (var ky : u32 = 0u; ky < p.k; ky = ky + 1u) {
      // Signed arithmetic: with pad=1 the first row's taps land at -1, and doing this in
      // u32 wraps to ~4 billion and reads far out of bounds. WebGPU's robust access would
      // return 0 there, which LOOKS like correct zero-padding and is not \u2014 it silently
      // drops the real taps too on the opposite edge.
      let iy = i32(oy * p.stride) + i32(ky) - i32(p.pad);
      if (iy < 0 || iy >= i32(p.h)) { continue; }
      for (var kx : u32 = 0u; kx < p.k; kx = kx + 1u) {
        let ix = i32(ox * p.stride) + i32(kx) - i32(p.pad);
        if (ix < 0 || ix >= i32(p.w)) { continue; }
        acc = acc + x[x_plane + u32(iy) * p.w + u32(ix)] * weight[w_base + ky * p.k + kx];
      }
    }
  }
  y[idx] = acc;
}

struct GroupNormP {
  c       : u32,
  h       : u32,
  w       : u32,
  groups  : u32,
  eps     : f32,
  _p0 : u32, _p1 : u32, _p2 : u32,
};

@group(0) @binding(0) var<storage, read>       gx      : array<f32>;
@group(0) @binding(1) var<storage, read>       gamma   : array<f32>;  // [c]
@group(0) @binding(2) var<storage, read>       beta    : array<f32>;  // [c]
@group(0) @binding(3) var<storage, read_write> gy      : array<f32>;
@group(0) @binding(4) var<uniform>             gp      : GroupNormP;

/**
 * GroupNorm \u2014 one WORKGROUP per group, cooperating over that group's whole slab.
 *
 * NOT one thread per group. A group at decoder sizes is (c/groups) x h x w elements \u2014 with
 * 128 channels, 32 groups and a 512x512 plane that is over a million values, and a single
 * thread walking it is the same one-lane mistake that made attention 8x slower than it had
 * to be. The mean and variance are a parallel reduction; the normalise pass is grid-strided.
 *
 * Two passes over the slab (mean, then variance) rather than the sum/sum-of-squares trick:
 * at f32 with a million-element reduction the one-pass form loses precision exactly where
 * the variance is small, which is where a VAE's activations live.
 */
var<workgroup> red_sum : array<f32, 256>;

@compute @workgroup_size(256)
fn groupnorm_main(@builtin(workgroup_id) wg : vec3<u32>,
                  @builtin(local_invocation_id) lid : vec3<u32>) {
  let g = wg.x;
  if (g >= gp.groups) { return; }        // uniform across the workgroup \u2014 safe with barriers

  let cpg = gp.c / gp.groups;            // channels per group
  let plane = gp.h * gp.w;
  let slab = cpg * plane;                // elements this group owns
  let base = g * slab;
  let tid = lid.x;

  // ---- mean ----
  var s : f32 = 0.0;
  var i : u32 = tid;
  loop {
    if (i >= slab) { break; }
    s = s + gx[base + i];
    i = i + 256u;
  }
  red_sum[tid] = s;
  workgroupBarrier();
  var stride : u32 = 128u;
  loop {
    if (stride == 0u) { break; }
    if (tid < stride) { red_sum[tid] = red_sum[tid] + red_sum[tid + stride]; }
    workgroupBarrier();
    stride = stride / 2u;
  }
  let mean = red_sum[0] / f32(slab);
  workgroupBarrier();

  // ---- variance ----
  var v : f32 = 0.0;
  i = tid;
  loop {
    if (i >= slab) { break; }
    let d = gx[base + i] - mean;
    v = v + d * d;
    i = i + 256u;
  }
  red_sum[tid] = v;
  workgroupBarrier();
  stride = 128u;
  loop {
    if (stride == 0u) { break; }
    if (tid < stride) { red_sum[tid] = red_sum[tid] + red_sum[tid + stride]; }
    workgroupBarrier();
    stride = stride / 2u;
  }
  let inv_std = 1.0 / sqrt(red_sum[0] / f32(slab) + gp.eps);
  workgroupBarrier();

  // ---- normalise + per-CHANNEL affine ----
  // gamma/beta are indexed by absolute channel, not by group: a group spans cpg channels and
  // each has its own scale. Using the group index here is an easy and completely silent
  // error \u2014 the image comes out plausible and wrong.
  i = tid;
  loop {
    if (i >= slab) { break; }
    let ch = g * cpg + (i / plane);
    gy[base + i] = (gx[base + i] - mean) * inv_std * gamma[ch] + beta[ch];
    i = i + 256u;
  }
}

struct UpP {
  c : u32,
  h : u32,
  w : u32,
  scale : u32,
};

@group(0) @binding(0) var<storage, read>       ux : array<f32>;
@group(0) @binding(1) var<storage, read_write> uy : array<f32>;
@group(0) @binding(2) var<uniform>             up : UpP;

/**
 * Nearest-neighbour upsample by an integer factor \u2014 what UpDecoderBlock2D does before its
 * convolution (diffusers' Upsample2D default is nearest, and the conv that follows is what
 * turns the blockiness into detail). Bilinear here would be a different model.
 */
@compute @workgroup_size(64)
fn upsample_nearest_main(@builtin(global_invocation_id) gid : vec3<u32>,
                         @builtin(num_workgroups) nwg : vec3<u32>) {
  let oh = up.h * up.scale;
  let ow = up.w * up.scale;
  let total = up.c * oh * ow;
  let idx = gid.x + gid.y * nwg.x * 64u;
  if (idx >= total) { return; }

  let ox = idx % ow;
  let oy = (idx / ow) % oh;
  let ch = idx / (ow * oh);

  let sx = ox / up.scale;
  let sy = oy / up.scale;
  uy[idx] = ux[ch * up.h * up.w + sy * up.w + sx];
}
`,rr={causal_conv1d:$n,deltanet:In,deltanet_gate:Mn,deltanet_seq:Wn,elementwise:Cn,elementwise_inplace:Un,kv_quant_4bit:Kn,logit_topk:Fn,q1_0_dequant:Qn,q1_0_q8_0_matmul:zn,q2_0_dequant:jn,q2_0_q8_0_matmul:Hn,quantize_q8_0:Yn,rmsnorm:Xn,rope_imrope:Vn,sampling:Jn,softmax_attn:Zn,softmax_attn_batched:er,swiglu:tr,vae_ops:nr}}}),or={};re(or,{F32KvCache:()=>ir});var ir,Ho=A({m23(){"use strict";Ve(),Ee(),ir=class{constructor(e,t){this.device=e,this.cfg=t,this.layers=new Map,this.capacity=t.capacity,this.perPos=t.headCountKv*t.headDim;const n=this.capacity*this.perPos*4;for(const o of t.fullAttnLayers)this.layers.set(o,{k:this.alloc(n,`kv_f32.k.${o}`),v:this.alloc(n,`kv_f32.v.${o}`),length:0})}alloc(e,t){return this.device.createBuffer({size:Math.max(4,e),usage:I.STORAGE|I.COPY_DST|I.COPY_SRC,label:t})}layer(e){const t=this.layers.get(e);if(!t)throw new Error(`bonsai-kv_f32: layer ${e} has no F32 KV cache (not a full-attn layer)`);return t}append(e,t,r,n,o=0,i=0){const s=this.layers.get(e);if(!s)throw new Error(`bonsai-kv_f32: layer ${e} has no F32 KV cache`);if(s.length+n>this.capacity)throw new Error(`bonsai-kv_f32: layer ${e} capacity ${this.capacity} exceeded (length=${s.length}, append=${n})`);const u=s.length*this.perPos*4,l=n*this.perPos*4,c=Ue(this.device);c.enc.copyBufferToBuffer(t,o,s.k,u,l),c.enc.copyBufferToBuffer(r,i,s.v,u,l),Ke(this.device,c),s.length+=n}advance(e){}filledLength(){let e=null;for(const[t,r]of this.layers)if(e===null)e=r.length;else if(r.length!==e)throw new Error(`bonsai-kv_f32: layers disagree on filled length (layer ${t}=${r.length}, expected ${e}) \u2014 the KV cache is inconsistent`);return e??0}currentLength(e){const t=this.layers.get(e);if(!t)throw new Error(`bonsai-kv_f32: layer ${e} has no F32 KV cache`);return t.length}reset(){for(const e of this.layers.values())e.length=0}truncate(e){if(e<0)throw new Error(`bonsai-kv_f32: truncate(${e}) \u2014 negative length`);for(const t of this.layers.values()){if(e>t.length)throw new Error(`bonsai-kv_f32: truncate(${e}) exceeds filled length ${t.length} \u2014 cannot extend a cache by declaration`);t.length=e}}}}}),ar={};re(ar,{SsmState:()=>sr});var sr,Yo=A({m24(){"use strict";Ve(),sr=class{constructor(e,t){this.device=e,this.cfg=t,this.gen=0,this.states=new Map,this.convStates=new Map;const n=t.heads*t.dK*t.dV*4;for(const o of t.linearAttnLayers)this.states.set(o,this.alloc(n,`ssm.S.${o}`));if(t.dConv!==void 0&&t.ssmInnerSize!==void 0){const i=(t.dConv-1)*(t.convDim??t.ssmInnerSize)*4;for(const s of t.linearAttnLayers)this.convStates.set(s,this.alloc(i,`ssm.conv_state.${s}`))}}alloc(e,t){return this.device.createBuffer({size:Math.max(4,e),usage:I.STORAGE|I.COPY_DST|I.COPY_SRC,label:t})}state(e){const t=this.states.get(e);if(!t)throw new Error(`bonsai-ssm: layer ${e} has no DeltaNet state`);return t}convState(e){return this.convStates.get(e)}get generation(){return this.gen}reset(){this.gen++;const e=new Float32Array(this.cfg.heads*this.cfg.dK*this.cfg.dV);for(const t of this.states.values())this.device.queue.writeBuffer(t,0,e);if(this.cfg.dConv!==void 0&&this.cfg.ssmInnerSize!==void 0){const t=this.cfg.convDim??this.cfg.ssmInnerSize,r=new Float32Array((this.cfg.dConv-1)*t);for(const n of this.convStates.values())this.device.queue.writeBuffer(n,0,r)}}}}}),ur={};re(ur,{LOGIT_HIST_BINS:()=>dr,LOGIT_RANGE_HI:()=>cr,LOGIT_RANGE_LO:()=>lr,TOPK_GATHER_CAPACITY:()=>hr,chooseThreshold:()=>Xo});function Xo(e,t,r,n,o){const i=e.length,s=Math.max(r-t,1e-6);let a=0;for(let u=0;u<i;u++)if(a+=e[u],a>=n)return{threshold:r-(u+1)/i*s,expected:a,overflow:a>o,reason:a>o?`bin ${u} of ${i} holds ${a} candidates, over the ${o} the gather can hold`:`bin ${u} of ${i} reaches ${a} candidates for k=${n}`};return{threshold:t,expected:a,overflow:!0,reason:`histogram holds only ${a} counts, fewer than k=${n} \u2014 refusing to threshold`}}var lr,cr,dr,hr,Vo=A({m25(){"use strict";lr=-50,cr=50,dr=1024,hr=2048}}),vt={};re(vt,{Q8_BLOCK:()=>xt,Q8_BYTES_PER_BLOCK:()=>kr,causalConv1d:()=>mr,dbgStats:()=>oi,deltanetGate:()=>br,deltanetSeq:()=>_r,deltanetStep:()=>Zo,elementwise:()=>wr,elementwiseInplace:()=>Ne,f32Buffer:()=>qe,gpuTopK:()=>vr,mulSigmoidInplace:()=>gr,projectQ1:()=>C,projectQuantized:()=>pr,q1q8Matmul:()=>yt,q2q8Matmul:()=>St,quantizeQ8:()=>kt,readbackF32:()=>Re,residualAdd:()=>je,rmsnorm:()=>Z,ropeImrope:()=>Et,sampleArgmax:()=>ri,sampleTiming:()=>me,sampleToken:()=>ni,scratchBuffer:()=>w,siluInplace:()=>Tt,softmaxAttnBatched:()=>Lt,softmaxAttnHead:()=>Jo,swigluMul:()=>At});function qe(e,t,r,n){return H(e,Math.max(tt,t*tt),r,n)}function w(e,t,r,n){const o=qe(e.device,t,r,n);return An(e.device,o),o}function z(e,t){const r=Mo(t),n=Go(e,r.byteLength);return e.queue.writeBuffer(n,0,r),An(e,n),n}function Z(e,t,r,n,o,i,s){const a=z(e.device,[{u32:i},{f32:s},{u32:0},{u32:0}]),u=e.pipelines.get("rmsnorm");W(e.device,u,M(e.device,u,[t,r,n,a]),o,1)}function kt(e,t,r){const n=Math.ceil(r/xt),o=H(e.device,n*4,"act_d"),i=H(e.device,n*8*4,"act_qs"),s=e.pipelines.get("quantize_q8_0");return W(e.device,s,M(e.device,s,[t,o,i]),n,1),{d:o,qs:i,nBlocks:n}}function yt(e,t,r,n,o,i,s){const a=Math.ceil(s/64),u=z(e.device,[{u32:i},{u32:s},{u32:o},{u32:a}]),d=e.pipelines.get("q1_0_q8_0_matmul"),l=M(e.device,d,[t,r.d,r.qs,n,u]);W(e.device,d,l,o*a*64,64)}function St(e,t,r,n,o,i,s){const a=Math.ceil(s/64),u=z(e.device,[{u32:i},{u32:s},{u32:o},{u32:a}]),d=e.pipelines.get("q2_0_q8_0_matmul"),l=M(e.device,d,[t,r.d,r.qs,n,u]);W(e.device,d,l,o*a*64,64)}function C(e,t,r,n,o,i,s){const a=kt(e,t,o*i);e.quantType===42?St(e,r,a,n,o,i,s):yt(e,r,a,n,o,i,s)}function pr(e,t,r,n,o,i,s,a){const u=kt(e,t,o*i);if(a===42)St(e,r,u,n,o,i,s);else if(a===41)yt(e,r,u,n,o,i,s);else throw new Error(`projectQuantized: unsupported weight quant type ${a} (supported: Q1_0=41, Q2_0=42)`)}function Et(e,t,r,n,o,i,s,a,u=1){const d=z(e.device,[{u32:n},{u32:o},{u32:i},{u32:s},{f32:a},{f32:u},{u32:0},{u32:0}]),l=e.pipelines.get("rope_imrope"),c=Math.floor(i/2);W(e.device,l,M(e.device,l,[t,d]),r*n*c,64)}function Jo(e,t,r,n,o,i,s,a,u,d){const l=z(e.device,[{u32:i},{u32:s},{u32:a},{u32:u},{f32:d},{u32:0},{u32:0},{u32:0}]),c=e.pipelines.get("softmax_attn");W(e.device,c,M(e.device,c,[t,r,n,o,l]),1,1)}function Lt(e,t,r,n,o,i,s,a,u,d,l,c,m){const p=!!(c&&m),f=z(e.device,[{u32:i},{u32:s},{u32:a},{u32:u},{u32:d},{f32:l},{u32:p?1:0},{u32:0}]);if(u>256)throw new Error(`bonsai-ops: softmaxAttnBatched supports head_dim <= 256, got ${u}. Raise DPT in softmax_attn_batched.wgsl to ceil(head_dim/128) to extend it.`);if(p&&u%8!==0)throw new Error(`bonsai-ops: softmaxAttnBatched 4-bit mode requires head_dim % 8 == 0, got ${u}.`);const g=e.pipelines.get("softmax_attn_batched"),h=M(e.device,g,[t,r,n,o,f,c??fr(e.device),m??fr(e.device)]);W(e.device,g,h,i*s,1)}function mr(e,t,r,n,o,i,s,a){const u=z(e.device,[{u32:i},{u32:s},{u32:a},{u32:0}]),d=e.pipelines.get("causal_conv1d"),l=M(e.device,d,[t,r,n,o,u]);W(e.device,d,l,i*s,64)}function Zo(e,t,r,n,o,i,s,a,u,d,l){const c=z(e.device,[{u32:u},{u32:d},{u32:l},{u32:0}]),m=e.pipelines.get("deltanet"),p=M(e.device,m,[t,r,n,o,i,s,a,c]);W(e.device,m,p,1,1)}function At(e,t,r,n,o){const i=z(e.device,[{u32:o}]),s=e.pipelines.get("swiglu");W(e.device,s,M(e.device,s,[t,r,n,i]),o,256)}function Ne(e,t,r,n,o){const i=z(e.device,[{u32:n},{u32:o},{u32:0},{u32:0}]),s=e.pipelines.get("elementwise_inplace");W(e.device,s,M(e.device,s,[t,r,i]),n,256)}function ei(e){let t=Pt.get(e);return t||(t=H(e,4,"silu_dummy"),Pt.set(e,t)),t}function fr(e){let t=Ot.get(e);return t||(t=H(e,4,"kv_scale_dummy"),Ot.set(e,t)),t}function gr(e,t,r,n){Ne(e,t,r,n,4)}function Tt(e,t,r){Ne(e,t,ei(e.device),r,3)}function br(e,t,r,n,o,i,s,a,u){const d=z(e.device,[{u32:a},{u32:u},{u32:0},{u32:0}]),l=e.pipelines.get("deltanet_gate"),c=M(e.device,l,[t,r,n,o,i,s,d]);W(e.device,l,c,a*u,64)}function _r(e,t,r,n,o,i,s,a,u,d,l,c,m){const p=z(e.device,[{u32:u},{u32:d},{u32:l},{u32:c},{u32:m},{u32:0},{u32:0},{u32:0}]),f=e.pipelines.get("deltanet_seq"),g=M(e.device,f,[t,r,n,o,i,s,a,p]);W(e.device,f,g,d*c,64)}function wr(e,t,r,n,o,i){if(n===t){Ne(e,n,r,o,i);return}if(n===r){Ne(e,n,t,o,i);return}const s=z(e.device,[{u32:o},{u32:i},{u32:0},{u32:0}]),a=e.pipelines.get("elementwise");W(e.device,a,M(e.device,a,[t,r,n,s]),o,256)}function je(e,t,r,n){Ne(e,t,r,n,0)}function ti(e,t,r,n,o,i){const s=e.length,u=Array.from({length:s},(h,b)=>b).sort((h,b)=>t[b]-t[h]).slice(0,Math.max(1,Math.min(r,s)));if(n<=0)return e[u[0]];const d=t[u[0]],l=new Float64Array(u.length);let c=0;for(let h=0;h<u.length;h++){const b=Math.exp((t[u[h]]-d)/n);l[h]=b,c+=b}if(!(c>0)||!Number.isFinite(c))return e[u[0]];let m=u.length;const p=o.topP??1;if(p>0&&p<1){let h=0;for(let b=0;b<u.length;b++)if(h+=l[b]/c,h>=p){m=b+1;break}}let f=0;for(let h=0;h<m;h++)f+=l[h];let g=i()*f;for(let h=0;h<m;h++)if(g-=l[h],g<=0)return e[u[h]];return e[u[m-1]]}async function ni(e,t,r,n={}){const o=n.temperature??0,i=n.random??Math.random,s=globalThis.__BONSAI_TIMING===!0,a=s?performance.now():0,u=(n.repetitionPenalty??1)!==1&&!!n.recentIds?.length,d=n.topK&&n.topK>0?Math.min(n.topK,r):Math.min(64,r),l=globalThis.__BONSAI_GPU_TOPK===!0;if(!u&&l){const _=await vr(e,t,r,Math.max(d,1));if(_&&_.ids.length){const T=s?performance.now():0;s&&(me.readbackMs+=T-a,me.calls++);const D=ti(_.ids,_.vals,d,o,n,i);return s&&(me.selectMs+=performance.now()-T),D}}const c=await Re(e,t,r),m=s?performance.now():0;s&&(me.readbackMs+=m-a,me.calls++);const p=_=>(s&&(me.selectMs+=performance.now()-m),_),f=n.repetitionPenalty??1;if(f!==1&&n.recentIds?.length)for(const _ of new Set(n.recentIds)){if(_<0||_>=r)continue;const T=c[_];c[_]=T>0?T/f:T*f}if(o<=0){let _=0,T=-1/0;for(let D=0;D<r;D++)c[D]>T&&(T=c[D],_=D);return p(_)}const g=n.topK&&n.topK>0?Math.min(n.topK,r):Math.min(64,r),h=[];let b=-1/0;for(let _=0;_<r;_++){const T=c[_];if(h.length===g&&T<=b)continue;let D=h.length;for(;D>0&&c[h[D-1]]<T;)D--;h.splice(D,0,_),h.length>g&&h.pop(),b=c[h[h.length-1]]}const S=c[h[0]],v=new Float64Array(h.length);let x=0;for(let _=0;_<h.length;_++){const T=Math.exp((c[h[_]]-S)/o);v[_]=T,x+=T}if(!(x>0)||!Number.isFinite(x))return p(h[0]);let E=h.length;const y=n.topP??1;if(y>0&&y<1){let _=0;for(let T=0;T<h.length;T++)if(_+=v[T]/x,_>=y){E=T+1;break}}let P=0;for(let _=0;_<E;_++)P+=v[_];let F=i()*P;for(let _=0;_<E;_++)if(F-=v[_],F<=0)return p(h[_]);return p(h[E-1])}async function ri(e,t,r,n=0){const o=H(e.device,4,"argmax"),i=H(e.device,4,"maxval"),s=z(e.device,[{u32:r},{f32:n},{u32:0},{u32:0}]),a=e.pipelines.get("sampling");W(e.device,a,M(e.device,a,[t,o,i,s]),1,1);const u=await Se(e.device,o,4);return new Uint32Array(u)[0]}async function vr(e,t,r,n){const{chooseThreshold:o,LOGIT_HIST_BINS:i,LOGIT_RANGE_LO:s,LOGIT_RANGE_HI:a,TOPK_GATHER_CAPACITY:u}=await Promise.resolve().then(()=>(Vo(),ur)),d=i,l=u,c=H(e.device,d*4,"topk_hist"),m=H(e.device,l*4,"topk_idx"),p=H(e.device,l*4,"topk_val"),f=H(e.device,4,"topk_count"),g=T=>z(e.device,[{u32:r},{u32:d},{f32:s},{f32:a},{f32:T},{u32:l},{u32:0},{u32:0}]),h=e.pipelines.get("logit_topk","hist_main"),b=g(0);W(e.device,h,M(e.device,h,[t,c,m,p,f,b]),Math.min(r,65536),256);const S=await Se(e.device,c,d*4),v=o(new Uint32Array(S),s,a,n,l);if(v.overflow)return null;const x=e.pipelines.get("logit_topk","gather_main"),E=g(v.threshold);W(e.device,x,M(e.device,x,[t,c,m,p,f,E]),Math.min(r,65536),256);const y=await Se(e.device,f,4),P=new Uint32Array(y)[0];if(P===0||P>l)return null;const F=await Se(e.device,m,P*4),_=await Se(e.device,p,P*4);return{ids:new Uint32Array(F),vals:new Float32Array(_)}}async function Re(e,t,r){const n=await Se(e.device,t,r*tt);return new Float32Array(n)}async function oi(e,t,r,n){const o=await Re(e,t,Math.min(r,8192));let i=0,s=1/0,a=-1/0,u=0;for(let l=0;l<o.length;l++){const c=o[l];Number.isFinite(c)?(c<s&&(s=c),c>a&&(a=c),u+=Math.abs(c)):i++}const d=`${n}[bad=${i} min=${s.toExponential(1)} max=${a.toExponential(1)} mean=${(u/o.length).toExponential(1)}]`;return console.log(`[bonsai] ${d}`),d}var tt,xt,kr,Pt,Ot,me,De=A({m26(){"use strict";Ee(),Oe(),tt=4,xt=32,kr=36,Pt=new WeakMap,Ot=new WeakMap,me={readbackMs:0,selectMs:0,calls:0}}}),yr={};re(yr,{runFullAttnBlock:()=>ii});async function ii(e,t,r){const{hidden:n,nTokens:o,posBase:i}=r,{device:s,pipelines:a,weights:u,config:d,kv:l,kvMode:c}=e,m=d.layerKinds[t],p=m!=="dense-attn",f=Er(m,t,d.ffnNormNames?.[t]),[g,h,b,S,v,x,E,y,P,F,_]=f,{headCount:T,headCountKv:D,embeddingLength:B,keyLength:$e,ropeDimensionCount:Ie,ropeFreqBase:fe,rmsEps:oe}=d,N=T,R=D,k=$e??B/T,ge=1/Math.sqrt(k),Y=Ie??k;await u.ensureLayer(t);const be=u.get(g),X=u.get(h),Le=u.get(b),Ae=u.get(S),Me=u.get(v),Te=u.get(x),xe=u.get(E),_e=u.get(y),we=u.get(P),ie=u.get(F),ee=u.get(_),V=w(e,o*B,"h1_attn");Z(e,n,be,V,o,B,oe);const Q=w(e,o*N*k,"tempQ"),se=w(e,o*R*k,"tempK"),ue=w(e,o*R*k,"tempV"),te=p?w(e,o*N*k,"tempG"):null;if(C(e,V,Le,se,o,B,R*k),C(e,V,Ae,ue,o,B,R*k),p){const L=w(e,o*N*k*2,"tempQG");C(e,V,X,L,o,B,N*k*2);const K=Ue(s),q=N*k*2,de=N*k;for(let he=0;he<o;he++)for(let He=0;He<N;He++){const Gt=(he*q+He*k*2)*4,$t=(he*de+He*k)*4;K.enc.copyBufferToBuffer(L,Gt,Q,$t,k*4),K.enc.copyBufferToBuffer(L,Gt+k*4,te,$t,k*4)}Ke(s,K)}else C(e,V,X,Q,o,B,N*k);const J=w(e,o*N*k,"tempQn"),ne=w(e,o*R*k,"tempKn");Z(e,Q,Me,J,o*N,k,oe),Z(e,se,Te,ne,o*R,k,oe),Et(e,J,o,N,k,Y,i,fe),Et(e,ne,o,R,k,Y,i,fe);const $=w(e,o*N*k,"attn_out");if(c==="4bit"){l.append(t,ne,ue,o,i);const L=l.layer(t);Lt(e,J,L.k,L.v,$,o,N,R,k,i,ge,L.kScale,L.vScale)}else{l.append(t,ne,ue,o,0,0);const{k:L,v:K}=l.layer(t);Lt(e,J,L,K,$,o,N,R,k,i,ge)}p&&gr(e,$,te,o*N*k);const le=w(e,o*B,"attn_out_proj");C(e,$,xe,le,o,N*k,B),je(e,n,le,o*B);const G=w(e,o*B,"h2_ffn");Z(e,n,_e,G,o,B,oe);const ce=w(e,o*d.feedForwardLength,"ffn_gate"),U=w(e,o*d.feedForwardLength,"ffn_up");C(e,G,we,ce,o,B,d.feedForwardLength),C(e,G,ie,U,o,B,d.feedForwardLength);const j=w(e,o*d.feedForwardLength,"ffn_gated_up");At(e,ce,U,j,o*d.feedForwardLength);const O=w(e,o*B,"ffn_out");C(e,j,ee,O,o,d.feedForwardLength,B),je(e,n,O,o*B)}var ai=A({m27(){"use strict";Ee(),De(),qt()}}),Sr={};re(Sr,{runDeltaNetBlock:()=>si});async function si(e,t,r){const n=e.config,o=e.device,i=e.weights,s=n.deltaNet;if(!s)throw new Error(`bonsai-deltanet: layer ${t} routed to the DeltaNet path but this model has no ssm.* geometry (dense model). This is a layer-classification bug, not a bad file.`);const a=r.nTokens,u=n.embeddingLength,d=n.feedForwardLength,l=n.rmsEps,{numVHeads:c,numKHeads:m,headDim:p,qDim:f,kDim:g,vDim:h,convDim:b,convKernel:S,vPerKHead:v}=s,x=Er("linear-attn",t);if(x.length!==14)throw new Error(`block_deltanet layer ${t}: expected 14 tensor names, got ${x.length}`);const[E,y,P,F,_,T,D,B,$e,Ie,fe,oe,N,R]=x;for(const q of x)if(!i.has(q))throw new Error(`block_deltanet layer ${t}: missing tensor '${q}'. This layer is DeltaNet (linear-attn); ensure it was streamed via weights.ensureLayer(${t}).`);const k=w(e,a*u,`dn.${t}.h1`),ge=w(e,a*b,`dn.${t}.qkv`),Y=w(e,a*h,`dn.${t}.z`),be=w(e,a*f,`dn.${t}.qc`),X=w(e,a*g,`dn.${t}.kc`),Le=w(e,a*h,`dn.${t}.vc`),Ae=w(e,a*f,`dn.${t}.qn`),Me=w(e,a*g,`dn.${t}.kn`),Te=w(e,a*c,`dn.${t}.alpha`),xe=w(e,a*c,`dn.${t}.beta`),_e=w(e,a*c,`dn.${t}.g`),we=w(e,a*c,`dn.${t}.betaG`),ie=w(e,a*h,`dn.${t}.recur`),ee=w(e,a*h,`dn.${t}.normOut`),V=w(e,a*u,`dn.${t}.ssmProj`),Q=w(e,a*u,`dn.${t}.h2`),se=w(e,a*d,`dn.${t}.ffnG`),ue=w(e,a*d,`dn.${t}.ffnU`),te=w(e,a*d,`dn.${t}.ffnM`),J=w(e,a*u,`dn.${t}.ffnD`),ne=w(e,b,`dn.${t}.convBias`,{queueInit:!0});o.queue.writeBuffer(ne,0,new Float32Array(b));const $=w(e,p,`dn.${t}.l2w`,{queueInit:!0});o.queue.writeBuffer($,0,new Float32Array(p).fill(1/Math.sqrt(p)));const le=1e-6/p;Z(e,r.hidden,i.get(E),k,a,u,l),C(e,k,i.get(y),ge,a,u,b),C(e,k,i.get(P),Y,a,u,h);const G=S-1,ce=e.ssm.generation??0;let U=Bt.get(e.ssm);U||(U={gen:ce,bufs:new Map,zeroed:new Set},Bt.set(e.ssm,U)),U.gen!==ce&&(U.gen=ce,U.zeroed.clear());let j=U.bufs.get(t);j?U.zeroed.has(t)||(o.queue.writeBuffer(j,0,new Float32Array(G*b)),U.zeroed.add(t)):(j=qe(o,G*b,`dn.${t}.convHist`),U.bufs.set(t,j),o.queue.writeBuffer(j,0,new Float32Array(G*b)),U.zeroed.add(t));const O=w(e,(a+G)*b,`dn.${t}.convIn`),L=w(e,(a+G)*b,`dn.${t}.convOutF`);{const q=Ue(o);q.enc.copyBufferToBuffer(j,0,O,0,G*b*4),q.enc.copyBufferToBuffer(ge,0,O,G*b*4,a*b*4),q.enc.copyBufferToBuffer(O,a*b*4,j,0,G*b*4),Ke(o,q)}mr(e,O,i.get(F),ne,L,a+G,b,S),Tt(e,L,(a+G)*b);{const q=Ue(o);for(let de=0;de<a;de++){const he=(de+G)*b*4;q.enc.copyBufferToBuffer(L,he,be,de*f*4,f*4),q.enc.copyBufferToBuffer(L,he+f*4,X,de*g*4,g*4),q.enc.copyBufferToBuffer(L,he+(f+g)*4,Le,de*h*4,h*4)}Ke(o,q)}Z(e,be,$,Ae,a*m,p,le),Z(e,X,$,Me,a*m,p,le),C(e,k,i.get(T),Te,a,u,c),C(e,k,i.get(_),xe,a,u,c),br(e,Te,xe,i.get(D),i.get(B),_e,we,a,c);const K=e.ssm.state(t);_r(e,Ae,Me,Le,_e,we,K,ie,a,c,m,p,v),Z(e,ie,i.get($e),ee,a*c,p,l),Tt(e,Y,a*h),wr(e,ee,Y,ee,a*h,1),C(e,ee,i.get(Ie),V,a,h,u),je(e,r.hidden,V,a*u),Z(e,r.hidden,i.get(fe),Q,a,u,l),C(e,Q,i.get(oe),se,a,u,d),C(e,Q,i.get(N),ue,a,u,d),At(e,se,ue,te,a*d),C(e,te,i.get(R),J,a,d,u),je(e,r.hidden,J,a*u)}var Bt,ui=A({m28(){"use strict";De(),Ee(),qt(),Bt=new WeakMap}});function Er(e,t,r){const n=`blk.${t}.`;return e==="full-attn"||e==="dense-attn"?[`${n}attn_norm.weight`,`${n}attn_q.weight`,`${n}attn_k.weight`,`${n}attn_v.weight`,`${n}attn_q_norm.weight`,`${n}attn_k_norm.weight`,`${n}attn_output.weight`,r??`${n}post_attention_norm.weight`,`${n}ffn_gate.weight`,`${n}ffn_up.weight`,`${n}ffn_down.weight`]:[`${n}attn_norm.weight`,`${n}attn_qkv.weight`,`${n}attn_gate.weight`,`${n}ssm_conv1d.weight`,`${n}ssm_beta.weight`,`${n}ssm_alpha.weight`,`${n}ssm_a`,`${n}ssm_dt.bias`,`${n}ssm_norm.weight`,`${n}ssm_out.weight`,`${n}post_attention_norm.weight`,`${n}ffn_gate.weight`,`${n}ffn_up.weight`,`${n}ffn_down.weight`]}async function Lr(e,t,r){const n=e.config.layerKinds[t];if(await e.weights.ensureLayer(t),n==="full-attn"||n==="dense-attn"){const{runFullAttnBlock:o}=await Promise.resolve().then(()=>(ai(),yr));await o(e,t,r)}else if(n==="linear-attn"){const{runDeltaNetBlock:o}=await Promise.resolve().then(()=>(ui(),Sr));await o(e,t,r)}else throw new Error(`runBlock: unknown layer kind '${n}' at layer ${t}`)}var qt=A({m29(){"use strict"}}),Ar={};re(Ar,{embedTokens:()=>Tr,projectLogits:()=>Nt});async function Tr(e,t,r,n,o){const i="token_embd.weight";if(!n.has(i))throw new Error(`bonsai-embed: token embedding table '${i}' not loaded; call weights.loadGlobals(['${i}']) first`);const s=n.get(i),a=t.length;if(o%ye!==0)throw new Error(`bonsai-embed: embeddingLength ${o} not a multiple of QK1_0 (${ye})`);const u=n.typeOf(i),d=u===42;if(!d&&u!==41)throw new Error(`bonsai-embed: '${i}' has unsupported quant type ${u} (supported: Q1_0=41, Q2_0=42)`);const l=d?36:20,c=o/ye,m=c*l,p=new Float32Array(a*o),f=H(e.device,m,"embed_staging");for(let g=0;g<a;g++){const h=t[g];if(!Number.isInteger(h)||h<0)throw new Error(`bonsai-embed: token ID ${h} at position ${g} is invalid (must be non-negative integer)`);const b=h*m,S=e.device.createCommandEncoder();S.copyBufferToBuffer(s,b,f,0,m),e.device.queue.submit([S.finish()]);const v=await Se(e.device,f,m),x=new Uint8Array(v);for(let E=0;E<c;E++){const y=E*l,P=d?Lo(So(x,y)):yo(vo(x,y)),F=g*o+E*ye;p.set(P,F)}}e.device.queue.writeBuffer(r,0,p),f.destroy()}async function Nt(e,t,r,n,o,i){const s="output_norm.weight";if(!n.has(s))throw new Error(`bonsai-lmhead: output norm '${s}' not loaded; call weights.loadGlobals(['${s}']) first`);const a=n.get(s),u=o.embeddingLength,d=o.rmsEps,l=qe(e.device,u,"last_row");{const b=e.device.createCommandEncoder();b.copyBufferToBuffer(t,r*u*4,l,0,u*4),e.device.queue.submit([b.finish()])}const c=qe(e.device,u,"normed_hidden");Z(e,l,a,c,1,u,d);{const{BONSAI_DEBUG:b}=await Promise.resolve().then(()=>(qr(),Rt));if(b){const{readbackF32:S}=await Promise.resolve().then(()=>(De(),vt)),v=await S(e,c,u);let x=0,E=1/0,y=-1/0;for(const P of v)P<E&&(E=P),P>y&&(y=P),x+=Math.abs(P);console.log(`[bonsai] normedHidden: min=${E.toFixed(3)} max=${y.toFixed(3)} meanabs=${(x/v.length).toFixed(4)}`),console.log("[bonsai] NH_DUMP "+JSON.stringify(Array.from(v)))}}const m="output.weight",f=!n.has(m)?"token_embd.weight":m;if(!n.has(f))throw new Error(`bonsai-lmhead: LM head weights '${f}' not loaded; call weights.loadGlobals(['${f}']) first`);const g=n.get(f),h=qe(e.device,i,"logits");return pr(e,c,g,h,1,u,i,n.typeOf(f)),l.destroy(),c.destroy(),h}var xr=A({m30(){"use strict";Ee(),De(),wn(),Oe()}}),Rt={};re(Rt,{BONSAI_DEBUG:()=>Br,bonsaiDebugEnabled:()=>Ge,captureRow:()=>Dt,decodeStep:()=>ci,prefill:()=>li});function Ge(){return globalThis.__BONSAI_DEBUG===!0}function Dt(e,t){const r=globalThis,n=r.__BONSAI_CAPTURE_TAG;n&&((r.__BONSAI_ROWS??(r.__BONSAI_ROWS={}))[`${n}:${e}`]=t.slice())}function Pr(){return typeof globalThis.__BONSAI_CAPTURE_TAG=="string"}async function li(e,t,r,n,o,i=0){await Tr(e,r,t,e.weights,e.config.embeddingLength);const s=e.config.embeddingLength,a=(r.length-1)*s,u=async(p,f)=>{if(!Ge()&&!Pr())return;const g=await Re(e,t,r.length*s),h=g.subarray(a,a+s);if(f!==void 0){const E=globalThis.__BONSAI_CAPTURE_POS,y=typeof E=="number"&&E>=0&&E<r.length?E*s:a;Dt(f,g.subarray(y,y+s))}if(!Ge())return;let b=0,S=1/0,v=-1/0,x=0;for(let E=0;E<h.length;E++){const y=h[E];Number.isFinite(y)?(y<S&&(S=y),y>v&&(v=y),x+=Math.abs(y)):b++}console.log(`[bonsai] ${p}: bad=${b} min=${S.toFixed(3)} max=${v.toFixed(3)} meanabs=${(x/h.length).toFixed(4)}`)};await(async(p,f)=>{if(!Ge())return;const g=await Re(e,t,r.length*s);for(const h of f){const b=g.subarray(h*s,(h+1)*s);let S=0,v=1/0,x=-1/0;for(let E=0;E<b.length;E++){const y=b[E];y<v&&(v=y),y>x&&(x=y),S+=Math.abs(y)}console.log(`[bonsai] ${p} pos${h} (id ${r[h]}): min=${v.toFixed(4)} max=${x.toFixed(4)} meanabs=${(S/b.length).toFixed(5)}`)}})("embed-row",[0,1,2,r.length-1]),await u("after embed");const l={hidden:t,nTokens:r.length,posBase:i};for(let p=0;p<e.config.blockCount;p++){for(let g=1;g<=Or;g++)p+g<e.config.blockCount&&e.weights.prefetchLayer(p+g);await e.weights.ensureLayer(p),o?.(p,e.config.blockCount),Sn(e.device);try{await Lr(e,p,l)}finally{lt(e.device),Tn(e.device)}const f=e.config.layerKinds[p];await u(`after L${p} (${f})`,p)}e.kv.advance(r.length);const c=r.length-1;return{logits:await Nt(e,t,c,e.weights,e.config,n.vocabSize)}}async function ci(e,t,r,n){const o={hidden:t,nTokens:1,posBase:r},i=async a=>{if(!Ge()&&!Pr())return;const u=await Re(e,t,e.config.embeddingLength);if(Dt(a,u),!Ge())return;let d=0,l=1/0,c=-1/0,m=0;for(let p=0;p<u.length;p++){const f=u[p];Number.isFinite(f)?(f<l&&(l=f),f>c&&(c=f),m+=Math.abs(f)):d++}console.log(`[bonsai] DECODE_L${a}: bad=${d} min=${l.toFixed(3)} max=${c.toFixed(3)} meanabs=${(m/u.length).toFixed(4)}`)};for(let a=0;a<e.config.blockCount;a++){await e.weights.ensureLayer(a),Sn(e.device);try{await Lr(e,a,o)}finally{lt(e.device),Tn(e.device)}await i(a);const u=globalThis.__BONSAI_INJECT;u&&u.layer===a&&u.row.length===e.config.embeddingLength&&(e.device.queue.writeBuffer(t,0,u.row),console.log(`[bonsai] INJECT applied at L${a} (decode hidden <- prefill row)`))}return e.kv.advance(1),{logits:await Nt(e,t,0,e.weights,e.config,n.vocabSize)}}var Or,Br,qr=A({m31(){"use strict";qt(),xr(),De(),Ee(),Or=3,Br=!1}}),Nr={};re(Nr,{initBonsaiRuntime:()=>di});async function di(e){let t=null,r="",n=!1;const o=d=>e.postMessage(d);async function i(){const{WGSL_SOURCES:d}=await Promise.resolve().then(()=>(jo(),Gn));return d}async function s(){const d=navigator.gpu;if(!d)throw new Error("WebGPU not available on this browser");let l=await d.requestAdapter({powerPreference:"high-performance"});if(l||(l=await d.requestAdapter({forceFallbackAdapter:!0}).catch(()=>null)),!l)throw new Error("No WebGPU adapter found");const c=l.limits??{},m={};for(const h of["maxStorageBufferBindingSize","maxBufferSize","maxComputeWorkgroupStorageSize"]){const b=c[h];typeof b=="number"&&b>0&&(m[h]=b)}const p=await l.requestDevice({requiredLimits:m}),f=Be(),g=qo(Bo(l.info),{windowsTdr:typeof navigator<"u"&&/Windows/i.test(navigator.userAgent??""),mobile:f});return g>0&&Ro(p,g),p}async function a(d){try{const l=await s(),c=await i();t=_o({device:l,kernelSources:c}),r=d,await t.load({modelUrl:Nn(d),onProgress:m=>o({type:"progress",progress:m.percent,file:m.detail})}),o({type:"ready",modelId:d})}catch(l){o({type:"error",message:`bonsai load failed: ${l.message}`})}}async function u(d){if(!t?.loaded)return o({type:"error",message:"no model loaded \u2014 send {type:'load'} first"});n=!1;try{const{tokenizer:l,config:c,device:m,pipelines:p,weights:f}=t.loaded,g=d.maxTokens??256,h=d.temperature??.7,b=d.topK??20,S=d.topP??.95,v=d.repetitionPenalty??1.1,E=d.reasoningBudget??Math.max(32,g-128),y=l.encodeChat(d.messages),P=y.length,F=8192,_=Math.min(F,P+g+1);if(P+g+1>F)return o({type:"error",message:`context too long: prompt ${P} + maxTokens ${g} > ${F} KV slots. Shorten the prompt or lower maxTokens.`});const{F32KvCache:T}=await Promise.resolve().then(()=>(Ho(),or)),{SsmState:D}=await Promise.resolve().then(()=>(Yo(),ar)),{f32Buffer:B,sampleToken:$e}=await Promise.resolve().then(()=>(De(),vt)),{prefill:Ie,decodeStep:fe}=await Promise.resolve().then(()=>(qr(),Rt)),{embedTokens:oe}=await Promise.resolve().then(()=>(xr(),Ar)),N=new T(m,{fullAttnLayers:c.fullAttnLayers,headCountKv:c.headCountKv,headDim:c.keyLength??c.embeddingLength/c.headCount,capacity:F}),R=c.deltaNet,k=new D(m,{linearAttnLayers:c.linearAttnLayers,heads:R?.numVHeads??0,dK:R?.headDim??0,dV:R?.headDim??0,dConv:R?.convKernel,ssmInnerSize:R?.vDim,convDim:R?.convDim});if(!R&&c.linearAttnLayers.length>0)throw new Error(`bonsai: ${c.linearAttnLayers.length} DeltaNet layers classified but model exposes no ssm.* geometry.`);N.reset(),k.reset();const ge=B(m,P*c.embeddingLength,"hidden_prefill"),Y=B(m,c.embeddingLength,"hidden_decode"),be=f.weightQuantType(),X={device:m,pipelines:p,weights:f,config:c,kv:N,kvMode:"f32",ssm:k,quantType:be};o({type:"progress",progress:10,file:`prefill ${P} tokens`});const Le=Date.now(),Ae=await Ie(X,ge,y,l,(O,L)=>{o({type:"progress",progress:10+Math.floor(O/L*30),file:`layer ${O+1}/${L}`})}),Me=Date.now()-Le,Te="\uFFFD",xe=O=>{const L=l.decode(O);let K=L.length;for(;K>0&&L[K-1]===Te;)K--;return L.slice(0,K)},_e=[],we=[];let ie="",ee="";const V=(O,L,K)=>{const q=xe(O);return q.length>L.length&&q.startsWith(L)?(o({type:"token",text:q.slice(L.length),channel:K}),q):q.length>=L.length?q:L};let Q=!1;if(l.thinkEndId!==void 0&&l.thinkStartId!==void 0){const O=y.lastIndexOf(l.thinkStartId),L=y.lastIndexOf(l.thinkEndId);Q=O!==-1&&O>L}let se=!1;const ue=64,te=[];let J=Ae.logits,ne=P,$=0,le="max-tokens";const G=Date.now();for(;$<g&&!n;){const O=await $e({device:m,pipelines:p,quantType:be},J,l.vocabSize,{temperature:h,topK:b,topP:S,repetitionPenalty:v,recentIds:te});if($++,l.isStop(O)){le="stop-token";break}te.push(O),te.length>ue&&te.shift(),O===l.thinkEndId?Q=!1:O===l.thinkStartId?Q=!0:Q?(_e.push(O),ie=V(_e,ie,"thinking")):(we.push(O),ee=V(we,ee,"answer")),await oe(X,[O],Y,f,c.embeddingLength),J=(await fe(X,Y,ne++,l)).logits,Q&&!se&&l.thinkEndId!==void 0&&$>=E&&(se=!0,Q=!1,await oe(X,[l.thinkEndId],Y,f,c.embeddingLength),J=(await fe(X,Y,ne++,l)).logits,o({type:"progress",file:"reasoning budget reached \u2014 answering"}));const L=10+Math.floor($/g*80),K=$/((Date.now()-G)/1e3);o({type:"progress",progress:L,file:`${Q?"thinking":"answering"} \xB7 ${$} tok \xB7 ${K.toFixed(1)} tok/s`})}n&&(le="interrupted");const ce=Date.now()-G,U=$>0?$/ce*1e3:0,j=ee.trim()||(ie.trim()?"I ran out of room to finish that thought \u2014 my reasoning is above. Ask again and I'll be more direct.":"");o({type:"done",text:j,reasoning:ie.trim()||void 0,tokensPerSecond:U})}catch(l){o({type:"error",message:`bonsai generate failed: ${l.message}`})}}return{load:a,generate:u,interrupt:()=>{n=!0}}}var hi=A({m32(){"use strict";Oo(),No(),Ee(),bt(),Dn()}}),pi=[{id:"bonsai-1.7b",label:"Bonsai 1.7B (Phone)",repo:"prism-ml/Bonsai-1.7B-gguf",runtime:"bonsai-kernels",task:"text-generation",approxDownloadMB:236,blurb:"Lightest size \u2014 236 MB, designed for phones and older devices.",ready:!0},{id:"bonsai-4b",label:"Bonsai 4B (Default)",repo:"prism-ml/Bonsai-4B-gguf",runtime:"bonsai-kernels",task:"text-generation",approxDownloadMB:545,blurb:"Balanced: smart and fast \u2014 the recommended in-browser model.",ready:!0},{id:"bonsai-8b",label:"Bonsai 8B (Desktop)",repo:"prism-ml/Bonsai-8B-gguf",runtime:"bonsai-kernels",task:"text-generation",approxDownloadMB:1104,blurb:"Better reasoning, ~1 GB. Desktop GPU with 8+ GB RAM.",ready:!0},{id:"bonsai-27b-text",label:"Bonsai 27B (Reasoning)",repo:"prism-ml/Bonsai-27B-gguf",runtime:"bonsai-kernels",task:"text-generation",approxDownloadMB:3800,blurb:"Full reasoning brain. 3.6 GB, needs a real desktop GPU (e.g., RTX 4090).",ready:!0},{id:"gemma-4-e2b",label:"Gemma 4 (E2B, mobile)",repo:"google/gemma-4-E2B-it-qat-mobile-transformers",runtime:"transformers-js",task:"text-generation",dtype:"q4",approxDownloadMB:900,blurb:"Google's QAT mobile Gemma 4 \u2014 needs its own WebGPU kernels (coming).",ready:!1},{id:"bonsai-image",label:"Bonsai Image",repo:"prism-ml/Bonsai-27B-gguf",runtime:"bonsai-image",task:"text-to-image",approxDownloadMB:3800,blurb:"In-browser image generation via custom WebGPU kernels (Phase 4 \u2014 not yet wired).",ready:!1}];function Rr(e){return pi.find(t=>t.id===e)}function mi(e,t){let r=null;async function n(o){const i=Rr(o);if(!i){e.postMessage({type:"error",message:`unknown model '${o}'`});return}if(i.runtime==="transformers-js"){const s=await fi(e,t);r=s,s({type:"load",modelId:o})}else if(i.runtime==="bonsai-kernels"){const s=await gi(e);r=s,s({type:"load",modelId:o})}else e.postMessage({type:"error",message:`model '${o}' uses the '${i.runtime}' runtime, not wired in this worker yet`})}e.addEventListener("message",o=>{const i=o.data;r?r(i):i.type==="load"&&n(i.modelId).catch(s=>{e.postMessage({type:"error",message:"runtime failed to start: "+(s instanceof Error?s.message:String(s))})})})}async function fi(e,t){let r=null,n=!1;const o=a=>e.postMessage(a);async function i(a){const u=Rr(a);if(!u)return o({type:"error",message:`unknown model '${a}'`});try{const{pipeline:d}=await t.loadTransformers();r=await d(u.task,u.repo,{device:"webgpu",dtype:u.dtype??"q4",progress_callback:l=>{l&&l.status==="progress"&&o({...l,type:"progress"})}}),o({type:"ready",modelId:a})}catch(d){o({type:"error",message:`load failed: ${d.message}`})}}async function s(a){if(!r)return o({type:"error",message:"no model loaded \u2014 send {type:'load'} first"});n=!1;try{const{TextStreamer:u}=await t.loadTransformers(),d=r;let l=0;const c=performance.now(),m=new u(d.tokenizer,{skip_prompt:!0,skip_special_tokens:!0,callback_function:b=>{n||(l+=1,o({type:"token",text:b}))}}),p=await d(a.messages,{max_new_tokens:a.maxTokens??512,do_sample:(a.temperature??0)>0,temperature:a.temperature??1,streamer:m}),f=(performance.now()-c)/1e3,g=p?.[0]?.generated_text,h=Array.isArray(g)&&g.length?String(g[g.length-1]?.content??""):String(g??"");o({type:"done",text:h,tokensPerSecond:f>0?l/f:void 0})}catch(u){o({type:"error",message:`generate failed: ${u.message}`})}}return a=>{a.type==="load"?i(a.modelId):a.type==="generate"?s(a):a.type==="interrupt"&&(n=!0)}}async function gi(e){const{initBonsaiRuntime:t}=await Promise.resolve().then(()=>(hi(),Nr)),r=await t(e);return n=>{n.type==="load"?r.load(n.modelId):n.type==="generate"?r.generate(n):n.type==="interrupt"&&r.interrupt()}}Dn();var bi=3;function _i(e){let t=`You may call functions to help answer the user.

`;t+=`You are provided with function signatures within <tools></tools> XML tags:
`,t+="<tools>";for(const r of e)t+=`
`+JSON.stringify(r);return t+=`
</tools>

`,t+="For each function call, return a json object with function name and ",t+=`arguments within <tool_call></tool_call> XML tags:
`,t+=`<tool_call>
{"name": <function-name>, "arguments": <args-json-object>}
</tool_call>`,t}function wi(e){const t=[];let r=e;const n=[/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g,/<tool_call>\s*(\{[\s\S]*\})\s*$/g];for(const o of n)if(r=r.replace(o,(i,s)=>{const a=vi(s);return a?(t.push({...a,raw:i}),""):i}),t.length)break;return{calls:t,rest:r.trim()}}function vi(e){const t=[e,e.replace(/,\s*([}\]])/g,"$1"),e.replace(/'/g,'"').replace(/,\s*([}\]])/g,"$1")];for(const r of t)try{const n=JSON.parse(r),o=n?.name;if(typeof o=="string"&&o){const i=n.arguments??n.parameters??{};return{name:o,arguments:typeof i=="object"&&i?i:{}}}}catch{}return null}bt();var ki=new URL("./bonsai-worker-entry.js?v=2",import.meta.url).href;function yi(e){const t=e?.entryUrl??ki,r=new Worker(t,{type:"module"}),n=new Set,o=i=>{for(const s of n)s({type:"error",message:i})};return r.addEventListener("message",i=>{const s=i.data;for(const a of n)a(s)}),r.addEventListener("error",i=>{o("on-device worker failed to start: "+(i&&i.message||"module load error"))}),r.addEventListener("messageerror",()=>{o("on-device worker rejected a message (protocol mismatch)")}),{post:i=>r.postMessage(i),on:i=>{n.add(i)},interrupt:()=>r.postMessage({type:"interrupt"}),dispose:()=>r.terminate()}}export{wt as BONSAI_MODELS_INFO,ze as DEFAULT_BONSAI_MODEL_ID,Pn as FIRST_TOKEN_FAIL_MS,On as LOAD_FAIL_MS,bi as MAX_TOOL_ROUNDS,Ko as autoBootAllowed,xn as classifyAdapter,yi as createBonsaiChatWorker,_t as getBonsaiModel,Uo as gpuLaneAllowed,Be as isMobileDevice,wi as parseToolCalls,zo as pickBonsaiContext,_i as renderToolsSystemBlock,Nn as resolveBonsaiUrl,mi as runWebMLWorker,Qo as suggestBonsaiModelId};
