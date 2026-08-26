/* webmcp-studio-runtime webmcp-studio-runtime-v1 — built 2026-08-26T00:22:25.050Z by AitherOS/dev/tools/build_webml_cdn.mjs */

// AitherOS/apps/AitherVeil/src/lib/bonsai-webgpu/gguf/reader.ts
var MAX_RANGE_ATTEMPTS = 3;
function isRetriableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var RANGE_STALL_TIMEOUT_MS = 2e4;
function httpRangeFetcher(url) {
  return async (start, endInclusive) => {
    const mb = ((endInclusive - start + 1) / 1048576).toFixed(1);
    let lastError = "";
    for (let attempt = 1; attempt <= MAX_RANGE_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      let stalled = false;
      const armWatchdog = () => setTimeout(() => {
        stalled = true;
        controller.abort();
      }, RANGE_STALL_TIMEOUT_MS);
      let watchdog = armWatchdog();
      const bumpWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = armWatchdog();
      };
      try {
        let res;
        try {
          res = await fetch(url, {
            headers: { Range: `bytes=${start}-${endInclusive}` },
            cache: "force-cache",
            signal: controller.signal
          });
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          if (stalled) {
            lastError = `stalled (no response for ${RANGE_STALL_TIMEOUT_MS / 1e3}s)`;
          }
          if (attempt < MAX_RANGE_ATTEMPTS) {
            await sleep(250 * 2 ** (attempt - 1));
            continue;
          }
          const offline = typeof navigator !== "undefined" && navigator.onLine === false;
          throw new Error(
            `bonsai-gguf: fetch failed for ${mb} MB range ${start}-${endInclusive} of ${url} after ${MAX_RANGE_ATTEMPTS} attempts${offline ? " (browser reports OFFLINE)" : ""}. ` + (stalled ? `The server accepted the connection but never answered (stalled ${RANGE_STALL_TIMEOUT_MS / 1e3}s). ` : "") + `If the screen also flickered, the GPU driver reset and took this request with it \u2014 that is a GPU fault, not a network one. Last error: ${lastError}`
          );
        }
        if (res.status !== 206 && res.status !== 200) {
          lastError = `HTTP ${res.status}`;
          if (isRetriableStatus(res.status) && attempt < MAX_RANGE_ATTEMPTS) {
            await sleep(250 * 2 ** (attempt - 1));
            continue;
          }
          throw new Error(
            `bonsai-gguf: range GET ${start}-${endInclusive} (${mb} MB) of ${url} returned ${res.status}`
          );
        }
        try {
          const body = res.body;
          if (!body) return new Uint8Array(await res.arrayBuffer());
          const reader = body.getReader();
          const chunks = [];
          let total = 0;
          for (; ; ) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              bumpWatchdog();
              chunks.push(value);
              total += value.byteLength;
            }
          }
          const out = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) {
            out.set(c, off);
            off += c.byteLength;
          }
          return out;
        } catch (e) {
          if (stalled) {
            lastError = `stalled mid-body (no progress for ${RANGE_STALL_TIMEOUT_MS / 1e3}s)`;
            if (attempt < MAX_RANGE_ATTEMPTS) {
              await sleep(250 * 2 ** (attempt - 1));
              continue;
            }
            throw new Error(
              `bonsai-gguf: range GET ${start}-${endInclusive} (${mb} MB) of ${url} stalled mid-body (no progress for ${RANGE_STALL_TIMEOUT_MS / 1e3}s) after ${MAX_RANGE_ATTEMPTS} attempts. Last error: ${lastError}`
            );
          }
          throw new Error(
            `bonsai-gguf: reading ${mb} MB range body failed (device out of memory?): ${e instanceof Error ? e.message : String(e)}`
          );
        }
      } finally {
        clearTimeout(watchdog);
      }
    }
    throw new Error(`bonsai-gguf: range ${start}-${endInclusive} exhausted retries: ${lastError}`);
  };
}
var RangeReader = class {
  constructor(init) {
    /** Absolute file offset that byte 0 of `buf` corresponds to (we always anchor at 0). */
    this.filled = 0;
    // bytes valid from absolute 0
    this.cursor = 0;
    this.url = init.url;
    this.fetchRange = init.fetchRange ?? httpRangeFetcher(init.url);
    this.contentLength = init.contentLength;
    this.initialWindow = init.initialWindow ?? 1 << 20;
    this.buf = new Uint8Array(0);
  }
  get position() {
    return this.cursor;
  }
  /** Ensure absolute bytes [0, need) are resident, range-fetching more as required. */
  async ensure(need) {
    if (need <= this.filled) return;
    let target = Math.max(need, this.filled + this.initialWindow);
    if (this.contentLength !== void 0) target = Math.min(target, this.contentLength);
    const chunk = await this.fetchRange(this.filled, target - 1);
    const next = new Uint8Array(this.filled + chunk.length);
    next.set(this.buf.subarray(0, this.filled), 0);
    next.set(chunk, this.filled);
    this.buf = next;
    this.filled += chunk.length;
    if (this.filled < need) {
      throw new Error(
        `bonsai-gguf: underfilled window (have ${this.filled}, need ${need}) \u2014 server may not support ranges`
      );
    }
  }
  async view(len) {
    await this.ensure(this.cursor + len);
    return new DataView(this.buf.buffer, this.buf.byteOffset + this.cursor, len);
  }
  async u8() {
    const v = (await this.view(1)).getUint8(0);
    this.cursor += 1;
    return v;
  }
  async u32() {
    const v = (await this.view(4)).getUint32(0, true);
    this.cursor += 4;
    return v;
  }
  async i32() {
    const v = (await this.view(4)).getInt32(0, true);
    this.cursor += 4;
    return v;
  }
  async f32() {
    const v = (await this.view(4)).getFloat32(0, true);
    this.cursor += 4;
    return v;
  }
  async f64() {
    const v = (await this.view(8)).getFloat64(0, true);
    this.cursor += 8;
    return v;
  }
  async u16() {
    const v = (await this.view(2)).getUint16(0, true);
    this.cursor += 2;
    return v;
  }
  async i16() {
    const v = (await this.view(2)).getInt16(0, true);
    this.cursor += 2;
    return v;
  }
  async i8() {
    const v = (await this.view(1)).getInt8(0);
    this.cursor += 1;
    return v;
  }
  /** u64 -> Number (safe < 2^53; GGUF counts/offsets never exceed that here). */
  async u64() {
    const dv = await this.view(8);
    const lo = dv.getUint32(0, true);
    const hi = dv.getUint32(4, true);
    this.cursor += 8;
    const v = hi * 4294967296 + lo;
    if (!Number.isSafeInteger(v)) throw new Error(`bonsai-gguf: u64 ${v} exceeds MAX_SAFE_INTEGER`);
    return v;
  }
  async i64() {
    return this.u64();
  }
  /** gguf_string_t: u64 length + raw UTF-8 bytes. */
  async string() {
    const len = await this.u64();
    await this.ensure(this.cursor + len);
    const bytes = this.buf.subarray(this.cursor, this.cursor + len);
    this.cursor += len;
    return new TextDecoder("utf-8").decode(bytes);
  }
  /** Absolute-seek the read cursor (used to jump to tensor_data_base alignment). */
  seek(absolute) {
    this.cursor = absolute;
  }
  /** Copy raw bytes [start, start+len) — resident window, for small tensors/tests. */
  async bytes(start, len) {
    await this.ensure(start + len);
    return this.buf.slice(start, start + len);
  }
};

// AitherOS/apps/AitherVeil/src/lib/bonsai-webgpu/gguf/types.ts
var TYPE_TRAITS = {
  [0 /* F32 */]: { blockSize: 1, typeSize: 4, name: "F32" },
  [1 /* F16 */]: { blockSize: 1, typeSize: 2, name: "F16" },
  [8 /* Q8_0 */]: { blockSize: 32, typeSize: 34, name: "Q8_0" },
  [41 /* Q1_0 */]: { blockSize: 128, typeSize: 18, name: "Q1_0" },
  [42 /* Q2_0 */]: { blockSize: 128, typeSize: 34, name: "Q2_0" }
};
var QK2_0 = 128;
var Q2_0_BYTES = 34;
function typeTrait(t) {
  const tr = TYPE_TRAITS[t];
  if (!tr) throw new Error(`bonsai-gguf: unsupported ggml type ${t} (not in TYPE_TRAITS)`);
  return tr;
}
function tensorNBytes(t, nElements) {
  const { blockSize, typeSize } = typeTrait(t);
  if (nElements % blockSize !== 0) {
    throw new Error(
      `bonsai-gguf: element count ${nElements} not a multiple of block size ${blockSize} for ${typeTrait(t).name}`
    );
  }
  return nElements / blockSize * typeSize;
}

// AitherOS/apps/AitherVeil/src/lib/bonsai-webgpu/gguf/parser.ts
var GGUF_MAGIC = 1179993927;
function align(x, a) {
  return x + (a - x % a) % a;
}
async function readScalar(r, t) {
  switch (t) {
    case 0 /* UINT8 */:
      return r.u8();
    case 1 /* INT8 */:
      return r.i8();
    case 2 /* UINT16 */:
      return r.u16();
    case 3 /* INT16 */:
      return r.i16();
    case 4 /* UINT32 */:
      return r.u32();
    case 5 /* INT32 */:
      return r.i32();
    case 6 /* FLOAT32 */:
      return r.f32();
    case 7 /* BOOL */:
      return await r.u8() !== 0;
    case 8 /* STRING */:
      return r.string();
    case 10 /* UINT64 */:
      return r.u64();
    case 11 /* INT64 */:
      return r.i64();
    case 12 /* FLOAT64 */:
      return r.f64();
    default:
      throw new Error(`bonsai-gguf: cannot read scalar of value-type ${t}`);
  }
}
async function readValue(r, t) {
  if (t === 9 /* ARRAY */) {
    const elemType = await r.u32();
    const count = await r.u64();
    if (elemType === 9 /* ARRAY */) {
      throw new Error("bonsai-gguf: nested arrays are not permitted by the spec");
    }
    const out = new Array(count);
    for (let i = 0; i < count; i++) out[i] = await readScalar(r, elemType);
    return out;
  }
  return readScalar(r, t);
}
async function parseGguf(r) {
  const magic = await r.u32();
  if (magic !== GGUF_MAGIC) {
    throw new Error(`bonsai-gguf: bad magic 0x${magic.toString(16)} (expected 0x46554747)`);
  }
  const version = await r.u32();
  if (version !== 3) {
    throw new Error(`bonsai-gguf: unsupported GGUF version ${version} (need 3)`);
  }
  const tensorCount = await r.u64();
  const metadataKvCount = await r.u64();
  const header = { version, tensorCount, metadataKvCount };
  const kv = /* @__PURE__ */ new Map();
  for (let i = 0; i < metadataKvCount; i++) {
    const key = await r.string();
    const valueType = await r.u32();
    const value = await readValue(r, valueType);
    kv.set(key, value);
  }
  const alignment = numberKv(kv, "general.alignment", 32);
  const tensors = [];
  for (let i = 0; i < tensorCount; i++) {
    const name = await r.string();
    const nDims = await r.u32();
    const dims = new Array(nDims);
    for (let d = 0; d < nDims; d++) dims[d] = await r.u64();
    const type = await r.u32();
    const relOffset = await r.u64();
    const nElements = dims.reduce((a, b) => a * b, 1);
    typeTrait(type);
    const nBytes = tensorNBytes(type, nElements);
    tensors.push({ name, dims, type, relOffset, nElements, nBytes });
  }
  const tensorDataBase = align(r.position, alignment);
  assertBlockGeometry(tensors, alignment);
  return { header, kv, tensors, tensorDataBase, alignment };
}
function assertBlockGeometry(tensors, alignment) {
  if (tensors.length < 2) return;
  const byOffset = [...tensors].sort((a, b) => a.relOffset - b.relOffset);
  for (let i = 0; i < byOffset.length - 1; i++) {
    const t = byOffset[i];
    const gap = byOffset[i + 1].relOffset - t.relOffset;
    const expected = align(t.nBytes, alignment);
    if (gap === expected) continue;
    const trait = typeTrait(t.type);
    const ratio = t.nBytes > 0 ? gap / t.nBytes : 0;
    throw new Error(
      `bonsai-gguf: tensor '${t.name}' (type ${t.type} = ${trait.name}) occupies ${gap} bytes in the file but this build computes ${t.nBytes} (aligned ${expected}) from ${trait.blockSize} weights/${trait.typeSize} bytes per block \u2014 a factor of ${ratio.toFixed(4)}. The declared type id does not match the file's actual block geometry, so every read of this tensor would be at the wrong stride and would produce plausible-looking WRONG values rather than an error. If this is a '*_g64' ternary file, it uses group 64 under the same type id 42 and is NOT loadable by this runtime \u2014 use the group-128 '*-Q2_0.gguf' build.`
    );
  }
}
function numberKv(kv, key, fallback) {
  const v = kv.get(key);
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return fallback;
}

