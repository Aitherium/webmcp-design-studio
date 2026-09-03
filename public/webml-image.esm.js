/* webmcp-studio-runtime — generated, minified */
var ke=3;function kn(e){return e===408||e===429||e>=500}var Le=e=>new Promise(r=>setTimeout(r,e)),qe=2e4;function De(e){return async(r,t)=>{const n=((t-r+1)/1048576).toFixed(1);let a="";for(let o=1;o<=ke;o++){const u=new AbortController;let s=!1;const _=()=>setTimeout(()=>{s=!0,u.abort()},qe);let f=_();const c=()=>{clearTimeout(f),f=_()};try{let g;try{g=await fetch(e,{headers:{Range:`bytes=${r}-${t}`},cache:"force-cache",signal:u.signal})}catch(m){if(a=m instanceof Error?m.message:String(m),s&&(a=`stalled (no response for ${qe/1e3}s)`),o<ke){await Le(250*2**(o-1));continue}const i=typeof navigator<"u"&&navigator.onLine===!1;throw new Error(`bonsai-gguf: fetch failed for ${n} MB range ${r}-${t} of ${e} after ${ke} attempts${i?" (browser reports OFFLINE)":""}. `+(s?`The server accepted the connection but never answered (stalled ${qe/1e3}s). `:"")+`If the screen also flickered, the GPU driver reset and took this request with it \u2014 that is a GPU fault, not a network one. Last error: ${a}`)}if(g.status!==206&&g.status!==200){if(a=`HTTP ${g.status}`,kn(g.status)&&o<ke){await Le(250*2**(o-1));continue}throw new Error(`bonsai-gguf: range GET ${r}-${t} (${n} MB) of ${e} returned ${g.status}`)}try{const m=g.body;if(!m)return new Uint8Array(await g.arrayBuffer());const i=m.getReader(),T=[];let P=0;for(;;){const{done:d,value:q}=await i.read();if(d)break;q&&(c(),T.push(q),P+=q.byteLength)}const F=new Uint8Array(P);let l=0;for(const d of T)F.set(d,l),l+=d.byteLength;return F}catch(m){if(s){if(a=`stalled mid-body (no progress for ${qe/1e3}s)`,o<ke){await Le(250*2**(o-1));continue}throw new Error(`bonsai-gguf: range GET ${r}-${t} (${n} MB) of ${e} stalled mid-body (no progress for ${qe/1e3}s) after ${ke} attempts. Last error: ${a}`)}throw new Error(`bonsai-gguf: reading ${n} MB range body failed (device out of memory?): ${m instanceof Error?m.message:String(m)}`)}}finally{clearTimeout(f)}}throw new Error(`bonsai-gguf: range ${r}-${t} exhausted retries: ${a}`)}}var Ke=class{constructor(e){this.filled=0,this.cursor=0,this.url=e.url,this.fetchRange=e.fetchRange??De(e.url),this.contentLength=e.contentLength,this.initialWindow=e.initialWindow??1<<20,this.buf=new Uint8Array(0)}get position(){return this.cursor}async ensure(e){if(e<=this.filled)return;let r=Math.max(e,this.filled+this.initialWindow);this.contentLength!==void 0&&(r=Math.min(r,this.contentLength));const t=await this.fetchRange(this.filled,r-1),n=new Uint8Array(this.filled+t.length);if(n.set(this.buf.subarray(0,this.filled),0),n.set(t,this.filled),this.buf=n,this.filled+=t.length,this.filled<e)throw new Error(`bonsai-gguf: underfilled window (have ${this.filled}, need ${e}) \u2014 server may not support ranges`)}async view(e){return await this.ensure(this.cursor+e),new DataView(this.buf.buffer,this.buf.byteOffset+this.cursor,e)}async u8(){const e=(await this.view(1)).getUint8(0);return this.cursor+=1,e}async u32(){const e=(await this.view(4)).getUint32(0,!0);return this.cursor+=4,e}async i32(){const e=(await this.view(4)).getInt32(0,!0);return this.cursor+=4,e}async f32(){const e=(await this.view(4)).getFloat32(0,!0);return this.cursor+=4,e}async f64(){const e=(await this.view(8)).getFloat64(0,!0);return this.cursor+=8,e}async u16(){const e=(await this.view(2)).getUint16(0,!0);return this.cursor+=2,e}async i16(){const e=(await this.view(2)).getInt16(0,!0);return this.cursor+=2,e}async i8(){const e=(await this.view(1)).getInt8(0);return this.cursor+=1,e}async u64(){const e=await this.view(8),r=e.getUint32(0,!0),t=e.getUint32(4,!0);this.cursor+=8;const n=t*4294967296+r;if(!Number.isSafeInteger(n))throw new Error(`bonsai-gguf: u64 ${n} exceeds MAX_SAFE_INTEGER`);return n}async i64(){return this.u64()}async string(){const e=await this.u64();await this.ensure(this.cursor+e);const r=this.buf.subarray(this.cursor,this.cursor+e);return this.cursor+=e,new TextDecoder("utf-8").decode(r)}seek(e){this.cursor=e}async bytes(e,r){return await this.ensure(e+r),this.buf.slice(e,e+r)}},xn={0:{blockSize:1,typeSize:4,name:"F32"},1:{blockSize:1,typeSize:2,name:"F16"},8:{blockSize:32,typeSize:34,name:"Q8_0"},41:{blockSize:128,typeSize:18,name:"Q1_0"},42:{blockSize:128,typeSize:34,name:"Q2_0"}},we=128,Fe=34;function $e(e){const r=xn[e];if(!r)throw new Error(`bonsai-gguf: unsupported ggml type ${e} (not in TYPE_TRAITS)`);return r}function En(e,r){const{blockSize:t,typeSize:n}=$e(e);if(r%t!==0)throw new Error(`bonsai-gguf: element count ${r} not a multiple of block size ${t} for ${$e(e).name}`);return r/t*n}var qn=1179993927;function Qe(e,r){return e+(r-e%r)%r}async function Ve(e,r){switch(r){case 0:return e.u8();case 1:return e.i8();case 2:return e.u16();case 3:return e.i16();case 4:return e.u32();case 5:return e.i32();case 6:return e.f32();case 7:return await e.u8()!==0;case 8:return e.string();case 10:return e.u64();case 11:return e.i64();case 12:return e.f64();default:throw new Error(`bonsai-gguf: cannot read scalar of value-type ${r}`)}}async function An(e,r){if(r===9){const t=await e.u32(),n=await e.u64();if(t===9)throw new Error("bonsai-gguf: nested arrays are not permitted by the spec");const a=new Array(n);for(let o=0;o<n;o++)a[o]=await Ve(e,t);return a}return Ve(e,r)}async function Xe(e){const r=await e.u32();if(r!==qn)throw new Error(`bonsai-gguf: bad magic 0x${r.toString(16)} (expected 0x46554747)`);const t=await e.u32();if(t!==3)throw new Error(`bonsai-gguf: unsupported GGUF version ${t} (need 3)`);const n=await e.u64(),a=await e.u64(),o={version:t,tensorCount:n,metadataKvCount:a},u=new Map;for(let c=0;c<a;c++){const g=await e.string(),m=await e.u32(),i=await An(e,m);u.set(g,i)}const s=Mn(u,"general.alignment",32),_=[];for(let c=0;c<n;c++){const g=await e.string(),m=await e.u32(),i=new Array(m);for(let d=0;d<m;d++)i[d]=await e.u64();const T=await e.u32(),P=await e.u64(),F=i.reduce((d,q)=>d*q,1);$e(T);const l=En(T,F);_.push({name:g,dims:i,type:T,relOffset:P,nElements:F,nBytes:l})}const f=Qe(e.position,s);return Tn(_,s),{header:o,kv:u,tensors:_,tensorDataBase:f,alignment:s}}function Tn(e,r){if(e.length<2)return;const t=[...e].sort((n,a)=>n.relOffset-a.relOffset);for(let n=0;n<t.length-1;n++){const a=t[n],o=t[n+1].relOffset-a.relOffset,u=Qe(a.nBytes,r);if(o===u)continue;const s=$e(a.type),_=a.nBytes>0?o/a.nBytes:0;throw new Error(`bonsai-gguf: tensor '${a.name}' (type ${a.type} = ${s.name}) occupies ${o} bytes in the file but this build computes ${a.nBytes} (aligned ${u}) from ${s.blockSize} weights/${s.typeSize} bytes per block \u2014 a factor of ${_.toFixed(4)}. The declared type id does not match the file's actual block geometry, so every read of this tensor would be at the wrong stride and would produce plausible-looking WRONG values rather than an error. If this is a '*_g64' ternary file, it uses group 64 under the same type id 42 and is NOT loadable by this runtime \u2014 use the group-128 '*-Q2_0.gguf' build.`)}}function Mn(e,r,t){const n=e.get(r);return typeof n=="number"?n:typeof n=="bigint"?Number(n):t}var Sn={inChannels:128,numLayers:5,numSingleLayers:20,attentionHeadDim:128,numAttentionHeads:24,jointAttentionDim:7680,axesDimsRope:[32,32,32,32],ropeTheta:2e3,mlpRatio:3,eps:1e-6,timestepChannels:256};function Ye(e){return e.numAttentionHeads*e.attentionHeadDim}function $n(e){return Math.trunc(Ye(e)*e.mlpRatio)}function Je(e){return e/(1+Math.exp(-e))}var Nn=1e3;function Pn(e,r){const t=r>>1,n=new Float32Array(r);for(let a=0;a<t;a++){const o=Math.exp(-Math.log(1e4)*a/t),u=e*o;n[a]=Math.cos(u),n[t+a]=Math.sin(u)}return n}function Bn(e,r,t,n){const a=t.length,o=t.reduce((_,f)=>_+f,0),u=new Float32Array(r*o),s=new Float32Array(r*o);for(let _=0;_<r;_++){let f=0;for(let c=0;c<a;c++){const g=t[c],m=e[_*a+c];for(let i=0;i<g/2;i++){const T=m/Math.pow(n,2*i/g),P=Math.cos(T),F=Math.sin(T);u[_*o+f+2*i]=P,u[_*o+f+2*i+1]=P,s[_*o+f+2*i]=F,s[_*o+f+2*i+1]=F}f+=g}}return{cos:u,sin:s}}function Ie(e,r,t){if(e.length!==r*3*t)throw new Error("splitModulation: got "+e.length+", expected "+r*3*t);const n=o=>e.subarray(o*r,(o+1)*r),a=[];for(let o=0;o<t;o++)a.push({shift:n(3*o),scale:n(3*o+1),gate:n(3*o+2)});return a}var Rn={matmul:"matmul_main",layernorm:"layernorm_main",modulate:"modulate_main",add_gated:"add_gated_main",rope:"rope_interleaved_main",attn:"attn_full_main",swiglu:"swiglu_fused_main",rmsheads:"rmsnorm_heads_main",copy:"copy_strided_main"};function Ne(e){return Math.max(16,Math.ceil(e/16)*16)}function ue(e){const r=new ArrayBuffer(Ne(e.length*4)),t=new DataView(r);return e.forEach(([n,a],o)=>a?t.setFloat32(o*4,n,!0):t.setUint32(o*4,n,!0)),r}async function Cn(e,r){const t=e.createShaderModule({code:r}),a=((await t.getCompilationInfo?.())?.messages??[]).filter(f=>f.type==="error");if(a.length)throw new Error("image kernels failed to compile: "+a.map(f=>`${f.lineNum}: ${f.message}`).join(" | "));const o=new Map;for(const[f,c]of Object.entries(Rn))o.set(f,e.createComputePipeline({layout:"auto",compute:{module:t,entryPoint:c}}));const u=[],s=(f,c=0)=>{const g=e.createBuffer({size:Ne(f),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC|c});return u.push(g),g};async function _(f,c,g,m){const i=Ye(c),T=$n(c),P=c.numAttentionHeads,F=c.attentionHeadDim,l=f.nImg,d=f.nTxt,q=d+l,Y=e.createCommandEncoder(),X=Y.beginComputePass(),V=[],I=h=>s(h*4),W=h=>{const p=s(h.byteLength);return e.queue.writeBuffer(p,0,h.buffer,h.byteOffset,h.byteLength),p},w=new Map,S=h=>{let p=w.get(h);return p||(p=W(g(h)),w.set(h,p)),p},x=(h,p,E,v)=>{const A=o.get(h),U=s(E.byteLength,GPUBufferUsage.UNIFORM);e.queue.writeBuffer(U,0,E);const ne=p.map((Re,Ce)=>({binding:Ce,resource:{buffer:Re}}));ne.push({binding:p.length,resource:{buffer:U}}),X.setPipeline(A),X.setBindGroup(0,e.createBindGroup({layout:A.getBindGroupLayout(0),entries:ne}));const ae=Math.min(v,65535),oe=Math.ceil(Math.max(1,v)/65535);X.dispatchWorkgroups(Math.max(1,ae),Math.max(1,oe))},k=(h,p,E)=>{if(!m)return;const v=E*4,A=e.createBuffer({size:Ne(v),usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});V.push({name:h,buf:A,bytes:v,src:p})},y=(h,p,E,v,A)=>{const U=I(E*A);return x("matmul",[h,S(p),U],ue([[E,!1],[v,!1],[A,!1],[0,!1]]),E*A),U},N=(h,p)=>{const E=I(p*i);return x("layernorm",[h,E],ue([[i,!1],[c.eps,!0],[0,!1],[0,!1]]),p),E},C=(h,p,E,v)=>{const A=I(v*i);return x("modulate",[h,p,E,A],ue([[i,!1],[v,!1],[0,!1],[0,!1]]),Math.ceil(v*i/64)),A},L=(h,p,E,v)=>{const A=I(v*i);return x("add_gated",[h,p,E,A],ue([[i,!1],[v,!1],[0,!1],[0,!1]]),Math.ceil(v*i/64)),A},z=(h,p,E)=>{const v=I(E*P*F);return x("rmsheads",[h,S(p),v],ue([[E,!1],[P,!1],[F,!1],[c.eps,!0]]),E*P),v},H=(h,p,E,v)=>{const A=I(v*P*F);return x("rope",[h,p,E,A],ue([[v,!1],[P,!1],[F,!1],[0,!1]]),Math.ceil(v*P*(F/2)/64)),A},re=(h,p,E,v)=>{const A=I(v*P*F);return x("attn",[h,p,E,A],ue([[v,!1],[P,!1],[F,!1],[1/Math.sqrt(F),!0]]),v*P),A},J=(h,p)=>{const E=I(p*T);return x("swiglu",[h,E],ue([[p,!1],[T,!1],[0,!1],[0,!1]]),Math.ceil(p*T/64)),E},j=(h,p,E,v,A,U,ne,ae)=>{x("copy",[h,p],ue([[E,!1],[v,!1],[A,!1],[U,!1],[ne,!1],[ae,!1],[0,!1],[0,!1]]),Math.ceil(E*v/64))},ie=(h,p,E,v,A)=>{const U=I((p+v)*A);return j(h,U,p,A,A,0,A,0),j(E,U,v,A,A,0,A,p*A),U},fe=(h,p,E)=>{const v=I(E);return j(h,v,1,E,E,p,E,0),v},ce=(h,p,E,v,A)=>{const U=I(p*A);return j(h,U,p,A,E,v,A,0),U},Te=(h,p,E,v,A)=>{const U=I(A*(p+v));return j(h,U,A,p,p,0,p+v,0),j(E,U,A,v,v,0,p+v,p),U},le=(h,p,E)=>{const v=g(p),A=h.length,U=new Float32Array(E);for(let ne=0;ne<E;ne++){let ae=0;for(let oe=0;oe<A;oe++)ae+=h[oe]*v[ne*A+oe];U[ne]=ae}return U},be=Pn(f.timestep*Nn,c.timestepChannels),Me=Float32Array.from(le(be,"time_guidance_embed.timestep_embedder.linear_1.weight",i),Je),ye=le(Me,"time_guidance_embed.timestep_embedder.linear_2.weight",i);m&&(m.stage_temb=ye);const de=Float32Array.from(ye,Je),_e=le(de,"double_stream_modulation_img.linear.weight",i*6),b=le(de,"double_stream_modulation_txt.linear.weight",i*6),M=le(de,"single_stream_modulation.linear.weight",i*3);m&&(m.stage_mod_img=_e,m.stage_mod_txt=b,m.stage_mod_single=M);const $=Ie(_e,i,2),R=Ie(b,i,2),K=Ie(M,i,1)[0],B=h=>W(Float32Array.from(h));let G=y(W(f.hiddenStates),"x_embedder.weight",l,c.inChannels,i);k("stage_x_embed",G,l*i);let Q=y(W(f.encoderHiddenStates),"context_embedder.weight",d,c.jointAttentionDim,i);k("stage_context_embed",Q,d*i);const ee=c.axesDimsRope.length,Z=new Float32Array(q*ee);Z.set(f.txtIds.subarray(0,d*ee),0),Z.set(f.imgIds.subarray(0,l*ee),d*ee);const pe=Bn(Z,q,c.axesDimsRope,c.ropeTheta),ge=W(pe.cos),ve=W(pe.sin);for(let h=0;h<c.numLayers;h++){const p=`transformer_blocks.${h}`,E=$[0],v=R[0],A=C(N(G,l),B(E.shift),B(E.scale),l),U=C(N(Q,d),B(v.shift),B(v.scale),d),ne=z(y(A,`${p}.attn.to_q.weight`,l,i,i),`${p}.attn.norm_q.weight`,l),ae=z(y(A,`${p}.attn.to_k.weight`,l,i,i),`${p}.attn.norm_k.weight`,l),oe=y(A,`${p}.attn.to_v.weight`,l,i,i),Re=z(y(U,`${p}.attn.add_q_proj.weight`,d,i,i),`${p}.attn.norm_added_q.weight`,d),Ce=z(y(U,`${p}.attn.add_k_proj.weight`,d,i,i),`${p}.attn.norm_added_k.weight`,d),_n=y(U,`${p}.attn.add_v_proj.weight`,d,i,i),gn=H(ie(Re,d,ne,l,i),ge,ve,q),hn=H(ie(Ce,d,ae,l,i),ge,ve,q),mn=ie(_n,d,oe,l,i),je=re(gn,hn,mn,q);G=L(G,y(fe(je,d*i,l*i),`${p}.attn.to_out.0.weight`,l,i,i),B(E.gate),l),Q=L(Q,y(fe(je,0,d*i),`${p}.attn.to_add_out.weight`,d,i,i),B(v.gate),d);const Ue=$[1],Oe=R[1],wn=C(N(G,l),B(Ue.shift),B(Ue.scale),l),bn=J(y(wn,`${p}.ff.linear_in.weight`,l,i,T*2),l);G=L(G,y(bn,`${p}.ff.linear_out.weight`,l,T,i),B(Ue.gate),l);const yn=C(N(Q,d),B(Oe.shift),B(Oe.scale),d),vn=J(y(yn,`${p}.ff_context.linear_in.weight`,d,i,T*2),d);Q=L(Q,y(vn,`${p}.ff_context.linear_out.weight`,d,T,i),B(Oe.gate),d),k(`stage_double_${h}_0`,Q,d*i),k(`stage_double_${h}_1`,G,l*i)}let he=ie(Q,d,G,l,i);const me=3*i+2*T;for(let h=0;h<c.numSingleLayers;h++){const p=`single_transformer_blocks.${h}`,E=C(N(he,q),B(K.shift),B(K.scale),q),v=y(E,`${p}.attn.to_qkv_mlp_proj.weight`,q,i,me),A=H(z(ce(v,q,me,0,i),`${p}.attn.norm_q.weight`,q),ge,ve,q),U=H(z(ce(v,q,me,i,i),`${p}.attn.norm_k.weight`,q),ge,ve,q),ne=ce(v,q,me,2*i,i),ae=ce(v,q,me,3*i,T*2),oe=Te(re(A,U,ne,q),i,J(ae,q),T,q);he=L(he,y(oe,`${p}.attn.to_out.weight`,q,i+T,i),B(K.gate),q),k(`stage_single_${h}`,he,q*i)}const Se=le(de,"norm_out.linear.weight",i*2),ln=Se.subarray(0,i),dn=Se.subarray(i,i*2),pn=C(N(fe(he,d*i,l*i),l),B(dn),B(ln),l),He=y(pn,"proj_out.weight",l,i,c.inChannels);k("stage_proj_out",He,l*c.inChannels),X.end();for(const h of V)Y.copyBufferToBuffer(h.src,0,h.buf,0,h.bytes);const Be=l*c.inChannels*4,Ee=e.createBuffer({size:Ne(Be),usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});Y.copyBufferToBuffer(He,0,Ee,0,Be),e.queue.submit([Y.finish()]);for(const h of V)await h.buf.mapAsync(GPUMapMode.READ),m[h.name]=new Float32Array(h.buf.getMappedRange().slice(0,h.bytes)),h.buf.unmap(),h.buf.destroy();await Ee.mapAsync(GPUMapMode.READ);const fn=new Float32Array(Ee.getMappedRange().slice(0,Be));return Ee.unmap(),Ee.destroy(),fn}return{device:e,forward:_,destroy:()=>{for(const f of u)f.destroy();u.length=0}}}var Un=new Float32Array(1),Tt=new Uint32Array(Un.buffer);function Ze(e){const r=(e&32768)>>15,t=(e&31744)>>10,n=e&1023;return t===0?(r?-1:1)*Math.pow(2,-14)*(n/1024):t===31?n?NaN:r?-1/0:1/0:(r?-1:1)*Math.pow(2,t-15)*(1+n/1024)}function On(e,r=0){if(e.length-r<Fe)throw new Error("readQ2Block: need 34 bytes");const t=e[r]|e[r+1]<<8,n=e.subarray(r+2,r+2+32);return{d:Ze(t),qs:new Uint8Array(n)}}function Ln(e,r){const t=r>>2,n=(r&3)<<1;return e[t]>>n&3}function Dn(e){const r=new Float32Array(we);for(let t=0;t<we;t++){const n=Ln(e.qs,t);r[t]=(n-1)*e.d}return r}function Fn(e,r=0){return Dn(On(e,r))}function en(e){return e.dims.reduce((r,t)=>r*t,1)}function In(e){const r=en(e);switch(e.type){case 0:return r*4;case 1:return r*2;case 42:{if(r%we!==0)throw new Error(`gguf-weights: ${e.name} has ${r} elements, not a multiple of ${we}; a partial Q2_0 block would be completed from the next tensor's bytes`);return r/we*Fe}default:throw new Error(`gguf-weights: ${e.name} has unsupported type ${e.type}`)}}function Gn(e,r){const t=en(r);switch(r.type){case 0:return new Float32Array(e.buffer.slice(e.byteOffset,e.byteOffset+t*4));case 1:{const n=new Float32Array(t),a=new DataView(e.buffer,e.byteOffset,t*2);for(let o=0;o<t;o++)n[o]=Ze(a.getUint16(o*2,!0));return n}case 42:{const n=new Float32Array(t),a=t/we;for(let o=0;o<a;o++){const u=Fn(e,o*Fe);n.set(u,o*we)}return n}default:throw new Error(`gguf-weights: ${r.name} has unsupported type ${r.type}`)}}function zn(e){const r=e.cache?new Map:null;return t=>{const n=r?.get(t);if(n)return n;const a=e.tensors.get(t);if(!a)throw new Error(`gguf-weights: the checkpoint has no tensor '${t}'. Returning zeros here would make a misspelled weight produce a plausible, wrong image.`);const o=In(a),u=e.read(e.tensorDataBase+a.relOffset,o);if(u.length!==o)throw new Error(`gguf-weights: read ${u.length} bytes for '${t}', expected ${o} \u2014 a short read yields a tensor padded with zeros rather than an error`);const s=Gn(u,a);return r?.set(t,s),s}}var Wn={baseSeqLen:256,maxSeqLen:4096,baseShift:.5,maxShift:1.15};function Hn(e,r=Wn){const{baseSeqLen:t,maxSeqLen:n,baseShift:a,maxShift:o}=r,u=n-t;return u===0?a:(o-a)/u*(e-t)+a}function jn(e,r){if(e<=0)return 0;const t=Math.exp(r);return t/(t+(1/e-1))}function Kn(e,r){if(e<=0)return[];const t=[];for(let n=0;n<e;n++)t.push(jn(1-n/e,r));return t}function Qn(e,r,t,n){if(e.length!==r.length)throw new Error(`eulerStep: latent (${e.length}) and model output (${r.length}) differ in length; a silent broadcast here would corrupt the sample`);const a=n-t,o=new Float32Array(e.length);for(let u=0;u<e.length;u++)o[u]=e[u]+a*r[u];return o}var Pe={blockOutChannels:[128,256,512,512],layersPerBlock:2,latentChannels:32,normNumGroups:32,latentSize:32,outChannels:3};function Vn(e=Pe){const r=[],t=[...e.blockOutChannels].reverse();let n=t[0],a=e.latentSize;const o=(u,s,_,f,c)=>{r.push({kind:"conv",name:u,out:[_,a,a],conv:{inC:s,outC:_,k:f,pad:c,stride:1}})};o("conv_in",e.latentChannels,n,3,1);for(const u of["mid.resnet.0","mid.attn","mid.resnet.1"])r.push({kind:"groupnorm",name:`${u}.norm`,out:[n,a,a],groups:e.normNumGroups}),r.push({kind:"silu",name:`${u}.act`,out:[n,a,a]}),o(`${u}.conv`,n,n,3,1);for(let u=0;u<t.length;u++){const s=t[u];for(let _=0;_<e.layersPerBlock;_++)r.push({kind:"groupnorm",name:`up.${u}.resnet.${_}.norm`,out:[n,a,a],groups:e.normNumGroups}),r.push({kind:"silu",name:`up.${u}.resnet.${_}.act`,out:[n,a,a]}),o(`up.${u}.resnet.${_}.conv`,n,s,3,1),n=s;u<t.length-1&&(a*=2,r.push({kind:"upsample",name:`up.${u}.upsample`,out:[n,a,a],scale:2}),o(`up.${u}.upsample.conv`,n,n,3,1))}return r.push({kind:"groupnorm",name:"conv_norm_out",out:[n,a,a],groups:e.normNumGroups}),r.push({kind:"silu",name:"conv_act_out",out:[n,a,a]}),o("conv_out",n,e.outChannels,3,1),r}function Xn(e,r,t=Pe){const n=Vn(t),a=t.latentChannels*t.latentSize*t.latentSize;if(e.length!==a)throw new Error(`vae decode: latent has ${e.length} elements, expected ${a} (${t.latentChannels}x${t.latentSize}x${t.latentSize})`);let o=e,u=[t.latentChannels,t.latentSize,t.latentSize];for(const s of n){switch(s.kind){case"conv":o=r.conv(o,s,u);break;case"groupnorm":o=r.groupnorm(o,s,u);break;case"silu":o=r.silu(o);break;case"upsample":o=r.upsample(o,s,u);break;default:throw new Error(`vae decode: unhandled op ${s.kind} at ${s.name}`)}const _=s.out[0]*s.out[1]*s.out[2];if(o.length!==_)throw new Error(`vae decode: after ${s.name} the tensor has ${o.length} elements but the plan declares ${s.out.join("x")} = ${_}. A size drift here yields a wrong image rather than an error, so it is checked every op.`);u=s.out}return o}function Yn(e){return Math.floor((e.h+2*e.pad-e.k)/e.stride)+1}function Jn(e){return Math.floor((e.w+2*e.pad-e.k)/e.stride)+1}function Zn(e,r,t,n){const a=Yn(n),o=Jn(n),u=new Float32Array(n.outC*a*o);for(let s=0;s<n.outC;s++)for(let _=0;_<a;_++)for(let f=0;f<o;f++){let c=t[s];for(let g=0;g<n.inC;g++)for(let m=0;m<n.k;m++){const i=_*n.stride+m-n.pad;if(!(i<0||i>=n.h))for(let T=0;T<n.k;T++){const P=f*n.stride+T-n.pad;P<0||P>=n.w||(c+=e[g*n.h*n.w+i*n.w+P]*r[(s*n.inC+g)*n.k*n.k+m*n.k+T])}}u[s*a*o+_*o+f]=c}return u}function et(e,r,t,n,a,o,u,s=1e-6){const _=new Float32Array(e.length),f=n/u,c=a*o,g=f*c;for(let m=0;m<u;m++){const i=m*g;let T=0;for(let l=0;l<g;l++)T+=e[i+l];T/=g;let P=0;for(let l=0;l<g;l++){const d=e[i+l]-T;P+=d*d}P/=g;const F=1/Math.sqrt(P+s);for(let l=0;l<g;l++){const d=m*f+Math.floor(l/c);_[i+l]=(e[i+l]-T)*F*r[d]+t[d]}}return _}function nt(e,r,t,n,a){const o=t*a,u=n*a,s=new Float32Array(r*o*u);for(let _=0;_<r;_++)for(let f=0;f<o;f++)for(let c=0;c<u;c++){const g=Math.floor(f/a),m=Math.floor(c/a);s[_*o*u+f*u+c]=e[_*t*n+g*n+m]}return s}function tt(e){const r=new Float32Array(e.length);for(let t=0;t<e.length;t++)r[t]=e[t]/(1+Math.exp(-e[t]));return r}var nn=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
//
// The four ops the Flux2 MMDiT needs that the LLM kernels do not provide. Every one of
// them has a CPU counterpart in \`image/mmdit.ts\`, which is differentially verified
// against a real reference forward (37 stages, 5e-5), and every one is compared against
// that counterpart on a real GPU by \`e2e/bonsai-image-gpu-differential.mjs\`.
//
// \u{1F6A8} WHY THESE ARE NEW RATHER THAN REUSED. Three of the four look like kernels that
// already ship, and reusing those would be silently wrong:
//
//   layernorm        NOT rmsnorm.wgsl. RMSNorm does not subtract the mean. Flux2's
//                    modulated norms are LayerNorm with elementwise_affine=FALSE --
//                    mean-centred, and with no learnable weight, because the shift and
//                    scale arrive from the modulation instead. Substituting RMSNorm
//                    changes every activation and raises nothing.
//
//   rope_interleaved NOT rope_imrope.wgsl. That kernel pairs (p, p + rot/2) -- NEOX /
//                    half-split -- and its own comment records that as a FIX ("the old
//                    (2p, 2p+1) pairing scrambled positional phase"), which is true for
//                    the LLM and exactly backwards here. Flux2 pairs ADJACENT
//                    components (2p, 2p+1), from diffusers' use_real_unbind_dim=-1.
//                    Asserted in both directions by
//                    \`e2e/bonsai-image-kernel-conventions.mjs\`.
//
//   modulate         x * (1 + scale) + shift, with scale/shift broadcast over tokens.
//                    Not elementwise.wgsl: the operands have different ranks.
//
//   add_gated        x + gate * delta, gate broadcast over tokens. The residual add of
//                    every block; separate from \`modulate\` because fusing them would
//                    force a caller that needs only one to supply dummies for the other.
//
// LAYOUT, shared by all four: activations are [token][channel] row-major, and for the
// RoPE kernel [token][head][dim] -- the reference unflattens the projection to
// (heads, headDim) on the LAST axis, so head h of token t is contiguous. Reading it as
// [head][token][dim] transposes silently and is shape-compatible.

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 LayerNorm \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// One workgroup per TOKEN, cooperating over that token's channels. Not one thread per
// token: dim is 3072 in this model, and a single lane walking it is the one-lane mistake
// that made attention 8x slower than it had to be.
//
// Two passes (mean, then variance) rather than the sum/sum-of-squares trick: at f32 the
// one-pass form loses precision exactly where the variance is small, and a modulated
// norm's input is centred by construction.