// AitherOS/apps/AitherVeil/src/lib/bonsai-webgpu/image/mmdit.ts
var BONSAI_IMAGE_4B = {
  inChannels: 128,
  numLayers: 5,
  numSingleLayers: 20,
  attentionHeadDim: 128,
  numAttentionHeads: 24,
  jointAttentionDim: 7680,
  axesDimsRope: [32, 32, 32, 32],
  ropeTheta: 2e3,
  mlpRatio: 3,
  eps: 1e-6,
  timestepChannels: 256
};
function innerDim(c) {
  return c.numAttentionHeads * c.attentionHeadDim;
}
function ffInnerDim(c) {
  return Math.trunc(innerDim(c) * c.mlpRatio);
}
function silu(x) {
  return x / (1 + Math.exp(-x));
}
var TIMESTEP_SCALE = 1e3;
function timestepEmbedding(t, dim) {
  const half = dim >> 1;
  const out = new Float32Array(dim);
  for (let i = 0; i < half; i++) {
    const freq = Math.exp(-Math.log(1e4) * i / half);
    const a = t * freq;
    out[i] = Math.cos(a);
    out[half + i] = Math.sin(a);
  }
  return out;
}
function ropeTables(ids, tokens, axesDims, theta) {
  const nAxes = axesDims.length;
  const headDim = axesDims.reduce((a, b) => a + b, 0);
  const cos = new Float32Array(tokens * headDim);
  const sin = new Float32Array(tokens * headDim);
  for (let t = 0; t < tokens; t++) {
    let off = 0;
    for (let a = 0; a < nAxes; a++) {
      const d = axesDims[a];
      const pos = ids[t * nAxes + a];
      for (let k = 0; k < d / 2; k++) {
        const f = pos / Math.pow(theta, 2 * k / d);
        const c = Math.cos(f);
        const s = Math.sin(f);
        cos[t * headDim + off + 2 * k] = c;
        cos[t * headDim + off + 2 * k + 1] = c;
        sin[t * headDim + off + 2 * k] = s;
        sin[t * headDim + off + 2 * k + 1] = s;
      }
      off += d;
    }
  }
  return { cos, sin };
}
function splitModulation(mod, dim, sets) {
  if (mod.length !== dim * 3 * sets) {
    throw new Error("splitModulation: got " + mod.length + ", expected " + dim * 3 * sets);
  }
  const chunk = (i) => mod.subarray(i * dim, (i + 1) * dim);
  const out = [];
  for (let s = 0; s < sets; s++) {
    out.push({ shift: chunk(3 * s), scale: chunk(3 * s + 1), gate: chunk(3 * s + 2) });
  }
  return out;
}

// AitherOS/apps/AitherVeil/src/lib/bonsai-webgpu/image/gpu-runtime.ts
var ENTRY = {
  matmul: "matmul_main",
  layernorm: "layernorm_main",
  modulate: "modulate_main",
  add_gated: "add_gated_main",
  rope: "rope_interleaved_main",
  attn: "attn_full_main",
  swiglu: "swiglu_fused_main",
  rmsheads: "rmsnorm_heads_main",
  copy: "copy_strided_main"
};
function align16(n) {
  return Math.max(16, Math.ceil(n / 16) * 16);
}
function uniformBytes(words) {
  const ub = new ArrayBuffer(align16(words.length * 4));
  const dv = new DataView(ub);
  words.forEach(([v, isFloat], i) => isFloat ? dv.setFloat32(i * 4, v, true) : dv.setUint32(i * 4, v, true));
  return ub;
}
async function createImageRuntime(device, wgsl) {
  const module = device.createShaderModule({ code: wgsl });
  const info = await module.getCompilationInfo?.();
  const errs = (info?.messages ?? []).filter((m) => m.type === "error");
  if (errs.length) {
    throw new Error("image kernels failed to compile: " + errs.map((e) => `${e.lineNum}: ${e.message}`).join(" | "));
  }
  const pipelines = /* @__PURE__ */ new Map();
  for (const [name, entryPoint] of Object.entries(ENTRY)) {
    pipelines.set(name, device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint }
    }));
  }
  const owned = [];
  const newBuffer = (bytes, extra = 0) => {
    const b = device.createBuffer({
      size: align16(bytes),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | extra
    });
    owned.push(b);
    return b;
  };
  async function forward(input, cfg, w, taps) {
    const dim = innerDim(cfg);
    const inner = ffInnerDim(cfg);
    const H = cfg.numAttentionHeads;
    const D = cfg.attentionHeadDim;
    const nImg = input.nImg;
    const nTxt = input.nTxt;
    const nAll = nTxt + nImg;
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    const readbacks = [];
    const buf = (elems) => newBuffer(elems * 4);
    const upload = (data) => {
      const b = newBuffer(data.byteLength);
      device.queue.writeBuffer(
        b,
        0,
        data.buffer,
        data.byteOffset,
        data.byteLength
      );
      return b;
    };
    const wcache = /* @__PURE__ */ new Map();
    const weight = (name) => {
      let b = wcache.get(name);
      if (!b) {
        b = upload(w(name));
        wcache.set(name, b);
      }
      return b;
    };
    const dispatch = (op, bindings, uni, workgroups) => {
      const p = pipelines.get(op);
      const ub = newBuffer(uni.byteLength, GPUBufferUsage.UNIFORM);
      device.queue.writeBuffer(ub, 0, uni);
      const entries = bindings.map((buffer, binding) => ({ binding, resource: { buffer } }));
      entries.push({ binding: bindings.length, resource: { buffer: ub } });
      pass.setPipeline(p);
      pass.setBindGroup(
        0,
        device.createBindGroup({ layout: p.getBindGroupLayout(0), entries })
      );
      const x2 = Math.min(workgroups, 65535);
      const y = Math.ceil(Math.max(1, workgroups) / 65535);
      pass.dispatchWorkgroups(Math.max(1, x2), Math.max(1, y));
    };
    const tap = (name, src, elems) => {
      if (!taps) return;
      const bytes = elems * 4;
      const dst = device.createBuffer({
        size: align16(bytes),
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      });
      readbacks.push({ name, buf: dst, bytes, src });
    };
    const matmul = (x2, wname, tokens, inDim, outDim) => {
      const y = buf(tokens * outDim);
      dispatch(
        "matmul",
        [x2, weight(wname), y],
        uniformBytes([[tokens, false], [inDim, false], [outDim, false], [0, false]]),
        tokens * outDim
      );
      return y;
    };
    const layerNorm = (x2, tokens) => {
      const y = buf(tokens * dim);
      dispatch(
        "layernorm",
        [x2, y],
        uniformBytes([[dim, false], [cfg.eps, true], [0, false], [0, false]]),
        tokens
      );
      return y;
    };
    const modulate = (x2, shift, scale, tokens) => {
      const y = buf(tokens * dim);
      dispatch(
        "modulate",
        [x2, shift, scale, y],
        uniformBytes([[dim, false], [tokens, false], [0, false], [0, false]]),
        Math.ceil(tokens * dim / 64)
      );
      return y;
    };
    const addGated = (x2, delta, gate, tokens) => {
      const y = buf(tokens * dim);
      dispatch(
        "add_gated",
        [x2, delta, gate, y],
        uniformBytes([[dim, false], [tokens, false], [0, false], [0, false]]),
        Math.ceil(tokens * dim / 64)
      );
      return y;
    };
    const rmsHeads = (x2, wname, tokens) => {
      const y = buf(tokens * H * D);
      dispatch(
        "rmsheads",
        [x2, weight(wname), y],
        uniformBytes([[tokens, false], [H, false], [D, false], [cfg.eps, true]]),
        tokens * H
      );
      return y;
    };
    const rope = (x2, cos, sin, tokens) => {
      const y = buf(tokens * H * D);
      dispatch(
        "rope",
        [x2, cos, sin, y],
        uniformBytes([[tokens, false], [H, false], [D, false], [0, false]]),
        Math.ceil(tokens * H * (D / 2) / 64)
      );
      return y;
    };
    const attention = (q, k, v, tokens) => {
      const y = buf(tokens * H * D);
      dispatch(
        "attn",
        [q, k, v, y],
        uniformBytes([[tokens, false], [H, false], [D, false], [1 / Math.sqrt(D), true]]),
        tokens * H
      );
      return y;
    };
    const swiglu = (x2, tokens) => {
      const y = buf(tokens * inner);
      dispatch(
        "swiglu",
        [x2, y],
        uniformBytes([[tokens, false], [inner, false], [0, false], [0, false]]),
        Math.ceil(tokens * inner / 64)
      );
      return y;
    };
    const strided = (src, dst, tokens, width, srcStride, srcOff, dstStride, dstOff) => {
      dispatch(
        "copy",
        [src, dst],
        uniformBytes([
          [tokens, false],
          [width, false],
          [srcStride, false],
          [srcOff, false],
          [dstStride, false],
          [dstOff, false],
          [0, false],
          [0, false]
        ]),
        Math.ceil(tokens * width / 64)
      );
    };
    const concatTok = (a, na, b, nb, width) => {
      const y = buf((na + nb) * width);
      strided(a, y, na, width, width, 0, width, 0);
      strided(b, y, nb, width, width, 0, width, na * width);
      return y;
    };
    const sliceTok = (src, offElems, elems) => {
      const y = buf(elems);
      strided(src, y, 1, elems, elems, offElems, elems, 0);
      return y;
    };
    const columns = (src, tokens, stride, off, width) => {
      const y = buf(tokens * width);
      strided(src, y, tokens, width, stride, off, width, 0);
      return y;
    };
    const joinCols = (a, wa, b, wb, tokens) => {
      const y = buf(tokens * (wa + wb));
      strided(a, y, tokens, wa, wa, 0, wa + wb, 0);
      strided(b, y, tokens, wb, wb, 0, wa + wb, wa);
      return y;
    };
    const cpuMat = (v, wname, outDim) => {
      const wm = w(wname);
      const inDim = v.length;
      const out2 = new Float32Array(outDim);
      for (let o = 0; o < outDim; o++) {
        let s = 0;
        for (let i = 0; i < inDim; i++) s += v[i] * wm[o * inDim + i];
        out2[o] = s;
      }
      return out2;
    };
    const sin0 = timestepEmbedding(input.timestep * TIMESTEP_SCALE, cfg.timestepChannels);
    const t1 = Float32Array.from(
      cpuMat(sin0, "time_guidance_embed.timestep_embedder.linear_1.weight", dim),
      silu
    );
    const temb = cpuMat(t1, "time_guidance_embed.timestep_embedder.linear_2.weight", dim);
    if (taps) taps["stage_temb"] = temb;
    const tembAct = Float32Array.from(temb, silu);
    const modImgRaw = cpuMat(tembAct, "double_stream_modulation_img.linear.weight", dim * 6);
    const modTxtRaw = cpuMat(tembAct, "double_stream_modulation_txt.linear.weight", dim * 6);
    const modSglRaw = cpuMat(tembAct, "single_stream_modulation.linear.weight", dim * 3);
    if (taps) {
      taps["stage_mod_img"] = modImgRaw;
      taps["stage_mod_txt"] = modTxtRaw;
      taps["stage_mod_single"] = modSglRaw;
    }
    const modImg = splitModulation(modImgRaw, dim, 2);
    const modTxt = splitModulation(modTxtRaw, dim, 2);
    const modSgl = splitModulation(modSglRaw, dim, 1)[0];
    const up = (a) => upload(Float32Array.from(a));
    let img = matmul(
      upload(input.hiddenStates),
      "x_embedder.weight",
      nImg,
      cfg.inChannels,
      dim
    );
    tap("stage_x_embed", img, nImg * dim);
    let txt = matmul(
      upload(input.encoderHiddenStates),
      "context_embedder.weight",
      nTxt,
      cfg.jointAttentionDim,
      dim
    );
    tap("stage_context_embed", txt, nTxt * dim);
    const axes = cfg.axesDimsRope.length;
    const ids = new Float32Array(nAll * axes);
    ids.set(input.txtIds.subarray(0, nTxt * axes), 0);
    ids.set(input.imgIds.subarray(0, nImg * axes), nTxt * axes);
    const tbl = ropeTables(ids, nAll, cfg.axesDimsRope, cfg.ropeTheta);
    const cosB = upload(tbl.cos);
    const sinB = upload(tbl.sin);
    for (let b = 0; b < cfg.numLayers; b++) {
      const p = `transformer_blocks.${b}`;
      const i1 = modImg[0];
      const t1m = modTxt[0];
      const imgN = modulate(layerNorm(img, nImg), up(i1.shift), up(i1.scale), nImg);
      const txtN = modulate(layerNorm(txt, nTxt), up(t1m.shift), up(t1m.scale), nTxt);
      const q = rmsHeads(
        matmul(imgN, `${p}.attn.to_q.weight`, nImg, dim, dim),
        `${p}.attn.norm_q.weight`,
        nImg
      );
      const k = rmsHeads(
        matmul(imgN, `${p}.attn.to_k.weight`, nImg, dim, dim),
        `${p}.attn.norm_k.weight`,
        nImg
      );
      const v = matmul(imgN, `${p}.attn.to_v.weight`, nImg, dim, dim);
      const eq = rmsHeads(
        matmul(txtN, `${p}.attn.add_q_proj.weight`, nTxt, dim, dim),
        `${p}.attn.norm_added_q.weight`,
        nTxt
      );
      const ek = rmsHeads(
        matmul(txtN, `${p}.attn.add_k_proj.weight`, nTxt, dim, dim),
        `${p}.attn.norm_added_k.weight`,
        nTxt
      );
      const ev = matmul(txtN, `${p}.attn.add_v_proj.weight`, nTxt, dim, dim);
      const Q = rope(concatTok(eq, nTxt, q, nImg, dim), cosB, sinB, nAll);
      const K = rope(concatTok(ek, nTxt, k, nImg, dim), cosB, sinB, nAll);
      const V = concatTok(ev, nTxt, v, nImg, dim);
      const attn = attention(Q, K, V, nAll);
      img = addGated(
        img,
        matmul(
          sliceTok(attn, nTxt * dim, nImg * dim),
          `${p}.attn.to_out.0.weight`,
          nImg,
          dim,
          dim
        ),
        up(i1.gate),
        nImg
      );
      txt = addGated(
        txt,
        matmul(
          sliceTok(attn, 0, nTxt * dim),
          `${p}.attn.to_add_out.weight`,
          nTxt,
          dim,
          dim
        ),
        up(t1m.gate),
        nTxt
      );
      const i2 = modImg[1];
      const t2 = modTxt[1];
      const ffIn = modulate(layerNorm(img, nImg), up(i2.shift), up(i2.scale), nImg);
      const ffH = swiglu(matmul(ffIn, `${p}.ff.linear_in.weight`, nImg, dim, inner * 2), nImg);
      img = addGated(
        img,
        matmul(ffH, `${p}.ff.linear_out.weight`, nImg, inner, dim),
        up(i2.gate),
        nImg
      );
      const fcIn = modulate(layerNorm(txt, nTxt), up(t2.shift), up(t2.scale), nTxt);
      const fcH = swiglu(matmul(fcIn, `${p}.ff_context.linear_in.weight`, nTxt, dim, inner * 2), nTxt);
      txt = addGated(
        txt,
        matmul(fcH, `${p}.ff_context.linear_out.weight`, nTxt, inner, dim),
        up(t2.gate),
        nTxt
      );
      tap(`stage_double_${b}_0`, txt, nTxt * dim);
      tap(`stage_double_${b}_1`, img, nImg * dim);
    }
    let x = concatTok(txt, nTxt, img, nImg, dim);
    const fusedW = 3 * dim + 2 * inner;
    for (let b = 0; b < cfg.numSingleLayers; b++) {
      const p = `single_transformer_blocks.${b}`;
      const xn = modulate(layerNorm(x, nAll), up(modSgl.shift), up(modSgl.scale), nAll);
      const qkvMlp = matmul(xn, `${p}.attn.to_qkv_mlp_proj.weight`, nAll, dim, fusedW);
      const q = rope(rmsHeads(
        columns(qkvMlp, nAll, fusedW, 0, dim),
        `${p}.attn.norm_q.weight`,
        nAll
      ), cosB, sinB, nAll);
      const k = rope(rmsHeads(
        columns(qkvMlp, nAll, fusedW, dim, dim),
        `${p}.attn.norm_k.weight`,
        nAll
      ), cosB, sinB, nAll);
      const v = columns(qkvMlp, nAll, fusedW, 2 * dim, dim);
      const mlpIn = columns(qkvMlp, nAll, fusedW, 3 * dim, inner * 2);
      const cat = joinCols(attention(q, k, v, nAll), dim, swiglu(mlpIn, nAll), inner, nAll);
      x = addGated(
        x,
        matmul(cat, `${p}.attn.to_out.weight`, nAll, dim + inner, dim),
        up(modSgl.gate),
        nAll
      );
      tap(`stage_single_${b}`, x, nAll * dim);
    }
    const no = cpuMat(tembAct, "norm_out.linear.weight", dim * 2);
    const oScale = no.subarray(0, dim);
    const oShift = no.subarray(dim, dim * 2);
    const normed = modulate(
      layerNorm(sliceTok(x, nTxt * dim, nImg * dim), nImg),
      up(oShift),
      up(oScale),
      nImg
    );
    const out = matmul(normed, "proj_out.weight", nImg, dim, cfg.inChannels);
    tap("stage_proj_out", out, nImg * cfg.inChannels);
    pass.end();
    for (const r of readbacks) enc.copyBufferToBuffer(r.src, 0, r.buf, 0, r.bytes);
    const outBytes = nImg * cfg.inChannels * 4;
    const rb = device.createBuffer({
      size: align16(outBytes),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    enc.copyBufferToBuffer(out, 0, rb, 0, outBytes);
    device.queue.submit([enc.finish()]);
    for (const r of readbacks) {
      await r.buf.mapAsync(GPUMapMode.READ);
      taps[r.name] = new Float32Array(r.buf.getMappedRange().slice(0, r.bytes));
      r.buf.unmap();
      r.buf.destroy();
    }
    await rb.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(rb.getMappedRange().slice(0, outBytes));
    rb.unmap();
    rb.destroy();
    return result;
  }
  return {
    device,
    forward,
    destroy: () => {
      for (const b of owned) b.destroy();
      owned.length = 0;
    }
  };
}

// AitherOS/apps/AitherVeil/src/lib/bonsai-webgpu/kernels/reference.ts
var _f32 = new Float32Array(1);
var _u32 = new Uint32Array(_f32.buffer);
function f16ToF32(h) {
  const s = (h & 32768) >> 15;
  const e = (h & 31744) >> 10;
  const f = h & 1023;
  if (e === 0) {
    return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  }
  if (e === 31) {
    return f ? NaN : s ? -Infinity : Infinity;
  }
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}
function readQ2Block(bytes, off = 0) {
  if (bytes.length - off < Q2_0_BYTES) throw new Error("readQ2Block: need 34 bytes");
  const dBits = bytes[off] | bytes[off + 1] << 8;
  const qs = bytes.subarray(off + 2, off + 2 + 32);
  return { d: f16ToF32(dBits), qs: new Uint8Array(qs) };
}
function q2Bits(qs, j) {
  const byteIndex = j >> 2;
  const bitOffset = (j & 3) << 1;
  return qs[byteIndex] >> bitOffset & 3;
}
function dequantQ2Block(block) {
  const out = new Float32Array(QK2_0);
  for (let j = 0; j < QK2_0; j++) {
    const q = q2Bits(block.qs, j);
    out[j] = (q - 1) * block.d;
  }
  return out;
}
function dequantQ2Bytes(bytes, off = 0) {
  return dequantQ2Block(readQ2Block(bytes, off));
}

// AitherOS/apps/AitherVeil/src/lib/bonsai-webgpu/image/gguf-weights.ts
function tensorElements(t) {
  return t.dims.reduce((a, b) => a * b, 1);
}
function tensorBytes(t) {
  const n = tensorElements(t);
  switch (t.type) {
    case 0 /* F32 */:
      return n * 4;
    case 1 /* F16 */:
      return n * 2;
    case 42 /* Q2_0 */: {
      if (n % QK2_0 !== 0) {
        throw new Error(
          `gguf-weights: ${t.name} has ${n} elements, not a multiple of ${QK2_0}; a partial Q2_0 block would be completed from the next tensor's bytes`
        );
      }
      return n / QK2_0 * Q2_0_BYTES;
    }
    default:
      throw new Error(`gguf-weights: ${t.name} has unsupported type ${t.type}`);
  }
}
function dequantTensor(raw, t) {
  const n = tensorElements(t);
  switch (t.type) {
    case 0 /* F32 */:
      return new Float32Array(
        raw.buffer.slice(raw.byteOffset, raw.byteOffset + n * 4)
      );
    case 1 /* F16 */: {
      const out = new Float32Array(n);
      const dv = new DataView(raw.buffer, raw.byteOffset, n * 2);
      for (let i = 0; i < n; i++) out[i] = f16ToF32(dv.getUint16(i * 2, true));
      return out;
    }
    case 42 /* Q2_0 */: {
      const out = new Float32Array(n);
      const blocks = n / QK2_0;
      for (let b = 0; b < blocks; b++) {
        const vals = dequantQ2Bytes(raw, b * Q2_0_BYTES);
        out.set(vals, b * QK2_0);
      }
      return out;
    }
    default:
      throw new Error(`gguf-weights: ${t.name} has unsupported type ${t.type}`);
  }
}
function ggufWeightSource(init) {
  const cache = init.cache ? /* @__PURE__ */ new Map() : null;
  return (name) => {
    const hit = cache?.get(name);
    if (hit) return hit;
    const t = init.tensors.get(name);
    if (!t) {
      throw new Error(
        `gguf-weights: the checkpoint has no tensor '${name}'. Returning zeros here would make a misspelled weight produce a plausible, wrong image.`
      );
    }
    const nb = tensorBytes(t);
    const raw = init.read(init.tensorDataBase + t.relOffset, nb);
    if (raw.length !== nb) {
      throw new Error(
        `gguf-weights: read ${raw.length} bytes for '${name}', expected ${nb} \u2014 a short read yields a tensor padded with zeros rather than an error`
      );
    }
    const out = dequantTensor(raw, t);
    cache?.set(name, out);
    return out;
  };
}

// AitherOS/apps/AitherVeil/src/lib/bonsai-webgpu/image/scheduler.ts
var DEFAULT_SHIFT = {
  baseSeqLen: 256,
  maxSeqLen: 4096,
  baseShift: 0.5,
  maxShift: 1.15
};
function muForSeqLen(seqLen, spec = DEFAULT_SHIFT) {
  const { baseSeqLen, maxSeqLen, baseShift, maxShift } = spec;
  const span = maxSeqLen - baseSeqLen;
  if (span === 0) return baseShift;
  const m = (maxShift - baseShift) / span;
  return m * (seqLen - baseSeqLen) + baseShift;
}
function timeShift(sigma, mu) {
  if (sigma <= 0) return 0;
  const e = Math.exp(mu);
  return e / (e + (1 / sigma - 1));
}
function timesteps(steps, mu) {
  if (steps <= 0) return [];
  const out = [];
  for (let k = 0; k < steps; k++) out.push(timeShift(1 - k / steps, mu));
  return out;
}
function eulerStep(x, v, tCur, tNext) {
  if (x.length !== v.length) {
    throw new Error(
      `eulerStep: latent (${x.length}) and model output (${v.length}) differ in length; a silent broadcast here would corrupt the sample`
    );
  }
  const dt = tNext - tCur;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] + dt * v[i];
  return out;
}