struct LnP {
  dim : u32,
  eps : f32,
  _p0 : u32, _p1 : u32,
};

@group(0) @binding(0) var<storage, read>       ln_x : array<f32>;
@group(0) @binding(1) var<storage, read_write> ln_y : array<f32>;
@group(0) @binding(2) var<uniform>             lnp  : LnP;

var<workgroup> ln_red : array<f32, 256>;

@compute @workgroup_size(256)
fn layernorm_main(@builtin(workgroup_id) wg : vec3<u32>,
                  @builtin(local_invocation_id) lid : vec3<u32>) {
  let t = wg.x;
  let base = t * lnp.dim;
  let tid = lid.x;

  var s : f32 = 0.0;
  var i : u32 = tid;
  loop {
    if (i >= lnp.dim) { break; }
    s = s + ln_x[base + i];
    i = i + 256u;
  }
  ln_red[tid] = s;
  workgroupBarrier();
  var stride : u32 = 128u;
  loop {
    if (stride == 0u) { break; }
    if (tid < stride) { ln_red[tid] = ln_red[tid] + ln_red[tid + stride]; }
    workgroupBarrier();
    stride = stride >> 1u;
  }
  let mean = ln_red[0] / f32(lnp.dim);
  workgroupBarrier();

  var v : f32 = 0.0;
  i = tid;
  loop {
    if (i >= lnp.dim) { break; }
    let d = ln_x[base + i] - mean;
    v = v + d * d;
    i = i + 256u;
  }
  ln_red[tid] = v;
  workgroupBarrier();
  stride = 128u;
  loop {
    if (stride == 0u) { break; }
    if (tid < stride) { ln_red[tid] = ln_red[tid] + ln_red[tid + stride]; }
    workgroupBarrier();
    stride = stride >> 1u;
  }
  let inv = inverseSqrt(ln_red[0] / f32(lnp.dim) + lnp.eps);
  workgroupBarrier();

  // NO learnable affine here on purpose: elementwise_affine=false. The shift and scale
  // come from \`modulate\`, and applying one here would double-apply the conditioning.
  i = tid;
  loop {
    if (i >= lnp.dim) { break; }
    ln_y[base + i] = (ln_x[base + i] - mean) * inv;
    i = i + 256u;
  }
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 modulate \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// y[t, c] = x[t, c] * (1 + scale[c]) + shift[c]

struct ModP {
  dim    : u32,
  tokens : u32,
  _p0 : u32, _p1 : u32,
};

@group(0) @binding(0) var<storage, read>       md_x     : array<f32>;
@group(0) @binding(1) var<storage, read>       md_shift : array<f32>;
@group(0) @binding(2) var<storage, read>       md_scale : array<f32>;
@group(0) @binding(3) var<storage, read_write> md_y     : array<f32>;
@group(0) @binding(4) var<uniform>             mdp      : ModP;

@compute @workgroup_size(64)
fn modulate_main(@builtin(global_invocation_id) gid : vec3<u32>,
                 @builtin(num_workgroups) nwg : vec3<u32>) {
  let total = mdp.tokens * mdp.dim;
  let idx = gid.x + gid.y * nwg.x * 64u;
  if (idx >= total) { return; }
  let c = idx % mdp.dim;
  md_y[idx] = md_x[idx] * (1.0 + md_scale[c]) + md_shift[c];
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 add_gated \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// y[t, c] = x[t, c] + gate[c] * delta[t, c]

@group(0) @binding(0) var<storage, read>       ag_x     : array<f32>;
@group(0) @binding(1) var<storage, read>       ag_delta : array<f32>;
@group(0) @binding(2) var<storage, read>       ag_gate  : array<f32>;
@group(0) @binding(3) var<storage, read_write> ag_y     : array<f32>;
@group(0) @binding(4) var<uniform>             agp      : ModP;

@compute @workgroup_size(64)
fn add_gated_main(@builtin(global_invocation_id) gid : vec3<u32>,
                  @builtin(num_workgroups) nwg : vec3<u32>) {
  let total = agp.tokens * agp.dim;
  let idx = gid.x + gid.y * nwg.x * 64u;
  if (idx >= total) { return; }
  let c = idx % agp.dim;
  ag_y[idx] = ag_x[idx] + ag_gate[c] * ag_delta[idx];
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 RoPE, INTERLEAVED pairs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// out[2p]   = x[2p]   * cos[2p]   - x[2p+1] * sin[2p]
// out[2p+1] = x[2p+1] * cos[2p+1] + x[2p]   * sin[2p+1]
//
// cos/sin are per-TOKEN tables of head_dim entries, shared by every head, with each
// frequency REPEAT-INTERLEAVED (slots 2p and 2p+1 carry the same value) to match
// \`repeat_interleave_real=True\`. Reading cos at 2p and 2p+1 separately rather than once
// is deliberate: it keeps this kernel correct if a caller ever supplies a non-repeated
// table, and costs nothing (the value is in cache either way).
//
// \u{1F6A8} This is NOT rope_imrope.wgsl's pairing. See the header.

struct RopeP {
  tokens   : u32,
  heads    : u32,
  head_dim : u32,
  _p0 : u32,
};

@group(0) @binding(0) var<storage, read>       rp_x   : array<f32>;
@group(0) @binding(1) var<storage, read>       rp_cos : array<f32>;
@group(0) @binding(2) var<storage, read>       rp_sin : array<f32>;
@group(0) @binding(3) var<storage, read_write> rp_y   : array<f32>;
@group(0) @binding(4) var<uniform>             rpp    : RopeP;

@compute @workgroup_size(64)
fn rope_interleaved_main(@builtin(global_invocation_id) gid : vec3<u32>,
                         @builtin(num_workgroups) nwg : vec3<u32>) {
  // one thread per (token, head, PAIR)
  let pairs = rpp.head_dim / 2u;
  let total = rpp.tokens * rpp.heads * pairs;
  let idx = gid.x + gid.y * nwg.x * 64u;
  if (idx >= total) { return; }

  let pair = idx % pairs;
  let rem  = idx / pairs;
  let head = rem % rpp.heads;
  let tok  = rem / rpp.heads;

  let o = (tok * rpp.heads + head) * rpp.head_dim + pair * 2u;
  let p = tok * rpp.head_dim + pair * 2u;

  let a = rp_x[o];
  let b = rp_x[o + 1u];
  rp_y[o]      = a * rp_cos[p]      - b * rp_sin[p];
  rp_y[o + 1u] = b * rp_cos[p + 1u] + a * rp_sin[p + 1u];
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 full (non-causal) multi-head attention \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// \u{1F6A8} NEITHER softmax_attn.wgsl NOR softmax_attn_batched.wgsl CAN SERVE THIS MODEL, and
// the reason is not performance -- both are CAUSAL. An image transformer attends
// bidirectionally: token 3 must see token 700. Running a causal kernel here masks most
// of every row, renormalises what is left, and returns a perfectly well-formed tensor.
// The image would simply be wrong.
//
// Two more differences make the reuse impossible rather than merely incorrect: both LLM
// kernels read K/V from a 4-bit QUANTIZED KV CACHE (this model has no cache -- every
// token is present at once, in f32), and both implement GQA (this model has 24 query
// heads and 24 KV heads, so the mapping is the identity).
//
// FLASH-STYLE ONLINE SOFTMAX, one workgroup per (token, head). The running max/sum let
// it stream the key axis in tiles with no O(n^2) score buffer, which matters at 768
// tokens. Lanes split the key axis when computing scores, and split the HEAD DIM when
// accumulating the output -- so the per-lane accumulator is a couple of registers rather
// than a head_dim-wide array in workgroup memory, which at 64 lanes x 128 dims would be
// 32 KB and exceed the guaranteed limit.
//
// Layout is [token][head][dim], matching \`image/mmdit.ts attention\` -- the reference
// unflattens the projection to (heads, headDim) on the LAST axis. Reading it as
// [head][token][dim] transposes silently and is shape-compatible.

const ATT_WG : u32 = 64u;

struct AttnFullP {
  tokens   : u32,
  heads    : u32,
  head_dim : u32,
  scale    : f32,      // 1/sqrt(head_dim)
};

@group(0) @binding(0) var<storage, read>       af_q : array<f32>;
@group(0) @binding(1) var<storage, read>       af_k : array<f32>;
@group(0) @binding(2) var<storage, read>       af_v : array<f32>;
@group(0) @binding(3) var<storage, read_write> af_y : array<f32>;
@group(0) @binding(4) var<uniform>             afp  : AttnFullP;

var<workgroup> af_score : array<f32, 64>;   // one score per lane per tile
var<workgroup> af_red   : array<f32, 64>;
var<workgroup> af_m     : f32;              // running max
var<workgroup> af_l     : f32;              // running sum of exp

@compute @workgroup_size(64)
fn attn_full_main(@builtin(workgroup_id) wg : vec3<u32>,
                  @builtin(local_invocation_id) lid : vec3<u32>,
                  @builtin(num_workgroups) nwg : vec3<u32>) {
  let pair = wg.x + wg.y * nwg.x;             // (token, head), flattened
  let total = afp.tokens * afp.heads;
  if (pair >= total) { return; }
  let head = pair % afp.heads;
  let tok  = pair / afp.heads;
  let hd   = afp.head_dim;
  let lane = lid.x;

  let qo = (tok * afp.heads + head) * hd;

  if (lane == 0u) { af_m = -3.0e38; af_l = 0.0; }
  workgroupBarrier();

  // The output accumulator lives in registers: this lane owns dims lane, lane+64, ...
  // ACC_MAX bounds head_dim at 64*8 = 512; this model uses 128.
  const ACC_MAX : u32 = 8u;
  var acc : array<f32, 8>;
  for (var a : u32 = 0u; a < ACC_MAX; a = a + 1u) { acc[a] = 0.0; }

  var tile : u32 = 0u;
  loop {
    if (tile >= afp.tokens) { break; }

    // ---- scores for this tile: lane j handles key tile+lane ----
    let j = tile + lane;
    var s : f32 = -3.0e38;
    if (j < afp.tokens) {
      let ko = (j * afp.heads + head) * hd;
      var d : f32 = 0.0;
      for (var i : u32 = 0u; i < hd; i = i + 1u) { d = d + af_q[qo + i] * af_k[ko + i]; }
      s = d * afp.scale;
    }
    af_score[lane] = s;
    af_red[lane] = s;
    workgroupBarrier();

    // ---- tile max ----
    var stride : u32 = ATT_WG >> 1u;
    loop {
      if (stride == 0u) { break; }
      if (lane < stride) { af_red[lane] = max(af_red[lane], af_red[lane + stride]); }
      workgroupBarrier();
      stride = stride >> 1u;
    }
    let tile_max = af_red[0];
    workgroupBarrier();

    // ---- rescale the running state to the new max ----
    let m_old = af_m;
    let m_new = max(m_old, tile_max);
    // exp(-inf - -inf) is NaN, so guard the very first tile where both are -3e38.
    let rescale = select(exp(m_old - m_new), 0.0, m_old <= -3.0e38);
    if (lane == 0u) { af_m = m_new; }
    workgroupBarrier();

    // ---- tile sum of exp ----
    var e : f32 = 0.0;
    if (j < afp.tokens) { e = exp(af_score[lane] - m_new); }
    af_red[lane] = e;
    af_score[lane] = e;     // reuse as the weight for the accumulation below
    workgroupBarrier();
    stride = ATT_WG >> 1u;
    loop {
      if (stride == 0u) { break; }
      if (lane < stride) { af_red[lane] = af_red[lane] + af_red[lane + stride]; }
      workgroupBarrier();
      stride = stride >> 1u;
    }
    if (lane == 0u) { af_l = af_l * rescale + af_red[0]; }
    workgroupBarrier();

    // ---- accumulate weighted V over this tile, this lane's dims ----
    var a : u32 = 0u;
    loop {
      let d = lane + a * ATT_WG;
      if (d >= hd || a >= ACC_MAX) { break; }
      var sum : f32 = 0.0;
      for (var t : u32 = 0u; t < ATT_WG; t = t + 1u) {
        let kj = tile + t;
        if (kj < afp.tokens) {
          let vo = (kj * afp.heads + head) * hd;
          sum = sum + af_score[t] * af_v[vo + d];
        }
      }
      acc[a] = acc[a] * rescale + sum;
      a = a + 1u;
    }
    workgroupBarrier();

    tile = tile + ATT_WG;
  }

  let inv_l = 1.0 / af_l;
  var a2 : u32 = 0u;
  loop {
    let d = lane + a2 * ATT_WG;
    if (d >= hd || a2 >= ACC_MAX) { break; }
    af_y[qo + d] = acc[a2] * inv_l;
    a2 = a2 + 1u;
  }
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 f32 matmul (x @ W^T) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// y[t, o] = sum_i x[t, i] * W[o, i]   -- torch [out, in] layout, NO bias.
//
// This model has no biases anywhere, and W is stored [out, in] row-major, which makes
// the reduction contiguous in \`i\` for a fixed output. One workgroup per (token, output),
// 64 lanes splitting the K axis.
//
// f32 on purpose for the FIRST correct dispatch. The shipped weights are Q2_0 and
// q2_0_q8_0_matmul.wgsl already exists for them, but swapping it in changes the numerics
// (2-bit weights, quantized activations) so it cannot be differentially compared against
// the f32 CPU reference that proves this whole path. Correctness first, in the order this
// codebase already learned: "the transformer kernels earned their optimisations only
// after a CPU differential proved them right."

struct MmP {
  tokens : u32,
  in_dim : u32,
  out_dim : u32,
  _p0 : u32,
};

@group(0) @binding(0) var<storage, read>       mm_x : array<f32>;
@group(0) @binding(1) var<storage, read>       mm_w : array<f32>;
@group(0) @binding(2) var<storage, read_write> mm_y : array<f32>;
@group(0) @binding(3) var<uniform>             mmp  : MmP;

var<workgroup> mm_red : array<f32, 64>;

@compute @workgroup_size(64)
fn matmul_main(@builtin(workgroup_id) wg : vec3<u32>,
               @builtin(local_invocation_id) lid : vec3<u32>,
               @builtin(num_workgroups) nwg : vec3<u32>) {
  let pair = wg.x + wg.y * nwg.x;
  let total = mmp.tokens * mmp.out_dim;
  if (pair >= total) { return; }
  let o = pair % mmp.out_dim;
  let t = pair / mmp.out_dim;
  let lane = lid.x;

  var s : f32 = 0.0;
  var i : u32 = lane;
  loop {
    if (i >= mmp.in_dim) { break; }
    s = s + mm_x[t * mmp.in_dim + i] * mm_w[o * mmp.in_dim + i];
    i = i + 64u;
  }
  mm_red[lane] = s;
  workgroupBarrier();
  var stride : u32 = 32u;
  loop {
    if (stride == 0u) { break; }
    if (lane < stride) { mm_red[lane] = mm_red[lane] + mm_red[lane + stride]; }
    workgroupBarrier();
    stride = stride >> 1u;
  }
  if (lane == 0u) { mm_y[pair] = mm_red[0]; }
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 SwiGLU, fused \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// y[t, i] = silu(x[t, i]) * x[t, inner + i]   over a FUSED [tokens, 2*inner] input.
//
// swiglu.wgsl takes gate and up as two SEPARATE buffers. Flux2's \`linear_in\` emits both
// halves in ONE tensor, and a WebGPU bind group cannot alias two overlapping views of the
// same buffer as two read bindings -- so the split has to happen inside the kernel.
// Gate is the FIRST half; swapping the halves is dimensionally identical and wrong.

struct SgP {
  tokens : u32,
  inner  : u32,
  _p0 : u32, _p1 : u32,
};

@group(0) @binding(0) var<storage, read>       sg_x : array<f32>;
@group(0) @binding(1) var<storage, read_write> sg_y : array<f32>;
@group(0) @binding(2) var<uniform>             sgp  : SgP;

@compute @workgroup_size(64)
fn swiglu_fused_main(@builtin(global_invocation_id) gid : vec3<u32>,
                     @builtin(num_workgroups) nwg : vec3<u32>) {
  let total = sgp.tokens * sgp.inner;
  let idx = gid.x + gid.y * nwg.x * 64u;
  if (idx >= total) { return; }
  let t = idx / sgp.inner;
  let i = idx % sgp.inner;
  let base = t * sgp.inner * 2u;
  let g = sg_x[base + i];
  sg_y[idx] = (g / (1.0 + exp(-g))) * sg_x[base + sgp.inner + i];
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 per-head RMSNorm (QK-norm) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// y[t, h, i] = x[t, h, i] / sqrt(mean_i(x^2) + eps) * weight[i]
//
// NOT rmsnorm.wgsl, which normalises a whole row against a row-wide weight. This
// normalises EACH HEAD independently over head_dim, with a [head_dim] weight shared by
// every head \u2014 that is what \`attn.norm_q\` / \`attn.norm_k\` are in Flux2, and applying the
// row-wide kernel would mix all 24 heads into one statistic.
//
// Applied BEFORE RoPE (convention 4). One workgroup per (token, head).

struct RmsHP {
  tokens   : u32,
  heads    : u32,
  head_dim : u32,
  eps      : f32,
};

@group(0) @binding(0) var<storage, read>       rh_x : array<f32>;
@group(0) @binding(1) var<storage, read>       rh_w : array<f32>;
@group(0) @binding(2) var<storage, read_write> rh_y : array<f32>;
@group(0) @binding(3) var<uniform>             rhp  : RmsHP;

var<workgroup> rh_red : array<f32, 64>;

@compute @workgroup_size(64)
fn rmsnorm_heads_main(@builtin(workgroup_id) wg : vec3<u32>,
                      @builtin(local_invocation_id) lid : vec3<u32>,
                      @builtin(num_workgroups) nwg : vec3<u32>) {
  let pair = wg.x + wg.y * nwg.x;
  if (pair >= rhp.tokens * rhp.heads) { return; }
  let hd = rhp.head_dim;
  let base = pair * hd;          // [token][head][dim] is contiguous per (token, head)
  let lane = lid.x;

  var s : f32 = 0.0;
  var i : u32 = lane;
  loop {
    if (i >= hd) { break; }
    let v = rh_x[base + i];
    s = s + v * v;
    i = i + 64u;
  }
  rh_red[lane] = s;
  workgroupBarrier();
  var stride : u32 = 32u;
  loop {
    if (stride == 0u) { break; }
    if (lane < stride) { rh_red[lane] = rh_red[lane] + rh_red[lane + stride]; }
    workgroupBarrier();
    stride = stride >> 1u;
  }
  let inv = inverseSqrt(rh_red[0] / f32(hd) + rhp.eps);
  workgroupBarrier();

  i = lane;
  loop {
    if (i >= hd) { break; }
    rh_y[base + i] = rh_x[base + i] * inv * rh_w[i];
    i = i + 64u;
  }
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 strided copy (gather/scatter) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// dst[t*dst_stride + dst_off + j] = src[t*src_stride + src_off + j],  j < width
//
// \u{1F6A8} THIS EXISTS BECAUSE copyBufferToBuffer CANNOT BE RECORDED INSIDE AN OPEN COMPUTE
// PASS. The first runtime queued its slices, concatenations and de-interleaves as
// buffer copies and replayed them after \`pass.end()\` -- so every dispatch that CONSUMED
// one of those buffers read it before it had been written. The kernels were all
// individually correct on hardware and the assembled model was still wrong, diverging
// at the first double block.
//
// Splitting the compute pass at each copy would also be correct, but the single-stream
// blocks de-interleave a fused projection per token: at 768 tokens that is ~15,000 pass
// boundaries per forward. As a kernel it is one dispatch and the whole graph stays in
// one pass.
//
// One thread per (t, j). Every reshape in the MMDiT graph -- token concat, token slice,
// column range, column join -- is this op with different strides.

struct CopyP {
  tokens     : u32,
  width      : u32,
  src_stride : u32,
  src_off    : u32,
  dst_stride : u32,
  dst_off    : u32,
  _p0 : u32, _p1 : u32,
};

@group(0) @binding(0) var<storage, read>       cp_src : array<f32>;
@group(0) @binding(1) var<storage, read_write> cp_dst : array<f32>;
@group(0) @binding(2) var<uniform>             cpp    : CopyP;

@compute @workgroup_size(64)
fn copy_strided_main(@builtin(global_invocation_id) gid : vec3<u32>,
                     @builtin(num_workgroups) nwg : vec3<u32>) {
  let total = cpp.tokens * cpp.width;
  let idx = gid.x + gid.y * nwg.x * 64u;
  if (idx >= total) { return; }
  let t = idx / cpp.width;
  let j = idx % cpp.width;
  cp_dst[t * cpp.dst_stride + cpp.dst_off + j] =
    cp_src[t * cpp.src_stride + cpp.src_off + j];
}
`,rt=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
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
`,at=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
//
// qwen3-4b TEXT-ENCODER forward kernels (the FLUX.2 Klein conditioning path),
// assembled as ONE WGSL module so the CDN image bundle can create every pipeline
// from a single shader module (same pattern as image_ops.wgsl).
//
// Provenance of each kernel (all clean-room, ported from the PrismML llama.cpp
// fork, byte-aligned with kernels/reference.ts and model/ops.ts):
//   enc_rmsnorm_main ......... rmsnorm.wgsl            (one workgroup per token)
//   enc_rmsnorm_heads_main ... image_ops.wgsl rmsnorm_heads_main (per (token,head))
//   enc_quantize_q8_0_main ... quantize_q8_0.wgsl      (activation Q8_0)
//   enc_q2_0_q8_0_matmul_main  q2_0_q8_0_matmul.wgsl   (Q2_0 weight matmul)
//   enc_swiglu_main .......... swiglu.wgsl             (silu(gate)*up)
//   enc_rope_main ........... rope_imrope.wgsl         (NEOX pairing (p, p+rot/2))
//   enc_attn_main ............ softmax_attn_batched.wgsl PLUS a pad-key mask:
//     the encoder's causal limit is min(t, nReal-1) \u2014 pad keys never attendable.
//   enc_add_main / enc_copy_main ... elementwise residual add + hidden-state capture.
//
// Model config (from the GGUF KV): hidden 2560, 36 layers, 32 heads, 8 KV heads,
// head_dim 128, rope_theta 1e6, eps 1e-6, intermediate 9728. Q2_0 weights are the
// PrismML fork convention: { f16 d; u8 qs[32] } = 34 B/128 weights, LSB-first 2-bit,
// value (q-1)*d \u2014 identical to reference.ts q2Bits and the LLM runtime's repack.

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 RMSNorm (full dim) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// One workgroup per token row; two-pass reduce over dim; f32 accumulation.
struct EncRnP {
  n    : u32,
  eps  : f32,
  _p0 : u32, _p1 : u32,
};

@group(0) @binding(0) var<storage, read>       enc_rn_x : array<f32>;  // n_rows * n
@group(0) @binding(1) var<storage, read>       enc_rn_w : array<f32>;  // n
@group(0) @binding(2) var<storage, read_write> enc_rn_y : array<f32>;  // n_rows * n
@group(0) @binding(3) var<uniform>             enc_rnp  : EncRnP;

const ENC_RN_WG : u32 = 256u;
var<workgroup> enc_rn_partial : array<f32, 256>;

@compute @workgroup_size(256)
fn enc_rmsnorm_main(@builtin(workgroup_id) wg : vec3<u32>,
                    @builtin(local_invocation_id) lid : vec3<u32>,
                    @builtin(num_workgroups) nwg : vec3<u32>) {
  let row = wg.x + wg.y * nwg.x;
  let n   = enc_rnp.n;
  let base = row * n;
  let tid  = lid.x;
  var ss : f32 = 0.0;
  var i : u32 = tid;
  loop {
    if (i >= n) { break; }
    let v = enc_rn_x[base + i];
    ss = ss + v * v;
    i = i + ENC_RN_WG;
  }
  enc_rn_partial[tid] = ss;
  workgroupBarrier();
  var stride : u32 = ENC_RN_WG >> 1u;
  loop {
    if (stride == 0u) { break; }
    if (tid < stride) { enc_rn_partial[tid] = enc_rn_partial[tid] + enc_rn_partial[tid + stride]; }
    workgroupBarrier();
    stride = stride >> 1u;
  }
  let mean  = enc_rn_partial[0] / f32(n);
  let scale = inverseSqrt(mean + enc_rnp.eps);
  var o : u32 = tid;
  loop {
    if (o >= n) { break; }
    enc_rn_y[base + o] = enc_rn_x[base + o] * scale * enc_rn_w[o];
    o = o + ENC_RN_WG;
  }
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 RMSNorm per (token, head) over head_dim \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// q_norm (32 heads) and k_norm (8 heads) share one 128-long weight vector.
struct EncRhP {
  tokens   : u32,
  heads    : u32,
  head_dim : u32,
  eps      : f32,
};

@group(0) @binding(0) var<storage, read>       enc_rh_x : array<f32>;
@group(0) @binding(1) var<storage, read>       enc_rh_w : array<f32>;
@group(0) @binding(2) var<storage, read_write> enc_rh_y : array<f32>;
@group(0) @binding(3) var<uniform>             enc_rhp  : EncRhP;

var<workgroup> enc_rh_red : array<f32, 64>;

@compute @workgroup_size(64)
fn enc_rmsnorm_heads_main(@builtin(workgroup_id) wg : vec3<u32>,
                          @builtin(local_invocation_id) lid : vec3<u32>,
                          @builtin(num_workgroups) nwg : vec3<u32>) {
  let pair = wg.x + wg.y * nwg.x;
  if (pair >= enc_rhp.tokens * enc_rhp.heads) { return; }
  let hd   = enc_rhp.head_dim;
  let base = pair * hd;
  let lane = lid.x;
  var s : f32 = 0.0;
  var i : u32 = lane;
  loop {
    if (i >= hd) { break; }
    let v = enc_rh_x[base + i];
    s = s + v * v;
    i = i + 64u;
  }
  enc_rh_red[lane] = s;
  workgroupBarrier();
  var stride : u32 = 32u;
  loop {
    if (stride == 0u) { break; }
    if (lane < stride) { enc_rh_red[lane] = enc_rh_red[lane] + enc_rh_red[lane + stride]; }
    workgroupBarrier();
    stride = stride >> 1u;
  }
  let inv = inverseSqrt(enc_rh_red[0] / f32(hd) + enc_rhp.eps);
  workgroupBarrier();
  i = lane;
  loop {
    if (i >= hd) { break; }
    enc_rh_y[base + i] = enc_rh_x[base + i] * inv * enc_rh_w[i];
    i = i + 64u;
  }
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 activation quantize Q8_0 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// One workgroup per 32-block. d = max(|x|)/127 emitted as f16 bits; qs as int8.
const ENC_Q8 : u32 = 32u;

@group(0) @binding(0) var<storage, read>       enc_q8_x  : array<f32>;  // n_blocks * 32
@group(0) @binding(1) var<storage, read_write> enc_q8_d  : array<u32>;  // n_blocks (f16 low 16)
@group(0) @binding(2) var<storage, read_write> enc_q8_qs : array<u32>;  // n_blocks * 8

var<workgroup> enc_q8_amax : array<f32, 32>;
var<workgroup> enc_q8_q    : array<u32, 32>;

@compute @workgroup_size(32)
fn enc_quantize_q8_0_main(@builtin(workgroup_id) wg : vec3<u32>,
                          @builtin(local_invocation_id) lid : vec3<u32>,
                          @builtin(num_workgroups) nwg : vec3<u32>) {
  let block = wg.x + wg.y * nwg.x;
  let lane  = lid.x;
  let base  = block * ENC_Q8;
  let x = enc_q8_x[base + lane];
  enc_q8_amax[lane] = abs(x);
  workgroupBarrier();
  var stride : u32 = 16u;
  loop {
    if (stride == 0u) { break; }
    if (lane < stride) { enc_q8_amax[lane] = max(enc_q8_amax[lane], enc_q8_amax[lane + stride]); }
    workgroupBarrier();
    stride = stride >> 1u;
  }
  let amax  = enc_q8_amax[0];
  let d_f16 = pack2x16float(vec2<f32>(amax / 127.0, 0.0)) & 0xffffu;
  let d     = unpack2x16float(d_f16).x;
  let id    = select(0.0, 1.0 / d, d != 0.0);
  var q : i32 = i32(round(x * id));
  q = clamp(q, -127, 127);
  enc_q8_q[lane] = u32(q) & 0xffu;
  workgroupBarrier();
  if (lane == 0u) {
    enc_q8_d[block] = d_f16;
    for (var w : u32 = 0u; w < 8u; w = w + 1u) {
      let o = w * 4u;
      enc_q8_qs[block * 8u + w] =
          enc_q8_q[o + 0u]
        | (enc_q8_q[o + 1u] << 8u)
        | (enc_q8_q[o + 2u] << 16u)
        | (enc_q8_q[o + 3u] << 24u);
    }
  }
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 Q2_0 weights x Q8_0 activations matmul \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// One workgroup per 64 output cols of one row; K-tiled; integer accumulation;
// exactly the fork's ggml_vec_dot_q2_0_q8_0 ordering (see q2_0_q8_0_matmul.wgsl).
const ENC_QM_TILE : u32 = 32u;  // Q2_0 blocks per K-tile (32*128 = 4096 K)

struct EncQmD { K : u32, n_cols : u32, n_rows : u32, col_tiles : u32 };

@group(0) @binding(0) var<storage, read>       enc_qm_w : array<u32>;
@group(0) @binding(1) var<storage, read>       enc_qm_d : array<u32>;
@group(0) @binding(2) var<storage, read>       enc_qm_q : array<u32>;
@group(0) @binding(3) var<storage, read_write> enc_qm_y : array<f32>;
@group(0) @binding(4) var<uniform>             enc_qmd  : EncQmD;

var<workgroup> enc_qm_sh_d  : array<u32, 128>;
var<workgroup> enc_qm_sh_qs : array<u32, 1024>;

fn enc_q2_byte(block_base : u32, byte_index : u32) -> u32 {
  let word = enc_qm_w[block_base + (byte_index >> 2u)];
  return (word >> ((byte_index & 3u) * 8u)) & 0xffu;
}

fn enc_sext8(b : u32) -> i32 {
  return (i32(b) ^ 0x80) - 0x80;
}

@compute @workgroup_size(64)
fn enc_q2_0_q8_0_matmul_main(@builtin(local_invocation_id) lid : vec3<u32>,
                             @builtin(workgroup_id) wid : vec3<u32>,
                             @builtin(num_workgroups) nwg : vec3<u32>) {
  let local = lid.x;
  let wg    = wid.x + wid.y * nwg.x;
  let row   = wg / enc_qmd.col_tiles;
  if (row >= enc_qmd.n_rows) { return; }
  let col = (wg % enc_qmd.col_tiles) * 64u + local;
  let valid = col < enc_qmd.n_cols;

  let n_q2 = enc_qmd.K / 128u;
  let a_row_q8_base = row * (enc_qmd.K / 32u);

  var result : f32 = 0.0;
  var c0 : u32 = 0u;
  loop {
    if (c0 >= n_q2) { break; }
    let cn = min(ENC_QM_TILE, n_q2 - c0);
    let n_q8 = cn * 4u;
    let q8_base = a_row_q8_base + c0 * 4u;
    var t : u32 = local;
    loop { if (t >= n_q8) { break; } enc_qm_sh_d[t] = enc_qm_d[q8_base + t]; t = t + 64u; }
    t = local;
    loop { if (t >= n_q8 * 8u) { break; } enc_qm_sh_qs[t] = enc_qm_q[q8_base * 8u + t]; t = t + 64u; }
    workgroupBarrier();

    if (valid) {
      var il : u32 = 0u;
      loop {
        if (il >= cn) { break; }
        let i  = c0 + il;
        let wb = (col * n_q2 + i) * 9u;
        let d0 = unpack2x16float(enc_qm_w[wb] & 0xffffu).x;

        var block_sum : f32 = 0.0;
        for (var k : u32 = 0u; k < 4u; k = k + 1u) {
          let qb    = il * 4u + k;
          let d1    = unpack2x16float(enc_qm_sh_d[qb] & 0xffffu).x;
          let qs_sh = qb * 8u;
          let sbb   = 2u + k * 8u;
          var acc : i32 = 0;
          for (var wi : u32 = 0u; wi < 8u; wi = wi + 1u) {
            let aword = enc_qm_sh_qs[qs_sh + wi];
            let sbyte = enc_q2_byte(wb, sbb + wi);
            for (var m : u32 = 0u; m < 4u; m = m + 1u) {
              let q2 = (sbyte >> (m << 1u)) & 3u;
              let q8 = enc_sext8((aword >> (m * 8u)) & 0xffu);
              acc = acc + (i32(q2) - 1) * q8;
            }
          }
          block_sum = block_sum + d1 * f32(acc);
        }
        result = result + d0 * block_sum;
        il = il + 1u;
      }
    }
    workgroupBarrier();
    c0 = c0 + ENC_QM_TILE;
  }
  if (valid) { enc_qm_y[row * enc_qmd.n_cols + col] = result; }
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 SwiGLU gate \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// out[i] = silu(gate[i]) * up[i]; gate/up are the q2_0 matmul outputs.
@group(0) @binding(0) var<storage, read>       enc_sw_g : array<f32>;
@group(0) @binding(1) var<storage, read>       enc_sw_u : array<f32>;
@group(0) @binding(2) var<storage, read_write> enc_sw_y : array<f32>;
@group(0) @binding(3) var<uniform>             enc_sw_n : u32;

fn enc_silu(z : f32) -> f32 { return z / (1.0 + exp(-z)); }

@compute @workgroup_size(256)
fn enc_swiglu_main(@builtin(workgroup_id) wg_ : vec3<u32>,
                   @builtin(local_invocation_id) lid_ : vec3<u32>,
                   @builtin(num_workgroups) nwg_ : vec3<u32>) {
  let i = (wg_.x + wg_.y * nwg_.x) * 256u + lid_.x;
  if (i >= enc_sw_n) { return; }
  enc_sw_y[i] = enc_silu(enc_sw_g[i]) * enc_sw_u[i];
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 RoPE (NEOX half-split pairing) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Pair p touches components (p, p + rot_dim/2); freq = pos * freq_base^(-2p/rot).
// This is qwen3's rope (verified against the golden: torch rotate_half pairing).
struct EncRopeP {
  n_heads   : u32,
  head_dim  : u32,
  rot_dim   : u32,
  pos_base  : u32,
  freq_base : f32,
  scale     : f32,
  _p0 : u32, _p1 : u32,
};

@group(0) @binding(0) var<storage, read_write> enc_rope_x : array<f32>;
@group(0) @binding(1) var<uniform>             enc_ropep  : EncRopeP;

@compute @workgroup_size(64)
fn enc_rope_main(@builtin(workgroup_id) wg_ : vec3<u32>,
                 @builtin(local_invocation_id) lid_ : vec3<u32>,
                 @builtin(num_workgroups) nwg_ : vec3<u32>) {
  let pairs_per_head = enc_ropep.rot_dim / 2u;
  let per_token = enc_ropep.n_heads * pairs_per_head;
  let idx = (wg_.x + wg_.y * nwg_.x) * 64u + lid_.x;
  let token = idx / per_token;
  let rem   = idx % per_token;
  let head  = rem / pairs_per_head;
  let pair  = rem % pairs_per_head;
  let head_base = (token * enc_ropep.n_heads + head) * enc_ropep.head_dim;
  let i0 = head_base + pair;
  let i1 = i0 + pairs_per_head;
  let pos = f32(enc_ropep.pos_base + token) * enc_ropep.scale;
  let theta = pos * pow(enc_ropep.freq_base, -2.0 * f32(pair) / f32(enc_ropep.rot_dim));
  let c = cos(theta);
  let s = sin(theta);
  let x0 = enc_rope_x[i0];
  let x1 = enc_rope_x[i1];
  enc_rope_x[i0] = x0 * c - x1 * s;
  enc_rope_x[i1] = x0 * s + x1 * c;
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 causal GQA attention + pad-key mask \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// One workgroup per (query token, head); online (flash-style) softmax over the
// causal key range CLIPPED to the real tokens: query t attends keys
// [0, min(t, nReal-1)]. Pad keys are never attendable \u2014 that is the differential's
// winning variant (causal + pad-key-mask, corr 0.9999 on the golden's real rows).
// q [n_tokens*n_heads*head_dim] post-RoPE; k/v [kv_len*n_heads_kv*head_dim] f32;
// out [n_tokens*n_heads*head_dim].
struct EncAttnP {
  n_tokens   : u32,
  n_heads    : u32,
  n_heads_kv : u32,
  head_dim   : u32,
  pos_base   : u32,
  n_real     : u32,
  scale      : f32,
  mode       : u32,
};

@group(0) @binding(0) var<storage, read>       enc_at_q   : array<u32>;
@group(0) @binding(1) var<storage, read>       enc_at_k   : array<u32>;
@group(0) @binding(2) var<storage, read>       enc_at_v   : array<u32>;
@group(0) @binding(3) var<storage, read_write> enc_at_y   : array<f32>;
@group(0) @binding(4) var<uniform>             enc_atp    : EncAttnP;
@group(0) @binding(5) var<storage, read>       enc_at_ks  : array<u32>;  // dummy (f32 mode)
@group(0) @binding(6) var<storage, read>       enc_at_vs  : array<u32>;  // dummy (f32 mode)

fn enc_readK(e : u32, scale : f32) -> f32 {
  if (enc_atp.mode == 1u) {
    let w = e >> 3u;
    let n = e & 7u;
    let raw = (enc_at_k[w] >> (n * 4u)) & 0xFu;
    return (f32(raw) - 8.0) * scale;
  }
  return bitcast<f32>(enc_at_k[e]);
}
fn enc_readV(e : u32, scale : f32) -> f32 {
  if (enc_atp.mode == 1u) {
    let w = e >> 3u;
    let n = e & 7u;
    let raw = (enc_at_v[w] >> (n * 4u)) & 0xFu;
    return (f32(raw) - 8.0) * scale;
  }
  return bitcast<f32>(enc_at_v[e]);
}

const ENC_AT_WG : u32 = 128u;
const ENC_AT_DPT : u32 = 2u;
var<workgroup> enc_at_red : array<f32, 128>;

@compute @workgroup_size(128)
fn enc_attn_main(@builtin(workgroup_id) wg_ : vec3<u32>,
                 @builtin(local_invocation_id) lid_ : vec3<u32>,
                 @builtin(num_workgroups) nwg_ : vec3<u32>) {
  let idx = wg_.x + wg_.y * nwg_.x;
  let total = enc_atp.n_tokens * enc_atp.n_heads;
  if (idx >= total) { return; }
  let tid = lid_.x;
  let hd  = enc_atp.head_dim;
  let t   = idx / enc_atp.n_heads;
  let h   = idx % enc_atp.n_heads;
  let kv_head = h / (enc_atp.n_heads / enc_atp.n_heads_kv);

  let q_base = (t * enc_atp.n_heads + h) * hd;
  let kv_per_pos = enc_atp.n_heads_kv * hd;
  // CAUSAL CLIPPED TO REAL KEYS: pad keys (positions >= n_real) are never attended.
  let last = min(enc_atp.pos_base + t, enc_atp.pos_base + enc_atp.n_real - 1u);

  var qv  : array<f32, 2>;
  var acc : array<f32, 2>;
  for (var i : u32 = 0u; i < ENC_AT_DPT; i = i + 1u) {
    let d = tid + i * ENC_AT_WG;
    qv[i]  = select(0.0, bitcast<f32>(enc_at_q[q_base + d]), d < hd);
    acc[i] = 0.0;
  }
  var m : f32 = -3.0e38;
  var l : f32 = 0.0;
  for (var pos : u32 = 0u; pos <= last; pos = pos + 1u) {
    var kScale : f32 = 0.0;
    var vScale : f32 = 0.0;
    if (enc_atp.mode == 1u) {
      let sIdx = pos * enc_atp.n_heads_kv + kv_head;
      kScale = unpack2x16float(enc_at_ks[sIdx]).x;
      vScale = unpack2x16float(enc_at_vs[sIdx]).x;
    }
    let k_base = pos * kv_per_pos + kv_head * hd;
    var part : f32 = 0.0;
    for (var i : u32 = 0u; i < ENC_AT_DPT; i = i + 1u) {
      let d = tid + i * ENC_AT_WG;
      if (d < hd) { part = part + qv[i] * enc_readK(k_base + d, kScale); }
    }
    enc_at_red[tid] = part;
    workgroupBarrier();
    var stride : u32 = ENC_AT_WG / 2u;
    loop {
      if (stride == 0u) { break; }
      if (tid < stride) { enc_at_red[tid] = enc_at_red[tid] + enc_at_red[tid + stride]; }
      workgroupBarrier();
      stride = stride / 2u;
    }
    let s = enc_at_red[0] * enc_atp.scale;
    let m_new = max(m, s);
    let corr  = exp(m - m_new);
    let w     = exp(s - m_new);
    l = l * corr + w;
    let v_base = pos * kv_per_pos + kv_head * hd;
    for (var i : u32 = 0u; i < ENC_AT_DPT; i = i + 1u) {
      let d = tid + i * ENC_AT_WG;
      if (d < hd) { acc[i] = acc[i] * corr + w * enc_readV(v_base + d, vScale); }
    }
    m = m_new;
    workgroupBarrier();
  }
  let inv = select(0.0, 1.0 / l, l > 0.0);
  for (var i : u32 = 0u; i < ENC_AT_DPT; i = i + 1u) {
    let d = tid + i * ENC_AT_WG;
    if (d < hd) { enc_at_y[q_base + d] = acc[i] * inv; }
  }
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 elementwise add / copy \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// enc_add: y = a + b (residuals). enc_copy: y = x (hidden-state capture).
@group(0) @binding(0) var<storage, read>       enc_ew_a : array<f32>;
@group(0) @binding(1) var<storage, read>       enc_ew_b : array<f32>;
@group(0) @binding(2) var<storage, read_write> enc_ew_y : array<f32>;
@group(0) @binding(3) var<uniform>             enc_ew_n : u32;

@compute @workgroup_size(256)
fn enc_add_main(@builtin(workgroup_id) wg_ : vec3<u32>,
                @builtin(local_invocation_id) lid_ : vec3<u32>,
                @builtin(num_workgroups) nwg_ : vec3<u32>) {
  let i = (wg_.x + wg_.y * nwg_.x) * 256u + lid_.x;
  if (i >= enc_ew_n) { return; }
  enc_ew_y[i] = enc_ew_a[i] + enc_ew_b[i];
}

@group(0) @binding(0) var<storage, read>       enc_cp_x : array<f32>;
@group(0) @binding(1) var<storage, read_write> enc_cp_y : array<f32>;
@group(0) @binding(2) var<uniform>             enc_cp_n : u32;

@compute @workgroup_size(256)
fn enc_copy_main(@builtin(workgroup_id) wg_ : vec3<u32>,
                 @builtin(local_invocation_id) lid_ : vec3<u32>,
                 @builtin(num_workgroups) nwg_ : vec3<u32>) {
  let i = (wg_.x + wg_.y * nwg_.x) * 256u + lid_.x;
  if (i >= enc_cp_n) { return; }
  enc_cp_y[i] = enc_cp_x[i];
}
`;function ot(){const e=[];for(let a=33;a<=126;a++)e.push(a);for(let a=161;a<=172;a++)e.push(a);for(let a=174;a<=255;a++)e.push(a);const r=[...e];let t=0;for(let a=0;a<256;a++)e.includes(a)||(e.push(a),r.push(256+t),t++);const n=new Map;for(let a=0;a<e.length;a++)n.set(e[a],String.fromCodePoint(r[a]));return n}var it=3,ut=4;function st(e,r,t=[]){const n=new Map;e.forEach((c,g)=>n.set(c,g));const a=new Map;r.forEach((c,g)=>a.set(c,g));const o=ot(),u=new Map;o.forEach((c,g)=>u.set(c,g));const s=[],_=t.length===e.length;e.forEach((c,g)=>{(_?t[g]===it||t[g]===ut:c.length>=5&&c.startsWith("<|")&&c.endsWith("|>"))&&s.push([c,g])}),s.sort((c,g)=>g[0].length-c[0].length);const f=new Map(s);return{vocab:n,idToToken:e,mergeRank:a,byteEncoder:o,byteDecoder:u,specialTokens:f}}function ct(e,r){if(e.length<2)return e;let t=e;for(;;){let n=1/0,a=-1;for(let o=0;o<t.length-1;o++){const u=r.get(`${t[o]} ${t[o+1]}`);u!==void 0&&u<n&&(n=u,a=o)}if(a===-1)break;t=[...t.slice(0,a),t[a]+t[a+1],...t.slice(a+2)]}return t}var tn=/'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu,rn=new WeakMap;function lt(e){let r=rn.get(e);if(r===void 0){if(e.specialTokens.size===0)r=null;else{const t=[...e.specialTokens.keys()].map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|");r=new RegExp(t,"g")}rn.set(e,r)}return r}function an(e,r,t){let n=e;for(;n.length>0;){tn.lastIndex=0;const a=tn.exec(n);if(!a)break;const o=a[0],s=new TextEncoder().encode(o),_=Array.from(s,c=>r.byteEncoder.get(c)),f=ct(_,r.mergeRank);for(const c of f){const g=r.vocab.get(c);if(g!==void 0)t.push(g);else for(const m of c){const i=r.vocab.get(m);i!==void 0&&t.push(i)}}n=n.slice(o.length)}}function dt(e,r){const t=[],n=lt(r);let a=0;if(n){n.lastIndex=0;let o;for(;(o=n.exec(e))!==null;)o.index>a&&an(e.slice(a,o.index),r,t),t.push(r.specialTokens.get(o[0])),a=o.index+o[0].length}return a<e.length&&an(e.slice(a),r,t),t}function pt(e,r=!0,t){let n="";if(t&&t.length>0){n+=`<|im_start|>system
`,e[0]?.role==="system"&&(n+=e[0].content+`

`),n+=`# Tools

You may call one or more functions to assist with the user query.

`,n+=`You are provided with function signatures within <tools></tools> XML tags:
`,n+="<tools>";for(const o of t)n+=`
`+JSON.stringify(o);n+=`
</tools>

`,n+=`For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:
`,n+=`<tool_call>
`,n+=`{"name": <function-name>, "arguments": <args-json-object>}
`,n+="</tool_call>",n+=`<|im_end|>
`}else e[0]?.role==="system"&&(n+=`<|im_start|>system
${e[0].content}<|im_end|>
`);const a=t&&t.length>0&&e[0]?.role==="system"||!t&&e[0]?.role==="system"?1:0;for(let o=a;o<e.length;o++){const u=e[o];if(u.role==="user")n+=`<|im_start|>user
${u.content}<|im_end|>
`;else if(u.role==="assistant"){let s=u.content,_=u.reasoning_content||"";if(_?n+=`<|im_start|>assistant
<think>
${_.trim()}
</think>

`:n+=`<|im_start|>assistant
`,s&&(n+=s),u.tool_calls&&u.tool_calls.length>0)for(const f of u.tool_calls){s&&(n+=`
`);const c=f.function||f;n+=`<tool_call>
`,n+=JSON.stringify({name:c.name,arguments:typeof c.arguments=="string"?JSON.parse(c.arguments):c.arguments}),n+=`
</tool_call>`}n+=`<|im_end|>
`}else u.role==="tool"&&(n+=`<|im_start|>user
<tool_response>
${u.content}
</tool_response><|im_end|>
`)}return r&&(n+=`<|im_start|>assistant
<think>

</think>

`),n}function ft(e){let r=e>>>0;return()=>{r=r+1831565813>>>0;let t=r;return t=Math.imul(t^t>>>15,t|1),t^=t+Math.imul(t^t>>>7,t|61),((t^t>>>14)>>>0)/4294967296}}function _t(e,r){const t=ft(e),n=new Float32Array(r);for(let a=0;a<r;a+=2){const o=Math.max(t(),1e-12),u=t();n[a]=Math.sqrt(-2*Math.log(o))*Math.cos(2*Math.PI*u),a+1<r&&(n[a+1]=Math.sqrt(-2*Math.log(o))*Math.sin(2*Math.PI*u))}return n}var gt=(()=>{const e=new Uint32Array(256);for(let r=0;r<256;r++){let t=r;for(let n=0;n<8;n++)t=t&1?3988292384^t>>>1:t>>>1;e[r]=t>>>0}return e})();function ht(e){let r=4294967295;for(let t=0;t<e.length;t++)r=gt[(r^e[t])&255]^r>>>8;return(r^4294967295)>>>0}function Ge(e,r){const t=new Uint8Array(12+r.length),n=new DataView(t.buffer);return n.setUint32(0,r.length),t.set(new TextEncoder().encode(e),4),t.set(r,8),n.setUint32(8+r.length,ht(t.subarray(4,8+r.length))),t}async function mt(e,r,t,n=3){const a=r*n+1,o=new Uint8Array(a*t);for(let m=0;m<t;m++){const i=m*a;o[i]=0;for(let T=0;T<r*n;T++){const P=e[m*r*n+T];o[i+1+T]=Math.max(0,Math.min(255,Math.round((P+1)*127.5)))}}const u=new CompressionStream("deflate"),s=await new Response(new ReadableStream({start(m){m.enqueue(o),m.close()}}).pipeThrough(u)).arrayBuffer(),_=new Uint8Array(13),f=new DataView(_.buffer);f.setUint32(0,r),f.setUint32(4,t),_[8]=8,_[9]=n===4?6:2;const c=[],g=new Uint8Array(8);return g.set([137,80,78,71,13,10,26,10]),c.push(g),c.push(Ge("IHDR",_)),c.push(Ge("IDAT",new Uint8Array(s))),c.push(Ge("IEND",new Uint8Array(0))),new Blob(c,{type:"image/png"})}async function wt(e,r){const t=await r(0,7),n=Number(new DataView(t.buffer,t.byteOffset,8).getBigUint64(0,!0)),a=await r(8,8+n-1),o=JSON.parse(new TextDecoder().decode(a)),u=new Map;for(const[s,_]of Object.entries(o)){if(s==="__metadata__")continue;const f=_;u.set(s,{dtype:f.dtype,shape:f.shape,start:8+n+f.data_offsets[0],length:f.data_offsets[1]-f.data_offsets[0]})}return u}function bt(e,r){return(t,n)=>r(t,t+n-1)}async function yt(e,r){const t=new Ke({url:e,fetchRange:r}),n=await Xe(t),a=new Map(n.tensors.map(o=>[o.name,o]));return zn({read:bt(e,r),tensors:a,tensorDataBase:n.tensorDataBase})}function vt(e){function r(n){const a=e.get(n);if(a)return a;throw new Error(`vae weights: no tensor '${n}' \u2014 the plan-name\u2192checkpoint mapping is pinned by the spike verdict; see the bundle header`)}function t(n,a){const o=n.replace(/[./]/g,"."),u=[],s=g=>{u.push(a==="weight"?g:g.replace(/.weight$/,"")+".bias")};s(o),s(`decoder.${o}`),s(`decoder.${o}.weight`);const _=/^mid.resnet.(d+).(conv|norm)$/.exec(o);if(_){const[,g,m]=_,i=`decoder.mid_block.resnets.${g}`;s(m==="conv"?`${i}.conv1`:`${i}.norm1`),s(m==="conv"?`${i}.conv2`:`${i}.norm2`)}const f=/^up.(d+).resnet.(d+).(conv|norm)$/.exec(o);if(f){const[,g,m,i]=f,T=`decoder.up_blocks.${g}.resnets.${m}`;s(i==="conv"?`${T}.conv1`:`${T}.norm1`),s(i==="conv"?`${T}.conv2`:`${T}.norm2`)}const c=/^up.(d+).upsample.conv$/.exec(o);c&&s(`decoder.up_blocks.${c[1]}.upsamplers.0.conv`);for(const g of u)if(index.has(g))return g;throw new Error(`vae weights: no tensor for plan op '${n}' (${a}) \u2014 tried: ${u.join(", ")}`)}return{conv:(n,a,o)=>{const u=a.conv,s=t(a.name,"weight"),_=t(a.name,"bias"),f={inC:u.inC,outC:u.outC,h:o[1],w:o[2],k:u.k,pad:u.pad,stride:u.stride};return Zn(n,r(s),r(_),f)},groupnorm:(n,a,o)=>{const u=t(a.name,"weight"),s=t(a.name,"bias");return et(n,r(u),r(s),o[0],o[1],o[2],a.groups??32)},silu:n=>tt(n),upsample:(n,a,o)=>nt(n,o[0],o[1],o[2],a.scale??2)}}function ze(e){const r=e&32768?-1:1,t=e>>10&31,n=e&1023;return t===0?r*n*2**-24:t===31?n?Number.NaN:r*(1/0):r*(1+n/1024)*2**(t-15)}function Mt(e){return new Float32Array(new Uint32Array([e<<16]).buffer)[0]}var on=!1,un=36,O=2560,xe=32,Ae=8,te=128,We=9728,sn=1e-6,kt=1e6,D=512,xt=151643,Et={rmsnorm:"enc_rmsnorm_main",rmsnormHeads:"enc_rmsnorm_heads_main",quantize:"enc_quantize_q8_0_main",q2q8Matmul:"enc_q2_0_q8_0_matmul_main",swiglu:"enc_swiglu_main",rope:"enc_rope_main",attn:"enc_attn_main",add:"enc_add_main",copy:"enc_copy_main"};function se(e){const r=new ArrayBuffer(Math.max(16,Math.ceil(e.length/4)*16)),t=new DataView(r);return e.forEach(([n,a],o)=>a?t.setFloat32(o*4,n,!0):t.setUint32(o*4,n,!0)),r}function qt(e){const r=Math.floor(e.length/34),t=new Uint8Array(r*36);for(let n=0;n<r;n++)t.set(e.subarray(n*34,n*34+34),n*36);return t}async function cn(e,r,t){const n=(w,S)=>t(w,w+S-1),a=new Ke({url:r,fetchRange:t}),o=await Xe(a),u=new Map(o.tensors.map(w=>[w.name,w])),s=o.kv,_=s.get("tokenizer.ggml.tokens");if(!_)throw new Error("bonsai-image: encoder GGUF has no tokenizer.ggml.tokens KV \u2014 the asset at "+r+" is not the R1-T6 build (correct model + tokenizer KV).");const f=s.get("tokenizer.ggml.merges")??[],c=s.get("tokenizer.ggml.token_type")??[],g=st(_,f,c),m=e.createShaderModule({code:at}),T=((await m.getCompilationInfo?.())?.messages??[]).filter(w=>w.type==="error");if(T.length)throw new Error("encoder kernels failed to compile: "+T.map(w=>`${w.lineNum}: ${w.message}`).join(" | "));const P=new Map;for(const[w,S]of Object.entries(Et))P.set(w,e.createComputePipeline({layout:"auto",compute:{module:m,entryPoint:S}}));const F=[],l=(w,S=0)=>{const x=e.createBuffer({size:Math.max(16,Math.ceil(w/16)*16),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC|S});return F.push(x),x},d=new Map,q=w=>w.type===42?w.nElements/128*34:w.nElements*(w.type===1?2:4);async function Y(w){const S=d.get(w);if(S)return S;const x=u.get(w);if(!x)throw new Error(`bonsai-image: encoder has no tensor '${w}'`);const k=o.tensorDataBase+x.relOffset;if(x.type===42){const y=await n(k,q(x)),N=qt(y),C=l(N.byteLength);return e.queue.writeBuffer(C,0,N),d.set(w,C),C}if(x.type===1){const y=await n(k,q(x)),N=x.nElements,C=new Float32Array(N),L=new DataView(y.buffer,y.byteOffset,y.byteLength);for(let H=0;H<N;H++)C[H]=ze(L.getUint16(H*2,!0));const z=l(N*4);return e.queue.writeBuffer(z,0,C.buffer,0,N*4),d.set(w,z),z}throw new Error(`bonsai-image: encoder tensor '${w}' has unsupported type ${x.type}`)}async function X(w){const S=u.get("token_embd.weight");if(!S||S.type!==1)throw new Error("bonsai-image: encoder has no F16 token_embd.weight");const x=2*O,k=o.tensorDataBase+S.relOffset,y=new Float32Array(D*O),N=new Map;for(let C=0;C<D;C++){const L=w[C];let z=N.get(L);if(!z){const H=await n(k+L*x,x);z=new Float32Array(O);const re=new DataView(H.buffer,H.byteOffset,x);for(let J=0;J<O;J++)z[J]=ze(re.getUint16(J*2,!0));N.set(L,z)}y.set(z,C*O)}return y}async function V(){const w=[];for(let k=0;k<un;k++){const y=`blk.${k}.`;w.push(y+"attn_norm.weight",y+"attn_q.weight",y+"attn_k.weight",y+"attn_v.weight",y+"attn_q_norm.weight",y+"attn_k_norm.weight",y+"attn_output.weight",y+"ffn_norm.weight",y+"ffn_gate.weight",y+"ffn_up.weight",y+"ffn_down.weight")}let S=0;const x=Array.from({length:4},async()=>{for(;S<w.length;){const k=w[S++];d.has(k)||await Y(k)}});await Promise.all(x)}function I(w){const S=pt([{role:"user",content:w}],!0),x=dt(S,g);if(x.length>D)throw new Error(`bonsai-image: prompt is ${x.length} tokens; the qwen3-4b encoder caps at ${D}`);const k=new Uint32Array(D).fill(xt);for(let y=0;y<x.length;y++)k[y]=x[y];return{ids:k,nReal:x.length}}async function W(w,S){await V();const x=await X(w),k=e.createCommandEncoder(),y=k.beginComputePass(),N=b=>l(b*4),C=b=>{const M=l(b.byteLength);return e.queue.writeBuffer(M,0,b.buffer,b.byteOffset,b.byteLength),M},L=(b,M,$,R,K=M.length)=>{const B=P.get(b),G=[];for(let Z=0;Z<M.length;Z++){if($&&Z===K){const pe=l($.byteLength,GPUBufferUsage.UNIFORM);e.queue.writeBuffer(pe,0,$),G.push({binding:Z,resource:{buffer:pe}});continue}G.push({binding:Z,resource:{buffer:M[Z]}})}if($&&K===M.length){const Z=l($.byteLength,GPUBufferUsage.UNIFORM);e.queue.writeBuffer(Z,0,$),G.push({binding:K,resource:{buffer:Z}})}y.setPipeline(B),y.setBindGroup(0,e.createBindGroup({layout:B.getBindGroupLayout(0),entries:G}));const Q=Math.min(R,65535),ee=Math.ceil(Math.max(1,R)/65535);y.dispatchWorkgroups(Math.max(1,Q),Math.max(1,ee))},z=(b,M)=>{const $=N(D*O);return L("rmsnorm",[b,d.get(M),$],se([[O,!1],[sn,!0],[0,!1],[0,!1]]),D),$},H=(b,M,$)=>{const R=N(D*$*te);return L("rmsnormHeads",[b,d.get(M),R],se([[D,!1],[$,!1],[te,!1],[sn,!0]]),D*$),R},re=(b,M,$)=>{const R=D,K=O,B=Math.ceil(R*K/32),G=N(B),Q=N(B*8);L("quantize",[b,G,Q],null,B);const ee=N(R*$);return L("q2q8Matmul",[d.get(M),G,Q,ee],se([[K,!1],[$,!1],[R,!1],[Math.ceil($/64),!1]]),R*Math.ceil($/64)),ee},J=(b,M,$)=>{const R=D,K=We,B=Math.ceil(R*$/32),G=N(B),Q=N(B*8);L("quantize",[b,G,Q],null,B);const ee=N(R*K);return L("q2q8Matmul",[d.get(M),G,Q,ee],se([[$,!1],[K,!1],[R,!1],[Math.ceil(K/64),!1]]),R*Math.ceil(K/64)),ee},j=(b,M)=>{L("rope",[b],se([[M,!1],[te,!1],[te,!1],[0,!1],[kt,!0],[1,!0],[0,!1],[0,!1]]),Math.ceil(D*M*(te/2)/64))},ie=N(4),fe=(b,M,$,R)=>{const K=N(D*xe*te);return L("attn",[b,M,$,K,ie,ie],se([[D,!1],[xe,!1],[Ae,!1],[te,!1],[0,!1],[R,!1],[1/Math.sqrt(te),!0],[0,!1]]),D*xe,4),K},ce=(b,M)=>{const $=D*We,R=N($);return L("swiglu",[b,M,R],se([[$,!1]]),Math.ceil($/256)),R},Te=(b,M)=>{const $=D*O,R=N($);return L("add",[b,M,R],se([[$,!1]]),Math.ceil($/256)),R},le=b=>{const M=D*O,$=N(M);return L("copy",[b,$],se([[M,!1]]),Math.ceil(M/256)),$};let be=C(x);const Me=[];for(let b=0;b<un;b++){const M=`blk.${b}.`,$=z(be,M+"attn_norm.weight"),R=re($,M+"attn_q.weight",xe*te),K=re($,M+"attn_k.weight",Ae*te),B=re($,M+"attn_v.weight",Ae*te),G=H(R,M+"attn_q_norm.weight",xe),Q=H(K,M+"attn_k_norm.weight",Ae);j(G,xe),j(Q,Ae);const ee=fe(G,Q,B,S),Z=re(ee,M+"attn_output.weight",O);let pe=Te(be,Z);const ge=z(pe,M+"ffn_norm.weight"),ve=J(ge,M+"ffn_gate.weight",O),he=J(ge,M+"ffn_up.weight",O),me=ce(ve,he),Se=J(me,M+"ffn_down.weight",We);be=Te(pe,Se),(b===9||b===18||b===27)&&Me.push(le(be))}y.end();const ye=Me.map(b=>{const M=e.createBuffer({size:Math.max(16,D*O*4),usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});return k.copyBufferToBuffer(b,0,M,0,D*O*4),M});e.queue.submit([k.finish()]),await Promise.all(ye.map(b=>b.mapAsync(GPUMapMode.READ)));const de=ye.map(b=>new Float32Array(b.getMappedRange().slice(0))),_e=new Float32Array(D*O*3);for(let b=0;b<D;b++)_e.set(de[0].subarray(b*O,(b+1)*O),b*O*3),_e.set(de[1].subarray(b*O,(b+1)*O),b*O*3+O),_e.set(de[2].subarray(b*O,(b+1)*O),b*O*3+2*O);return ye.forEach(b=>b.unmap()),_e}return{encode:W,tokenize:I,destroy:()=>{for(const w of F)w.destroy()}}}async function At(e){const r=e.fetchRange??De(e.weightsUrl),t=(l,d,q)=>{e.onProgress?.({phase:l,percent:d,detail:q})};t("device",5);const n=navigator.gpu;if(!n)throw new Error("WebGPU not available on this browser");let a=await n.requestAdapter({powerPreference:"high-performance"});if(a||(a=await n.requestAdapter({forceFallbackAdapter:!0}).catch(()=>null)),!a)throw new Error("No WebGPU adapter found");const o=a.limits??{},u={};for(const l of["maxStorageBufferBindingSize","maxBufferSize","maxComputeWorkgroupStorageSize"]){const d=o[l];typeof d=="number"&&d>0&&(u[l]=d)}const s=await a.requestDevice({requiredLimits:u});t("compile",10);const _=await Cn(s,nn);t("weights",15);const f=await yt(e.weightsUrl,r);let c=null;if(e.vaeWeightsUrl){t("weights",20,"vae decoder");const l=De(e.vaeWeightsUrl),d=await wt(e.vaeWeightsUrl,l),q=new Map,Y=d;for(let X=0;X<Y.length;X+=12){const V=Y.slice(X,X+12),I=await Promise.all(V.map(([W,w])=>l(w.start,w.start+w.length-1)));t("weights",20+Math.round(X/Y.length*10),"vae decoder");for(let W=0;W<V.length;W++){const[w,S]=V[W],x=I[W];if(S.dtype==="F32")q.set(w,new Float32Array(x.buffer.slice(x.byteOffset,x.byteOffset+S.length)));else if(S.dtype==="F16"){const k=new Float32Array(S.length/2),y=new DataView(x.buffer,x.byteOffset,S.length);for(let N=0;N<k.length;N++)k[N]=ze(y.getUint16(N*2,!0));q.set(w,k)}else if(S.dtype==="BF16"){const k=new Float32Array(S.length/2),y=new Uint16Array(x.buffer,x.byteOffset,S.length/2),N=new Uint32Array(k.buffer);for(let C=0;C<y.length;C++)N[C]=y[C]<<16;q.set(w,k)}else{if(S.dtype==="I64"||S.dtype==="I32")continue;throw new Error(`vae weights: '${w}' has unsupported dtype ${S.dtype}`)}}}c=vt(q)}let g=!1;const m=Sn;let i=null;async function T(){if(!i){const l=new URL("./qwen3-4b-encoder.q2_0.gguf",e.weightsUrl).href;t("encode",2,"text encoder"),i=await cn(s,l,r)}return i}async function P(l,d,q,Y,X){const V=await T(),{ids:I,nReal:W}=V.tokenize(l),w=await V.encode(I,W);on=!0;const S=new Float32Array(d*4);for(let k=0;k<d;k++)S[k*4]=0,S[k*4+1]=Math.floor(k/X),S[k*4+2]=k%X,S[k*4+3]=0;const x=new Float32Array(D*4);for(let k=0;k<D;k++)x[k*4+3]=k;return{encoderHiddenStates:w,imgIds:S,txtIds:x,nTxt:D}}async function F(l){if(g)throw new Error("bonsai-image runtime disposed");const d=Math.round(l.width??256),q=Math.round(l.height??256);if(d%16!==0||q%16!==0)throw new Error(`bonsai-image: ${d}x${q} is not a multiple of 16 (latent grid must divide by 16)`);if(d>1024||q>1024)throw new Error("bonsai-image: sizes above 1024px are not supported on-device");const Y=Math.max(1,Math.min(32,Math.round(l.steps??4))),X=Math.floor(l.seed??Math.random()*2**31)>>>0,V=q/16,I=d/16,W=V*I+1,w=await P(l.prompt,W,X,V,I),S=Hn(W+w.nTxt),x=Kn(Y,S);let k=_t(X,W*m.inChannels);for(let j=0;j<Y;j++){const ie={hiddenStates:k,encoderHiddenStates:w.encoderHiddenStates,imgIds:w.imgIds,txtIds:w.txtIds,timestep:x[j],nImg:W,nTxt:w.nTxt},fe=await _.forward(ie,m,f);k=Qn(k,fe,x[j],j+1<Y?x[j+1]:0),t("denoise",Math.round((j+1)/Y*60),`step ${j+1}/${Y}`),await new Promise(ce=>setTimeout(ce,0))}if(t("vae",85),!c)throw new Error("bonsai-image: VAE weights were not provided (vaeWeightsUrl)");const y={...Pe,latentSize:V},N=k.subarray(0,Pe.latentChannels*V*I),C=Xn(N,c,y);t("encode",95);const L=await mt(C,I*8,V*8);if(d===I*8&&q===V*8)return L;const z=await createImageBitmap(L),H=document.createElement("canvas");H.width=d,H.height=q,H.getContext("2d").drawImage(z,0,0,d,q),z.close();const J=await new Promise(j=>H.toBlob(j,"image/png"));if(!J)throw new Error("bonsai-image: canvas upscale produced no blob");return J}return{ready:!0,generate:F,dispose:()=>{g=!0,i?.destroy(),_.destroy(),s.destroy()}}}export{nn as IMAGE_OPS_WGSL,rt as VAE_OPS_WGSL,At as createBonsaiImageRuntime,cn as createEncoderRuntime,on as encoderReady};