// AitherOS/apps/AitherVeil/src/lib/bonsai-webgpu/image/vae-decoder.ts
var FLUX2_VAE = {
  blockOutChannels: [128, 256, 512, 512],
  layersPerBlock: 2,
  latentChannels: 32,
  normNumGroups: 32,
  latentSize: 32,
  outChannels: 3
};
function planDecode(cfg = FLUX2_VAE) {
  const ops = [];
  const chans = [...cfg.blockOutChannels].reverse();
  let c = chans[0];
  let s = cfg.latentSize;
  const conv = (name, inC, outC, k, pad) => {
    ops.push({
      kind: "conv",
      name,
      out: [outC, s, s],
      conv: { inC, outC, k, pad, stride: 1 }
    });
  };
  conv("conv_in", cfg.latentChannels, c, 3, 1);
  for (const n of ["mid.resnet.0", "mid.attn", "mid.resnet.1"]) {
    ops.push({
      kind: "groupnorm",
      name: `${n}.norm`,
      out: [c, s, s],
      groups: cfg.normNumGroups
    });
    ops.push({ kind: "silu", name: `${n}.act`, out: [c, s, s] });
    conv(`${n}.conv`, c, c, 3, 1);
  }
  for (let b = 0; b < chans.length; b++) {
    const outC = chans[b];
    for (let l = 0; l < cfg.layersPerBlock; l++) {
      ops.push({
        kind: "groupnorm",
        name: `up.${b}.resnet.${l}.norm`,
        out: [c, s, s],
        groups: cfg.normNumGroups
      });
      ops.push({ kind: "silu", name: `up.${b}.resnet.${l}.act`, out: [c, s, s] });
      conv(`up.${b}.resnet.${l}.conv`, c, outC, 3, 1);
      c = outC;
    }
    if (b < chans.length - 1) {
      s *= 2;
      ops.push({ kind: "upsample", name: `up.${b}.upsample`, out: [c, s, s], scale: 2 });
      conv(`up.${b}.upsample.conv`, c, c, 3, 1);
    }
  }
  ops.push({
    kind: "groupnorm",
    name: "conv_norm_out",
    out: [c, s, s],
    groups: cfg.normNumGroups
  });
  ops.push({ kind: "silu", name: "conv_act_out", out: [c, s, s] });
  conv("conv_out", c, cfg.outChannels, 3, 1);
  return ops;
}
function decodeWithOps(latent, ops, cfg = FLUX2_VAE) {
  const plan = planDecode(cfg);
  const expectIn = cfg.latentChannels * cfg.latentSize * cfg.latentSize;
  if (latent.length !== expectIn) {
    throw new Error(
      `vae decode: latent has ${latent.length} elements, expected ${expectIn} (${cfg.latentChannels}x${cfg.latentSize}x${cfg.latentSize})`
    );
  }
  let x = latent;
  let shape = [cfg.latentChannels, cfg.latentSize, cfg.latentSize];
  for (const op of plan) {
    switch (op.kind) {
      case "conv":
        x = ops.conv(x, op, shape);
        break;
      case "groupnorm":
        x = ops.groupnorm(x, op, shape);
        break;
      case "silu":
        x = ops.silu(x);
        break;
      case "upsample":
        x = ops.upsample(x, op, shape);
        break;
      default:
        throw new Error(`vae decode: unhandled op ${op.kind} at ${op.name}`);
    }
    const want = op.out[0] * op.out[1] * op.out[2];
    if (x.length !== want) {
      throw new Error(
        `vae decode: after ${op.name} the tensor has ${x.length} elements but the plan declares ${op.out.join("x")} = ${want}. A size drift here yields a wrong image rather than an error, so it is checked every op.`
      );
    }
    shape = op.out;
  }
  return x;
}

// AitherOS/apps/AitherVeil/src/lib/bonsai-webgpu/kernels/vae-reference.ts
function convOutH(s) {
  return Math.floor((s.h + 2 * s.pad - s.k) / s.stride) + 1;
}
function convOutW(s) {
  return Math.floor((s.w + 2 * s.pad - s.k) / s.stride) + 1;
}
function conv2dRef(x, weight, bias, s) {
  const oh = convOutH(s);
  const ow = convOutW(s);
  const y = new Float32Array(s.outC * oh * ow);
  for (let oc = 0; oc < s.outC; oc++) {
    for (let oy = 0; oy < oh; oy++) {
      for (let ox = 0; ox < ow; ox++) {
        let acc = bias[oc];
        for (let ic = 0; ic < s.inC; ic++) {
          for (let ky = 0; ky < s.k; ky++) {
            const iy = oy * s.stride + ky - s.pad;
            if (iy < 0 || iy >= s.h) continue;
            for (let kx = 0; kx < s.k; kx++) {
              const ix = ox * s.stride + kx - s.pad;
              if (ix < 0 || ix >= s.w) continue;
              acc += x[ic * s.h * s.w + iy * s.w + ix] * weight[(oc * s.inC + ic) * s.k * s.k + ky * s.k + kx];
            }
          }
        }
        y[oc * oh * ow + oy * ow + ox] = acc;
      }
    }
  }
  return y;
}
function groupNormRef(x, gamma, beta, c, h, w, groups, eps = 1e-6) {
  const y = new Float32Array(x.length);
  const cpg = c / groups;
  const plane = h * w;
  const slab = cpg * plane;
  for (let g = 0; g < groups; g++) {
    const base = g * slab;
    let mean = 0;
    for (let i = 0; i < slab; i++) mean += x[base + i];
    mean /= slab;
    let varr = 0;
    for (let i = 0; i < slab; i++) {
      const d = x[base + i] - mean;
      varr += d * d;
    }
    varr /= slab;
    const invStd = 1 / Math.sqrt(varr + eps);
    for (let i = 0; i < slab; i++) {
      const ch = g * cpg + Math.floor(i / plane);
      y[base + i] = (x[base + i] - mean) * invStd * gamma[ch] + beta[ch];
    }
  }
  return y;
}
function upsampleNearestRef(x, c, h, w, scale) {
  const oh = h * scale;
  const ow = w * scale;
  const y = new Float32Array(c * oh * ow);
  for (let ch = 0; ch < c; ch++) {
    for (let oy = 0; oy < oh; oy++) {
      for (let ox = 0; ox < ow; ox++) {
        const sy = Math.floor(oy / scale);
        const sx = Math.floor(ox / scale);
        y[ch * oh * ow + oy * ow + ox] = x[ch * h * w + sy * w + sx];
      }
    }
  }
  return y;
}
function siluRef(x) {
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] / (1 + Math.exp(-x[i]));
  return y;
}

// ../Users/wzns/AppData/Local/Temp/webml-cdn-stage/image-wgsl.gen.ts
var IMAGE_OPS_WGSL = "// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\n// \xA9 2026 Aitherium, LLC. Original work.\n//\n// The four ops the Flux2 MMDiT needs that the LLM kernels do not provide. Every one of\n// them has a CPU counterpart in `image/mmdit.ts`, which is differentially verified\n// against a real reference forward (37 stages, 5e-5), and every one is compared against\n// that counterpart on a real GPU by `e2e/bonsai-image-gpu-differential.mjs`.\n//\n// \u{1F6A8} WHY THESE ARE NEW RATHER THAN REUSED. Three of the four look like kernels that\n// already ship, and reusing those would be silently wrong:\n//\n//   layernorm        NOT rmsnorm.wgsl. RMSNorm does not subtract the mean. Flux2's\n//                    modulated norms are LayerNorm with elementwise_affine=FALSE --\n//                    mean-centred, and with no learnable weight, because the shift and\n//                    scale arrive from the modulation instead. Substituting RMSNorm\n//                    changes every activation and raises nothing.\n//\n//   rope_interleaved NOT rope_imrope.wgsl. That kernel pairs (p, p + rot/2) -- NEOX /\n//                    half-split -- and its own comment records that as a FIX (\"the old\n//                    (2p, 2p+1) pairing scrambled positional phase\"), which is true for\n//                    the LLM and exactly backwards here. Flux2 pairs ADJACENT\n//                    components (2p, 2p+1), from diffusers' use_real_unbind_dim=-1.\n//                    Asserted in both directions by\n//                    `e2e/bonsai-image-kernel-conventions.mjs`.\n//\n//   modulate         x * (1 + scale) + shift, with scale/shift broadcast over tokens.\n//                    Not elementwise.wgsl: the operands have different ranks.\n//\n//   add_gated        x + gate * delta, gate broadcast over tokens. The residual add of\n//                    every block; separate from `modulate` because fusing them would\n//                    force a caller that needs only one to supply dummies for the other.\n//\n// LAYOUT, shared by all four: activations are [token][channel] row-major, and for the\n// RoPE kernel [token][head][dim] -- the reference unflattens the projection to\n// (heads, headDim) on the LAST axis, so head h of token t is contiguous. Reading it as\n// [head][token][dim] transposes silently and is shape-compatible.\n\n// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 LayerNorm \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// One workgroup per TOKEN, cooperating over that token's channels. Not one thread per\n// token: dim is 3072 in this model, and a single lane walking it is the one-lane mistake\n// that made attention 8x slower than it had to be.\n//\n// Two passes (mean, then variance) rather than the sum/sum-of-squares trick: at f32 the\n// one-pass form loses precision exactly where the variance is small, and a modulated\n// norm's input is centred by construction.\n\nstruct LnP {\n  dim : u32,\n  eps : f32,\n  _p0 : u32, _p1 : u32,\n};\n\n@group(0) @binding(0) var<storage, read>       ln_x : array<f32>;\n@group(0) @binding(1) var<storage, read_write> ln_y : array<f32>;\n@group(0) @binding(2) var<uniform>             lnp  : LnP;\n\nvar<workgroup> ln_red : array<f32, 256>;\n\n@compute @workgroup_size(256)\nfn layernorm_main(@builtin(workgroup_id) wg : vec3<u32>,\n                  @builtin(local_invocation_id) lid : vec3<u32>) {\n  let t = wg.x;\n  let base = t * lnp.dim;\n  let tid = lid.x;\n\n  var s : f32 = 0.0;\n  var i : u32 = tid;\n  loop {\n    if (i >= lnp.dim) { break; }\n    s = s + ln_x[base + i];\n    i = i + 256u;\n  }\n  ln_red[tid] = s;\n  workgroupBarrier();\n  var stride : u32 = 128u;\n  loop {\n    if (stride == 0u) { break; }\n    if (tid < stride) { ln_red[tid] = ln_red[tid] + ln_red[tid + stride]; }\n    workgroupBarrier();\n    stride = stride >> 1u;\n  }\n  let mean = ln_red[0] / f32(lnp.dim);\n  workgroupBarrier();\n\n  var v : f32 = 0.0;\n  i = tid;\n  loop {\n    if (i >= lnp.dim) { break; }\n    let d = ln_x[base + i] - mean;\n    v = v + d * d;\n    i = i + 256u;\n  }\n  ln_red[tid] = v;\n  workgroupBarrier();\n  stride = 128u;\n  loop {\n    if (stride == 0u) { break; }\n    if (tid < stride) { ln_red[tid] = ln_red[tid] + ln_red[tid + stride]; }\n    workgroupBarrier();\n    stride = stride >> 1u;\n  }\n  let inv = inverseSqrt(ln_red[0] / f32(lnp.dim) + lnp.eps);\n  workgroupBarrier();\n\n  // NO learnable affine here on purpose: elementwise_affine=false. The shift and scale\n  // come from `modulate`, and applying one here would double-apply the conditioning.\n  i = tid;\n  loop {\n    if (i >= lnp.dim) { break; }\n    ln_y[base + i] = (ln_x[base + i] - mean) * inv;\n    i = i + 256u;\n  }\n}\n\n// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 modulate \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// y[t, c] = x[t, c] * (1 + scale[c]) + shift[c]\n\nstruct ModP {\n  dim    : u32,\n  tokens : u32,\n  _p0 : u32, _p1 : u32,\n};\n\n@group(0) @binding(0) var<storage, read>       md_x     : array<f32>;\n@group(0) @binding(1) var<storage, read>       md_shift : array<f32>;\n@group(0) @binding(2) var<storage, read>       md_scale : array<f32>;\n@group(0) @binding(3) var<storage, read_write> md_y     : array<f32>;\n@group(0) @binding(4) var<uniform>             mdp      : ModP;\n\n@compute @workgroup_size(64)\nfn modulate_main(@builtin(global_invocation_id) gid : vec3<u32>,\n                 @builtin(num_workgroups) nwg : vec3<u32>) {\n  let total = mdp.tokens * mdp.dim;\n  let idx = gid.x + gid.y * nwg.x * 64u;\n  if (idx >= total) { return; }\n  let c = idx % mdp.dim;\n  md_y[idx] = md_x[idx] * (1.0 + md_scale[c]) + md_shift[c];\n}\n\n// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 add_gated \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// y[t, c] = x[t, c] + gate[c] * delta[t, c]\n\n@group(0) @binding(0) var<storage, read>       ag_x     : array<f32>;\n@group(0) @binding(1) var<storage, read>       ag_delta : array<f32>;\n@group(0) @binding(2) var<storage, read>       ag_gate  : array<f32>;\n@group(0) @binding(3) var<storage, read_write> ag_y     : array<f32>;\n@group(0) @binding(4) var<uniform>             agp      : ModP;\n\n@compute @workgroup_size(64)\nfn add_gated_main(@builtin(global_invocation_id) gid : vec3<u32>,\n                  @builtin(num_workgroups) nwg : vec3<u32>) {\n  let total = agp.tokens * agp.dim;\n  let idx = gid.x + gid.y * nwg.x * 64u;\n  if (idx >= total) { return; }\n  let c = idx % agp.dim;\n  ag_y[idx] = ag_x[idx] + ag_gate[c] * ag_delta[idx];\n}\n\n// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 RoPE, INTERLEAVED pairs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// out[2p]   = x[2p]   * cos[2p]   - x[2p+1] * sin[2p]\n// out[2p+1] = x[2p+1] * cos[2p+1] + x[2p]   * sin[2p+1]\n//\n// cos/sin are per-TOKEN tables of head_dim entries, shared by every head, with each\n// frequency REPEAT-INTERLEAVED (slots 2p and 2p+1 carry the same value) to match\n// `repeat_interleave_real=True`. Reading cos at 2p and 2p+1 separately rather than once\n// is deliberate: it keeps this kernel correct if a caller ever supplies a non-repeated\n// table, and costs nothing (the value is in cache either way).\n//\n// \u{1F6A8} This is NOT rope_imrope.wgsl's pairing. See the header.\n\nstruct RopeP {\n  tokens   : u32,\n  heads    : u32,\n  head_dim : u32,\n  _p0 : u32,\n};\n\n@group(0) @binding(0) var<storage, read>       rp_x   : array<f32>;\n@group(0) @binding(1) var<storage, read>       rp_cos : array<f32>;\n@group(0) @binding(2) var<storage, read>       rp_sin : array<f32>;\n@group(0) @binding(3) var<storage, read_write> rp_y   : array<f32>;\n@group(0) @binding(4) var<uniform>             rpp    : RopeP;\n\n@compute @workgroup_size(64)\nfn rope_interleaved_main(@builtin(global_invocation_id) gid : vec3<u32>,\n                         @builtin(num_workgroups) nwg : vec3<u32>) {\n  // one thread per (token, head, PAIR)\n  let pairs = rpp.head_dim / 2u;\n  let total = rpp.tokens * rpp.heads * pairs;\n  let idx = gid.x + gid.y * nwg.x * 64u;\n  if (idx >= total) { return; }\n\n  let pair = idx % pairs;\n  let rem  = idx / pairs;\n  let head = rem % rpp.heads;\n  let tok  = rem / rpp.heads;\n\n  let o = (tok * rpp.heads + head) * rpp.head_dim + pair * 2u;\n  let p = tok * rpp.head_dim + pair * 2u;\n\n  let a = rp_x[o];\n  let b = rp_x[o + 1u];\n  rp_y[o]      = a * rp_cos[p]      - b * rp_sin[p];\n  rp_y[o + 1u] = b * rp_cos[p + 1u] + a * rp_sin[p + 1u];\n}\n\n// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 full (non-causal) multi-head attention \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// \u{1F6A8} NEITHER softmax_attn.wgsl NOR softmax_attn_batched.wgsl CAN SERVE THIS MODEL, and\n// the reason is not performance -- both are CAUSAL. An image transformer attends\n// bidirectionally: token 3 must see token 700. Running a causal kernel here masks most\n// of every row, renormalises what is left, and returns a perfectly well-formed tensor.\n// The image would simply be wrong.\n//\n// Two more differences make the reuse impossible rather than merely incorrect: both LLM\n// kernels read K/V from a 4-bit QUANTIZED KV CACHE (this model has no cache -- every\n// token is present at once, in f32), and both implement GQA (this model has 24 query\n// heads and 24 KV heads, so the mapping is the identity).\n//\n// FLASH-STYLE ONLINE SOFTMAX, one workgroup per (token, head). The running max/sum let\n// it stream the key axis in tiles with no O(n^2) score buffer, which matters at 768\n// tokens. Lanes split the key axis when computing scores, and split the HEAD DIM when\n// accumulating the output -- so the per-lane accumulator is a couple of registers rather\n// than a head_dim-wide array in workgroup memory, which at 64 lanes x 128 dims would be\n// 32 KB and exceed the guaranteed limit.\n//\n// Layout is [token][head][dim], matching `image/mmdit.ts attention` -- the reference\n// unflattens the projection to (heads, headDim) on the LAST axis. Reading it as\n// [head][token][dim] transposes silently and is shape-compatible.\n\nconst ATT_WG : u32 = 64u;\n\nstruct AttnFullP {\n  tokens   : u32,\n  heads    : u32,\n  head_dim : u32,\n  scale    : f32,      // 1/sqrt(head_dim)\n};\n\n@group(0) @binding(0) var<storage, read>       af_q : array<f32>;\n@group(0) @binding(1) var<storage, read>       af_k : array<f32>;\n@group(0) @binding(2) var<storage, read>       af_v : array<f32>;\n@group(0) @binding(3) var<storage, read_write> af_y : array<f32>;\n@group(0) @binding(4) var<uniform>             afp  : AttnFullP;\n\nvar<workgroup> af_score : array<f32, 64>;   // one score per lane per tile\nvar<workgroup> af_red   : array<f32, 64>;\nvar<workgroup> af_m     : f32;              // running max\nvar<workgroup> af_l     : f32;              // running sum of exp\n\n@compute @workgroup_size(64)\nfn attn_full_main(@builtin(workgroup_id) wg : vec3<u32>,\n                  @builtin(local_invocation_id) lid : vec3<u32>,\n                  @builtin(num_workgroups) nwg : vec3<u32>) {\n  let pair = wg.x + wg.y * nwg.x;             // (token, head), flattened\n  let total = afp.tokens * afp.heads;\n  if (pair >= total) { return; }\n  let head = pair % afp.heads;\n  let tok  = pair / afp.heads;\n  let hd   = afp.head_dim;\n  let lane = lid.x;\n\n  let qo = (tok * afp.heads + head) * hd;\n\n  if (lane == 0u) { af_m = -3.0e38; af_l = 0.0; }\n  workgroupBarrier();\n\n  // The output accumulator lives in registers: this lane owns dims lane, lane+64, ...\n  // ACC_MAX bounds head_dim at 64*8 = 512; this model uses 128.\n  const ACC_MAX : u32 = 8u;\n  var acc : array<f32, 8>;\n  for (var a : u32 = 0u; a < ACC_MAX; a = a + 1u) { acc[a] = 0.0; }\n\n  var tile : u32 = 0u;\n  loop {\n    if (tile >= afp.tokens) { break; }\n\n    // ---- scores for this tile: lane j handles key tile+lane ----\n    let j = tile + lane;\n    var s : f32 = -3.0e38;\n    if (j < afp.tokens) {\n      let ko = (j * afp.heads + head) * hd;\n      var d : f32 = 0.0;\n      for (var i : u32 = 0u; i < hd; i = i + 1u) { d = d + af_q[qo + i] * af_k[ko + i]; }\n      s = d * afp.scale;\n    }\n    af_score[lane] = s;\n    af_red[lane] = s;\n    workgroupBarrier();\n\n    // ---- tile max ----\n    var stride : u32 = ATT_WG >> 1u;\n    loop {\n      if (stride == 0u) { break; }\n      if (lane < stride) { af_red[lane] = max(af_red[lane], af_red[lane + stride]); }\n      workgroupBarrier();\n      stride = stride >> 1u;\n    }\n    let tile_max = af_red[0];\n    workgroupBarrier();\n\n    // ---- rescale the running state to the new max ----\n    let m_old = af_m;\n    let m_new = max(m_old, tile_max);\n    // exp(-inf - -inf) is NaN, so guard the very first tile where both are -3e38.\n    let rescale = select(exp(m_old - m_new), 0.0, m_old <= -3.0e38);\n    if (lane == 0u) { af_m = m_new; }\n    workgroupBarrier();\n\n    // ---- tile sum of exp ----\n    var e : f32 = 0.0;\n    if (j < afp.tokens) { e = exp(af_score[lane] - m_new); }\n    af_red[lane] = e;\n    af_score[lane] = e;     // reuse as the weight for the accumulation below\n    workgroupBarrier();\n    stride = ATT_WG >> 1u;\n    loop {\n      if (stride == 0u) { break; }\n      if (lane < stride) { af_red[lane] = af_red[lane] + af_red[lane + stride]; }\n      workgroupBarrier();\n      stride = stride >> 1u;\n    }\n    if (lane == 0u) { af_l = af_l * rescale + af_red[0]; }\n    workgroupBarrier();\n\n    // ---- accumulate weighted V over this tile, this lane's dims ----\n    var a : u32 = 0u;\n    loop {\n      let d = lane + a * ATT_WG;\n      if (d >= hd || a >= ACC_MAX) { break; }\n      var sum : f32 = 0.0;\n      for (var t : u32 = 0u; t < ATT_WG; t = t + 1u) {\n        let kj = tile + t;\n        if (kj < afp.tokens) {\n          let vo = (kj * afp.heads + head) * hd;\n          sum = sum + af_score[t] * af_v[vo + d];\n        }\n      }\n      acc[a] = acc[a] * rescale + sum;\n      a = a + 1u;\n    }\n    workgroupBarrier();\n\n    tile = tile + ATT_WG;\n  }\n\n  let inv_l = 1.0 / af_l;\n  var a2 : u32 = 0u;\n  loop {\n    let d = lane + a2 * ATT_WG;\n    if (d >= hd || a2 >= ACC_MAX) { break; }\n    af_y[qo + d] = acc[a2] * inv_l;\n    a2 = a2 + 1u;\n  }\n}\n\n// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 f32 matmul (x @ W^T) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// y[t, o] = sum_i x[t, i] * W[o, i]   -- torch [out, in] layout, NO bias.\n//\n// This model has no biases anywhere, and W is stored [out, in] row-major, which makes\n// the reduction contiguous in `i` for a fixed output. One workgroup per (token, output),\n// 64 lanes splitting the K axis.\n//\n// f32 on purpose for the FIRST correct dispatch. The shipped weights are Q2_0 and\n// q2_0_q8_0_matmul.wgsl already exists for them, but swapping it in changes the numerics\n// (2-bit weights, quantized activations) so it cannot be differentially compared against\n// the f32 CPU reference that proves this whole path. Correctness first, in the order this\n// codebase already learned: \"the transformer kernels earned their optimisations only\n// after a CPU differential proved them right.\"\n\nstruct MmP {\n  tokens : u32,\n  in_dim : u32,\n  out_dim : u32,\n  _p0 : u32,\n};\n\n@group(0) @binding(0) var<storage, read>       mm_x : array<f32>;\n@group(0) @binding(1) var<storage, read>       mm_w : array<f32>;\n@group(0) @binding(2) var<storage, read_write> mm_y : array<f32>;\n@group(0) @binding(3) var<uniform>             mmp  : MmP;\n\nvar<workgroup> mm_red : array<f32, 64>;\n\n@compute @workgroup_size(64)\nfn matmul_main(@builtin(workgroup_id) wg : vec3<u32>,\n               @builtin(local_invocation_id) lid : vec3<u32>,\n               @builtin(num_workgroups) nwg : vec3<u32>) {\n  let pair = wg.x + wg.y * nwg.x;\n  let total = mmp.tokens * mmp.out_dim;\n  if (pair >= total) { return; }\n  let o = pair % mmp.out_dim;\n  let t = pair / mmp.out_dim;\n  let lane = lid.x;\n\n  var s : f32 = 0.0;\n  var i : u32 = lane;\n  loop {\n    if (i >= mmp.in_dim) { break; }\n    s = s + mm_x[t * mmp.in_dim + i] * mm_w[o * mmp.in_dim + i];\n    i = i + 64u;\n  }\n  mm_red[lane] = s;\n  workgroupBarrier();\n  var stride : u32 = 32u;\n  loop {\n    if (stride == 0u) { break; }\n    if (lane < stride) { mm_red[lane] = mm_red[lane] + mm_red[lane + stride]; }\n    workgroupBarrier();\n    stride = stride >> 1u;\n  }\n  if (lane == 0u) { mm_y[pair] = mm_red[0]; }\n}\n\n// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 SwiGLU, fused \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// y[t, i] = silu(x[t, i]) * x[t, inner + i]   over a FUSED [tokens, 2*inner] input.\n//\n// swiglu.wgsl takes gate and up as two SEPARATE buffers. Flux2's `linear_in` emits both\n// halves in ONE tensor, and a WebGPU bind group cannot alias two overlapping views of the\n// same buffer as two read bindings -- so the split has to happen inside the kernel.\n// Gate is the FIRST half; swapping the halves is dimensionally identical and wrong.\n\nstruct SgP {\n  tokens : u32,\n  inner  : u32,\n  _p0 : u32, _p1 : u32,\n};\n\n@group(0) @binding(0) var<storage, read>       sg_x : array<f32>;\n@group(0) @binding(1) var<storage, read_write> sg_y : array<f32>;\n@group(0) @binding(2) var<uniform>             sgp  : SgP;\n\n@compute @workgroup_size(64)\nfn swiglu_fused_main(@builtin(global_invocation_id) gid : vec3<u32>,\n                     @builtin(num_workgroups) nwg : vec3<u32>) {\n  let total = sgp.tokens * sgp.inner;\n  let idx = gid.x + gid.y * nwg.x * 64u;\n  if (idx >= total) { return; }\n  let t = idx / sgp.inner;\n  let i = idx % sgp.inner;\n  let base = t * sgp.inner * 2u;\n  let g = sg_x[base + i];\n  sg_y[idx] = (g / (1.0 + exp(-g))) * sg_x[base + sgp.inner + i];\n}\n\n// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 per-head RMSNorm (QK-norm) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// y[t, h, i] = x[t, h, i] / sqrt(mean_i(x^2) + eps) * weight[i]\n//\n// NOT rmsnorm.wgsl, which normalises a whole row against a row-wide weight. This\n// normalises EACH HEAD independently over head_dim, with a [head_dim] weight shared by\n// every head \u2014 that is what `attn.norm_q` / `attn.norm_k` are in Flux2, and applying the\n// row-wide kernel would mix all 24 heads into one statistic.\n//\n// Applied BEFORE RoPE (convention 4). One workgroup per (token, head).\n\nstruct RmsHP {\n  tokens   : u32,\n  heads    : u32,\n  head_dim : u32,\n  eps      : f32,\n};\n\n@group(0) @binding(0) var<storage, read>       rh_x : array<f32>;\n@group(0) @binding(1) var<storage, read>       rh_w : array<f32>;\n@group(0) @binding(2) var<storage, read_write> rh_y : array<f32>;\n@group(0) @binding(3) var<uniform>             rhp  : RmsHP;\n\nvar<workgroup> rh_red : array<f32, 64>;\n\n@compute @workgroup_size(64)\nfn rmsnorm_heads_main(@builtin(workgroup_id) wg : vec3<u32>,\n                      @builtin(local_invocation_id) lid : vec3<u32>,\n                      @builtin(num_workgroups) nwg : vec3<u32>) {\n  let pair = wg.x + wg.y * nwg.x;\n  if (pair >= rhp.tokens * rhp.heads) { return; }\n  let hd = rhp.head_dim;\n  let base = pair * hd;          // [token][head][dim] is contiguous per (token, head)\n  let lane = lid.x;\n\n  var s : f32 = 0.0;\n  var i : u32 = lane;\n  loop {\n    if (i >= hd) { break; }\n    let v = rh_x[base + i];\n    s = s + v * v;\n    i = i + 64u;\n  }\n  rh_red[lane] = s;\n  workgroupBarrier();\n  var stride : u32 = 32u;\n  loop {\n    if (stride == 0u) { break; }\n    if (lane < stride) { rh_red[lane] = rh_red[lane] + rh_red[lane + stride]; }\n    workgroupBarrier();\n    stride = stride >> 1u;\n  }\n  let inv = inverseSqrt(rh_red[0] / f32(hd) + rhp.eps);\n  workgroupBarrier();\n\n  i = lane;\n  loop {\n    if (i >= hd) { break; }\n    rh_y[base + i] = rh_x[base + i] * inv * rh_w[i];\n    i = i + 64u;\n  }\n}\n\n// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 strided copy (gather/scatter) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// dst[t*dst_stride + dst_off + j] = src[t*src_stride + src_off + j],  j < width\n//\n// \u{1F6A8} THIS EXISTS BECAUSE copyBufferToBuffer CANNOT BE RECORDED INSIDE AN OPEN COMPUTE\n// PASS. The first runtime queued its slices, concatenations and de-interleaves as\n// buffer copies and replayed them after `pass.end()` -- so every dispatch that CONSUMED\n// one of those buffers read it before it had been written. The kernels were all\n// individually correct on hardware and the assembled model was still wrong, diverging\n// at the first double block.\n//\n// Splitting the compute pass at each copy would also be correct, but the single-stream\n// blocks de-interleave a fused projection per token: at 768 tokens that is ~15,000 pass\n// boundaries per forward. As a kernel it is one dispatch and the whole graph stays in\n// one pass.\n//\n// One thread per (t, j). Every reshape in the MMDiT graph -- token concat, token slice,\n// column range, column join -- is this op with different strides.\n\nstruct CopyP {\n  tokens     : u32,\n  width      : u32,\n  src_stride : u32,\n  src_off    : u32,\n  dst_stride : u32,\n  dst_off    : u32,\n  _p0 : u32, _p1 : u32,\n};\n\n@group(0) @binding(0) var<storage, read>       cp_src : array<f32>;\n@group(0) @binding(1) var<storage, read_write> cp_dst : array<f32>;\n@group(0) @binding(2) var<uniform>             cpp    : CopyP;\n\n@compute @workgroup_size(64)\nfn copy_strided_main(@builtin(global_invocation_id) gid : vec3<u32>,\n                     @builtin(num_workgroups) nwg : vec3<u32>) {\n  let total = cpp.tokens * cpp.width;\n  let idx = gid.x + gid.y * nwg.x * 64u;\n  if (idx >= total) { return; }\n  let t = idx / cpp.width;\n  let j = idx % cpp.width;\n  cp_dst[t * cpp.dst_stride + cpp.dst_off + j] =\n    cp_src[t * cpp.src_stride + cpp.src_off + j];\n}\n";
var VAE_OPS_WGSL = "// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\n// \xA9 2026 Aitherium, LLC. Original work.\n// Original Aitherium WebGPU implementation.\n//\n// THE THREE OPS THE VAE DECODER NEEDS AND THE TRANSFORMER DOES NOT.\n//\n// In-browser image generation was written off as needing a foreign kernel family. It does\n// not. `:8798` serves FLUX.2 Klein 4B, and the giveaway is in its own tensor names \u2014\n// `transformer_blocks.0.attn.to_q` \u2014 MMDiT is a diffusion TRANSFORMER: attention + MLP over\n// latent patches, which the existing kernels already do. Its text encoder is Qwen3-4B, the\n// same architecture family as the Bonsai text models that already run in a visitor's browser.\n//\n// What genuinely has no equivalent is the VAE DECODER, and only three ops of it. From the\n// shipped model's own vae/config.json (AutoencoderKLFlux2):\n//\n//     block_out_channels : [128, 256, 512, 512]\n//     up_block_types     : 4 x UpDecoderBlock2D\n//     layers_per_block   : 2\n//     latent_channels    : 32\n//     norm_num_groups    : 32\n//     act_fn             : silu\n//\n// so the decode graph is: conv_in -> mid(resnet + attn) -> 4 x (2 resnets + 2x upsample)\n// -> GroupNorm -> SiLU -> conv_out(3ch). Attention and SiLU already exist. These are the rest.\n//\n// LAYOUT: NCHW, f32, batch 1 \u2014 one image at a time is what a browser does, and NCHW keeps a\n// channel's plane contiguous, which is what makes GroupNorm's reduction a simple range.\n//\n// PERFORMANCE NOTE, learned the expensive way on softmax_attn_batched: a kernel written as\n// one-thread-per-output looks fine and silently becomes the bottleneck when the tensor grows.\n// The last up block runs at full output resolution, so at 1024x1024x128 that is 134M outputs.\n// conv2d here is one thread per OUTPUT ELEMENT with the reduction inside it \u2014 correct, and\n// deliberately the simple version first, because the transformer kernels earned their\n// optimisations only after a CPU differential proved them right. Optimise after it is correct\n// and after a measurement says which part is slow, not before.\n\nstruct ConvP {\n  in_c   : u32,\n  out_c  : u32,\n  h      : u32,   // input height\n  w      : u32,   // input width\n  k      : u32,   // square kernel size (1 or 3 here)\n  pad    : u32,\n  stride : u32,\n  _p0    : u32,\n};\n\n@group(0) @binding(0) var<storage, read>       x       : array<f32>;  // [in_c*h*w]\n@group(0) @binding(1) var<storage, read>       weight  : array<f32>;  // [out_c*in_c*k*k]\n@group(0) @binding(2) var<storage, read>       bias    : array<f32>;  // [out_c]\n@group(0) @binding(3) var<storage, read_write> y       : array<f32>;  // [out_c*oh*ow]\n@group(0) @binding(4) var<uniform>             p       : ConvP;\n\nfn out_h() -> u32 { return (p.h + 2u * p.pad - p.k) / p.stride + 1u; }\nfn out_w() -> u32 { return (p.w + 2u * p.pad - p.k) / p.stride + 1u; }\n\n/**\n * 2-D convolution, NCHW, one thread per output element.\n *\n * Zero padding is done by SKIPPING out-of-range taps rather than by materialising a padded\n * input. Materialising would allocate another full tensor per layer \u2014 at decoder resolutions\n * that is hundreds of megabytes of pure copy, on a device that is also holding a language\n * model.\n */\n@compute @workgroup_size(64)\nfn conv2d_main(@builtin(global_invocation_id) gid : vec3<u32>,\n               @builtin(num_workgroups) nwg : vec3<u32>) {\n  let oh = out_h();\n  let ow = out_w();\n  let total = p.out_c * oh * ow;\n  let idx = gid.x + gid.y * nwg.x * 64u;\n  if (idx >= total) { return; }\n\n  let ox = idx % ow;\n  let oy = (idx / ow) % oh;\n  let oc = idx / (ow * oh);\n\n  var acc : f32 = bias[oc];\n  for (var ic : u32 = 0u; ic < p.in_c; ic = ic + 1u) {\n    let x_plane = ic * p.h * p.w;\n    let w_base = ((oc * p.in_c) + ic) * p.k * p.k;\n    for (var ky : u32 = 0u; ky < p.k; ky = ky + 1u) {\n      // Signed arithmetic: with pad=1 the first row's taps land at -1, and doing this in\n      // u32 wraps to ~4 billion and reads far out of bounds. WebGPU's robust access would\n      // return 0 there, which LOOKS like correct zero-padding and is not \u2014 it silently\n      // drops the real taps too on the opposite edge.\n      let iy = i32(oy * p.stride) + i32(ky) - i32(p.pad);\n      if (iy < 0 || iy >= i32(p.h)) { continue; }\n      for (var kx : u32 = 0u; kx < p.k; kx = kx + 1u) {\n        let ix = i32(ox * p.stride) + i32(kx) - i32(p.pad);\n        if (ix < 0 || ix >= i32(p.w)) { continue; }\n        acc = acc + x[x_plane + u32(iy) * p.w + u32(ix)] * weight[w_base + ky * p.k + kx];\n      }\n    }\n  }\n  y[idx] = acc;\n}\n\nstruct GroupNormP {\n  c       : u32,\n  h       : u32,\n  w       : u32,\n  groups  : u32,\n  eps     : f32,\n  _p0 : u32, _p1 : u32, _p2 : u32,\n};\n\n@group(0) @binding(0) var<storage, read>       gx      : array<f32>;\n@group(0) @binding(1) var<storage, read>       gamma   : array<f32>;  // [c]\n@group(0) @binding(2) var<storage, read>       beta    : array<f32>;  // [c]\n@group(0) @binding(3) var<storage, read_write> gy      : array<f32>;\n@group(0) @binding(4) var<uniform>             gp      : GroupNormP;\n\n/**\n * GroupNorm \u2014 one WORKGROUP per group, cooperating over that group's whole slab.\n *\n * NOT one thread per group. A group at decoder sizes is (c/groups) x h x w elements \u2014 with\n * 128 channels, 32 groups and a 512x512 plane that is over a million values, and a single\n * thread walking it is the same one-lane mistake that made attention 8x slower than it had\n * to be. The mean and variance are a parallel reduction; the normalise pass is grid-strided.\n *\n * Two passes over the slab (mean, then variance) rather than the sum/sum-of-squares trick:\n * at f32 with a million-element reduction the one-pass form loses precision exactly where\n * the variance is small, which is where a VAE's activations live.\n */\nvar<workgroup> red_sum : array<f32, 256>;\n\n@compute @workgroup_size(256)\nfn groupnorm_main(@builtin(workgroup_id) wg : vec3<u32>,\n                  @builtin(local_invocation_id) lid : vec3<u32>) {\n  let g = wg.x;\n  if (g >= gp.groups) { return; }        // uniform across the workgroup \u2014 safe with barriers\n\n  let cpg = gp.c / gp.groups;            // channels per group\n  let plane = gp.h * gp.w;\n  let slab = cpg * plane;                // elements this group owns\n  let base = g * slab;\n  let tid = lid.x;\n\n  // ---- mean ----\n  var s : f32 = 0.0;\n  var i : u32 = tid;\n  loop {\n    if (i >= slab) { break; }\n    s = s + gx[base + i];\n    i = i + 256u;\n  }\n  red_sum[tid] = s;\n  workgroupBarrier();\n  var stride : u32 = 128u;\n  loop {\n    if (stride == 0u) { break; }\n    if (tid < stride) { red_sum[tid] = red_sum[tid] + red_sum[tid + stride]; }\n    workgroupBarrier();\n    stride = stride / 2u;\n  }\n  let mean = red_sum[0] / f32(slab);\n  workgroupBarrier();\n\n  // ---- variance ----\n  var v : f32 = 0.0;\n  i = tid;\n  loop {\n    if (i >= slab) { break; }\n    let d = gx[base + i] - mean;\n    v = v + d * d;\n    i = i + 256u;\n  }\n  red_sum[tid] = v;\n  workgroupBarrier();\n  stride = 128u;\n  loop {\n    if (stride == 0u) { break; }\n    if (tid < stride) { red_sum[tid] = red_sum[tid] + red_sum[tid + stride]; }\n    workgroupBarrier();\n    stride = stride / 2u;\n  }\n  let inv_std = 1.0 / sqrt(red_sum[0] / f32(slab) + gp.eps);\n  workgroupBarrier();\n\n  // ---- normalise + per-CHANNEL affine ----\n  // gamma/beta are indexed by absolute channel, not by group: a group spans cpg channels and\n  // each has its own scale. Using the group index here is an easy and completely silent\n  // error \u2014 the image comes out plausible and wrong.\n  i = tid;\n  loop {\n    if (i >= slab) { break; }\n    let ch = g * cpg + (i / plane);\n    gy[base + i] = (gx[base + i] - mean) * inv_std * gamma[ch] + beta[ch];\n    i = i + 256u;\n  }\n}\n\nstruct UpP {\n  c : u32,\n  h : u32,\n  w : u32,\n  scale : u32,\n};\n\n@group(0) @binding(0) var<storage, read>       ux : array<f32>;\n@group(0) @binding(1) var<storage, read_write> uy : array<f32>;\n@group(0) @binding(2) var<uniform>             up : UpP;\n\n/**\n * Nearest-neighbour upsample by an integer factor \u2014 what UpDecoderBlock2D does before its\n * convolution (diffusers' Upsample2D default is nearest, and the conv that follows is what\n * turns the blockiness into detail). Bilinear here would be a different model.\n */\n@compute @workgroup_size(64)\nfn upsample_nearest_main(@builtin(global_invocation_id) gid : vec3<u32>,\n                         @builtin(num_workgroups) nwg : vec3<u32>) {\n  let oh = up.h * up.scale;\n  let ow = up.w * up.scale;\n  let total = up.c * oh * ow;\n  let idx = gid.x + gid.y * nwg.x * 64u;\n  if (idx >= total) { return; }\n\n  let ox = idx % ow;\n  let oy = (idx / ow) % oh;\n  let ch = idx / (ow * oh);\n\n  let sx = ox / up.scale;\n  let sy = oy / up.scale;\n  uy[idx] = ux[ch * up.h * up.w + sy * up.w + sx];\n}\n";

// AitherOS/apps/AitherVeil/src/lib/bonsai-webgpu/webml-image.entry.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function seededNormal(seed, n) {
  const rnd = mulberry32(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.max(rnd(), 1e-12);
    const u2 = rnd();
    out[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) out[i + 1] = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
  }
  return out;
}
var CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 4294967295;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ c >>> 8;
  return (c ^ 4294967295) >>> 0;
}
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
async function encodePng(rgb, w, h, channels = 3) {
  const bytesPerRow = w * channels + 1;
  const raw = new Uint8Array(bytesPerRow * h);
  for (let y = 0; y < h; y++) {
    const rowStart = y * bytesPerRow;
    raw[rowStart] = 0;
    for (let x = 0; x < w * channels; x++) {
      const v = rgb[y * w * channels + x];
      raw[rowStart + 1 + x] = Math.max(0, Math.min(255, Math.round((v + 1) * 127.5)));
    }
  }
  const cs = new CompressionStream("deflate");
  const compressed = await new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(raw);
        controller.close();
      }
    }).pipeThrough(cs)
  ).arrayBuffer();
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  const parts = [];
  const head = new Uint8Array(8);
  head.set([137, 80, 78, 71, 13, 10, 26, 10]);
  parts.push(head);
  parts.push(pngChunk("IHDR", ihdr));
  parts.push(pngChunk("IDAT", new Uint8Array(compressed)));
  parts.push(pngChunk("IEND", new Uint8Array(0)));
  return new Blob(parts, { type: "image/png" });
}
async function readSafetensorsIndex(url, fetchRange) {
  const lenBytes = await fetchRange(0, 7);
  const len = Number(new DataView(lenBytes.buffer, lenBytes.byteOffset, 8).getBigUint64(0, true));
  const headerBytes = await fetchRange(8, 8 + len - 1);
  const header = JSON.parse(new TextDecoder().decode(headerBytes));
  const out = /* @__PURE__ */ new Map();
  for (const [name, info] of Object.entries(header)) {
    if (name === "__metadata__") continue;
    const i = info;
    out.set(name, { dtype: i.dtype, shape: i.shape, start: 8 + len + i.data_offsets[0], length: i.data_offsets[1] - i.data_offsets[0] });
  }
  return out;
}
function rangeRead(url, fetchRange) {
  return (start, length) => fetchRange(start, start + length - 1);
}
async function loadMmditWeights(url, fetchRange) {
  const reader = new RangeReader({ url, fetchRange });
  const parsed = await parseGguf(reader);
  const tensors = new Map(parsed.tensors.map((t) => [t.name, t]));
  return ggufWeightSource({
    read: rangeRead(url, fetchRange),
    tensors,
    tensorDataBase: parsed.tensorDataBase
  });
}
function vaeOpTable(tensors) {
  function tensor(key) {
    const hit = tensors.get(key);
    if (hit) return hit;
    throw new Error(`vae weights: no tensor '${key}' \u2014 the plan-name\u2192checkpoint mapping is pinned by the spike verdict; see the bundle header`);
  }
  function keyFor(planName, kind) {
    const base = planName.replace(/[./]/g, ".");
    const candidates = [];
    const add = (k) => {
      candidates.push(kind === "weight" ? k : k.replace(/.weight$/, "") + ".bias");
    };
    add(base);
    add(`decoder.${base}`);
    add(`decoder.${base}.weight`);
    const resnet = /^mid.resnet.(d+).(conv|norm)$/.exec(base);
    if (resnet) {
      const [, n, kind2] = resnet;
      const root = `decoder.mid_block.resnets.${n}`;
      add(kind2 === "conv" ? `${root}.conv1` : `${root}.norm1`);
      add(kind2 === "conv" ? `${root}.conv2` : `${root}.norm2`);
    }
    const upResnet = /^up.(d+).resnet.(d+).(conv|norm)$/.exec(base);
    if (upResnet) {
      const [, b, l, kind2] = upResnet;
      const root = `decoder.up_blocks.${b}.resnets.${l}`;
      add(kind2 === "conv" ? `${root}.conv1` : `${root}.norm1`);
      add(kind2 === "conv" ? `${root}.conv2` : `${root}.norm2`);
    }
    const upSample = /^up.(d+).upsample.conv$/.exec(base);
    if (upSample) add(`decoder.up_blocks.${upSample[1]}.upsamplers.0.conv`);
    for (const c of candidates) if (index.has(c)) return c;
    throw new Error(
      `vae weights: no tensor for plan op '${planName}' (${kind}) \u2014 tried: ${candidates.join(", ")}`
    );
  }
  return {
    conv: (x, op, shape) => {
      const c = op.conv;
      const wKey = keyFor(op.name, "weight");
      const bKey = keyFor(op.name, "bias");
      const spec = { inC: c.inC, outC: c.outC, h: shape[1], w: shape[2], k: c.k, pad: c.pad, stride: c.stride };
      return conv2dRef(x, tensor(wKey), tensor(bKey), spec);
    },
    groupnorm: (x, op, shape) => {
      const wKey = keyFor(op.name, "weight");
      const bKey = keyFor(op.name, "bias");
      return groupNormRef(x, tensor(wKey), tensor(bKey), shape[0], shape[1], shape[2], op.groups ?? 32);
    },
    silu: (x) => siluRef(x),
    upsample: (x, op, shape) => upsampleNearestRef(x, shape[0], shape[1], shape[2], op.scale ?? 2)
  };
}
function halfToF32(h) {
  const sign = h & 32768 ? -1 : 1;
  const exp = h >> 10 & 31;
  const mant = h & 1023;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 31) return mant ? Number.NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}
var encoderReady = false;
async function encodePrompt(prompt, nImg, seed) {
  if (!encoderReady) {
    throw new Error(
      'bonsai-image: on-device generation is pending the encoder spike (R1) \u2014 the qwen3-4b-encoder dequant/forward and img_ids construction are not wired yet. Route device:"auto" through the hosted tier until the spike verdict lands.'
    );
  }
  void prompt;
  void nImg;
  void seed;
  throw new Error("bonsai-image: encodePrompt is the spike deliverable \u2014 not implemented");
}
async function createBonsaiImageRuntime(init) {
  const fetchRange = init.fetchRange ?? httpRangeFetcher(init.weightsUrl);
  const progress = (phase, percent, detail) => {
    init.onProgress?.({ phase, percent, detail });
  };
  progress("device", 5);
  const gpu = navigator.gpu;
  if (!gpu) throw new Error("WebGPU not available on this browser");
  let adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) adapter = await gpu.requestAdapter({ forceFallbackAdapter: true }).catch(() => null);
  if (!adapter) throw new Error("No WebGPU adapter found");
  const limits = adapter.limits ?? {};
  const requiredLimits = {};
  for (const key of ["maxStorageBufferBindingSize", "maxBufferSize", "maxComputeWorkgroupStorageSize"]) {
    const v = limits[key];
    if (typeof v === "number" && v > 0) requiredLimits[key] = v;
  }
  const device = await adapter.requestDevice({ requiredLimits });
  progress("compile", 10);
  const runtime = await createImageRuntime(device, IMAGE_OPS_WGSL);
  progress("weights", 15);
  const weightFn = await loadMmditWeights(init.weightsUrl, fetchRange);
  let vaeTable = null;
  if (init.vaeWeightsUrl) {
    progress("weights", 20, "vae decoder");
    const vaeIndex = await readSafetensorsIndex(init.vaeWeightsUrl, fetchRange);
    const preloaded = /* @__PURE__ */ new Map();
    for (const [name, t] of vaeIndex) {
      const raw = await fetchRange(t.start, t.start + t.length - 1);
      if (t.dtype === "F32") {
        preloaded.set(
          name,
          new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + t.length))
        );
      } else if (t.dtype === "F16") {
        const out = new Float32Array(t.length / 2);
        const dv = new DataView(raw.buffer, raw.byteOffset, t.length);
        for (let i = 0; i < out.length; i++) out[i] = halfToF32(dv.getUint16(i * 2, true));
        preloaded.set(name, out);
      } else {
        throw new Error(`vae weights: '${name}' has unsupported dtype ${t.dtype}`);
      }
    }
    vaeTable = vaeOpTable(preloaded);
  }
  let disposed = false;
  const cfg = BONSAI_IMAGE_4B;
  async function generate(opts) {
    if (disposed) throw new Error("bonsai-image runtime disposed");
    const width = Math.round(opts.width ?? 256);
    const height = Math.round(opts.height ?? 256);
    if (width % 16 !== 0 || height % 16 !== 0) {
      throw new Error(`bonsai-image: ${width}x${height} is not a multiple of 16 (latent grid must divide by 16)`);
    }
    if (width > 1024 || height > 1024) {
      throw new Error("bonsai-image: sizes above 1024px are not supported on-device");
    }
    const steps = Math.max(1, Math.min(32, Math.round(opts.steps ?? 4)));
    const seed = Math.floor(opts.seed ?? Math.random() * 2 ** 31) >>> 0;
    const latentH = height / 16;
    const latentW = width / 16;
    const nImg = latentH * latentW + 1;
    const enc = await encodePrompt(opts.prompt, nImg, seed);
    const mu = muForSeqLen(nImg + enc.nTxt);
    const ts = timesteps(steps, mu);
    let x = seededNormal(seed, nImg * cfg.inChannels);
    for (let k = 0; k < steps; k++) {
      const input = {
        hiddenStates: x,
        encoderHiddenStates: enc.encoderHiddenStates,
        imgIds: enc.imgIds,
        txtIds: enc.txtIds,
        timestep: ts[k],
        nImg,
        nTxt: enc.nTxt
      };
      const v = await runtime.forward(input, cfg, weightFn);
      x = eulerStep(x, v, ts[k], k + 1 < steps ? ts[k + 1] : 0);
      progress("denoise", Math.round((k + 1) / steps * 60), `step ${k + 1}/${steps}`);
      await new Promise((r) => setTimeout(r, 0));
    }
    progress("vae", 85);
    if (!vaeTable) throw new Error("bonsai-image: VAE weights were not provided (vaeWeightsUrl)");
    const vaeCfg = { ...FLUX2_VAE, latentSize: latentH };
    const latent = x.subarray(0, FLUX2_VAE.latentChannels * latentH * latentW);
    const rgb = decodeWithOps(latent, vaeTable, vaeCfg);
    progress("encode", 95);
    const native = await encodePng(rgb, latentW * 8, latentH * 8);
    if (width === latentW * 8 && height === latentH * 8) return native;
    const bmp = await createImageBitmap(native);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0, width, height);
    bmp.close();
    const up = await new Promise((r) => canvas.toBlob(r, "image/png"));
    if (!up) throw new Error("bonsai-image: canvas upscale produced no blob");
    return up;
  }
  return {
    ready: true,
    generate,
    dispose: () => {
      disposed = true;
      runtime.destroy();
      device.destroy();
    }
  };
}
export {
  IMAGE_OPS_WGSL,
  VAE_OPS_WGSL,
  createBonsaiImageRuntime,
  encoderReady
};
