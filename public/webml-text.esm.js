/* webmcp-studio-runtime webmcp-studio-runtime-v1 — built 2026-08-27T05:28:12.858Z by AitherOS/dev/tools/build_webml_cdn.mjs */
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// AitherOS/apps/packages/awkit/src/webml/bonsai/gguf/reader.ts
function isRetriableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}
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
function mirroredRangeFetcher(urls) {
  const list = urls.filter(Boolean);
  if (list.length === 0) throw new Error("bonsai-gguf: mirroredRangeFetcher needs at least one URL");
  if (list.length === 1) return httpRangeFetcher(list[0]);
  const fetchers = list.map((u) => httpRangeFetcher(u));
  return async (start, endInclusive) => {
    const failures = [];
    for (let i = 0; i < fetchers.length; i++) {
      try {
        return await fetchers[i](start, endInclusive);
      } catch (e) {
        failures.push(`${list[i]}: ${e instanceof Error ? e.message : String(e)}`);
        if (i + 1 < fetchers.length) {
          console.warn(`[bonsai-gguf] mirror ${i + 1}/${fetchers.length} failed, trying next`);
        }
      }
    }
    throw new Error(
      `bonsai-gguf: all ${fetchers.length} mirrors failed for range ${start}-${endInclusive}:
` + failures.map((f, i) => `  [${i + 1}] ${f}`).join("\n")
    );
  };
}
var MAX_RANGE_ATTEMPTS, sleep, RANGE_STALL_TIMEOUT_MS, RangeReader;
var init_reader = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/gguf/reader.ts"() {
    "use strict";
    MAX_RANGE_ATTEMPTS = 3;
    sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    RANGE_STALL_TIMEOUT_MS = 2e4;
    RangeReader = class {
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
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/gguf/idb-cache.ts
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => {
      const v = req.result;
      if (v === void 0) resolve(void 0);
      else resolve(v instanceof Uint8Array ? v : new Uint8Array(v));
    };
    req.onerror = () => reject(req.error);
  });
}
function idbPut(db, key, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const copy = data.slice();
    tx.objectStore(STORE).put(copy.buffer, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function cachedRangeFetcher(url, inner, onCached) {
  let dbPromise = null;
  const getDb = () => {
    if (!dbPromise) {
      try {
        void navigator.storage?.persist?.();
      } catch {
      }
      dbPromise = openDb().catch(() => null);
    }
    return dbPromise;
  };
  return async (start, endInclusive) => {
    const key = `${url}#${start}-${endInclusive}`;
    const db = await getDb();
    if (db) {
      try {
        const hit = await idbGet(db, key);
        if (hit) {
          onCached?.({ bytes: hit.byteLength, fromCache: true });
          return hit;
        }
      } catch {
      }
    }
    const data = await inner(start, endInclusive);
    onCached?.({ bytes: data.byteLength, fromCache: false });
    if (db) void idbPut(db, key, data).catch(() => {
    });
    return data;
  };
}
var DB_NAME, STORE, DB_VERSION;
var init_idb_cache = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/gguf/idb-cache.ts"() {
    "use strict";
    DB_NAME = "bonsai-weights";
    STORE = "ranges";
    DB_VERSION = 1;
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/gguf/types.ts
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
var TYPE_TRAITS, QK1_0, QK2_0, Q1_0_BYTES, Q2_0_BYTES;
var init_types = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/gguf/types.ts"() {
    "use strict";
    TYPE_TRAITS = {
      [0 /* F32 */]: { blockSize: 1, typeSize: 4, name: "F32" },
      [1 /* F16 */]: { blockSize: 1, typeSize: 2, name: "F16" },
      [8 /* Q8_0 */]: { blockSize: 32, typeSize: 34, name: "Q8_0" },
      [41 /* Q1_0 */]: { blockSize: 128, typeSize: 18, name: "Q1_0" },
      [42 /* Q2_0 */]: { blockSize: 128, typeSize: 34, name: "Q2_0" }
    };
    QK1_0 = 128;
    QK2_0 = 128;
    Q1_0_BYTES = 18;
    Q2_0_BYTES = 34;
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/gguf/parser.ts
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
var GGUF_MAGIC;
var init_parser = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/gguf/parser.ts"() {
    "use strict";
    init_types();
    GGUF_MAGIC = 1179993927;
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/gguf/metadata.ts
var GgufMetadata;
var init_metadata = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/gguf/metadata.ts"() {
    "use strict";
    GgufMetadata = class {
      constructor(kv) {
        this.kv = kv;
      }
      raw(key) {
        return this.kv.get(key);
      }
      str(key, fallback) {
        const v = this.kv.get(key);
        if (typeof v === "string") return v;
        if (fallback !== void 0) return fallback;
        throw new Error(`bonsai-gguf: missing string key '${key}'`);
      }
      num(key, fallback) {
        const v = this.kv.get(key);
        if (typeof v === "number") return v;
        if (typeof v === "bigint") return Number(v);
        if (fallback !== void 0) return fallback;
        throw new Error(`bonsai-gguf: missing numeric key '${key}'`);
      }
      numOpt(key) {
        const v = this.kv.get(key);
        if (typeof v === "number") return v;
        if (typeof v === "bigint") return Number(v);
        return void 0;
      }
      strArray(key) {
        const v = this.kv.get(key);
        if (Array.isArray(v)) return v;
        throw new Error(`bonsai-gguf: missing string-array key '${key}'`);
      }
      numArray(key) {
        const v = this.kv.get(key);
        if (Array.isArray(v)) return v.map(Number);
        throw new Error(`bonsai-gguf: missing numeric-array key '${key}'`);
      }
      /** general.architecture — expected "qwen35" for Bonsai-27B. Maps "dspark" → "qwen35". */
      get arch() {
        const rawArch = this.str("general.architecture");
        return rawArch === "dspark" ? "qwen35" : rawArch;
      }
      a(suffix) {
        return `${this.arch}.${suffix}`;
      }
      /** Resolve every qwen35.* dimension the runtime needs. */
      resolveArchConfig() {
        const arch = this.arch;
        return {
          arch,
          contextLength: this.num(this.a("context_length")),
          embeddingLength: this.num(this.a("embedding_length")),
          blockCount: this.num(this.a("block_count")),
          feedForwardLength: this.num(this.a("feed_forward_length")),
          headCount: this.num(this.a("attention.head_count")),
          headCountKv: this.num(this.a("attention.head_count_kv")),
          // EXPLICIT per-head dims. This arch (qwen35, DeltaNet+full-attn hybrid)
          // sets head_dim independently of embedding_length/head_count — e.g.
          // 5120/24 = 213.33 is NOT the head_dim; attention.key_length is. The
          // fork reads n_embd_head_k from this key (llama-model.cpp), falling back
          // to embedding_length/head_count only when the key is absent.
          keyLength: this.numOpt(this.a("attention.key_length")),
          valueLength: this.numOpt(this.a("attention.value_length")),
          rmsEps: this.num(this.a("attention.layer_norm_rms_epsilon"), 1e-6),
          ropeDimensionCount: this.numOpt(this.a("rope.dimension_count")),
          ropeDimensionSections: (() => {
            const v = this.kv.get(this.a("rope.dimension_sections"));
            return Array.isArray(v) ? v.map(Number) : [];
          })(),
          ropeFreqBase: this.numOpt(this.a("rope.freq_base")) ?? 1e4,
          ropeScalingType: (() => {
            const v = this.kv.get(this.a("rope.scaling.type"));
            return typeof v === "string" ? v : "none";
          })(),
          ropeScalingFactor: this.numOpt(this.a("rope.scaling.factor")),
          // SSM / DeltaNet dims (present on the linear-attention layers).
          // Bonsai-27B (qwen35, Qwen3-Next SSM path): inner_size=6144 (v width), state_size=128
          // (per-head dim, k AND v), group_count=16 (num_k/q heads), time_step_rank=48 (num_v heads),
          // conv_kernel=4. The DeltaNet in-proj (attn_qkv) width is q(2048)+k(2048)+v(6144)=10240.
          ssmConvKernel: this.numOpt(this.a("ssm.conv_kernel")),
          ssmInnerSize: this.numOpt(this.a("ssm.inner_size")),
          ssmStateSize: this.numOpt(this.a("ssm.state_size")),
          ssmGroupCount: this.numOpt(this.a("ssm.group_count")),
          ssmTimeStepRank: this.numOpt(this.a("ssm.time_step_rank")),
          // Hybrid schedule: every `full_attention_interval`-th layer is full attention, the
          // rest are DeltaNet. Derived per-layer from tensor presence too (config.ts), but the
          // KV is kept for cross-checking.
          fullAttentionInterval: this.numOpt(this.a("full_attention_interval"))
        };
      }
      /** Tokenizer KV block (lives inside the GGUF — not fetchable as raw text). */
      resolveTokenizer() {
        return {
          model: this.str("tokenizer.ggml.model", "gpt2"),
          tokens: this.strArray("tokenizer.ggml.tokens"),
          merges: (() => {
            const v = this.kv.get("tokenizer.ggml.merges");
            return Array.isArray(v) ? v : [];
          })(),
          tokenType: (() => {
            const v = this.kv.get("tokenizer.ggml.token_type");
            return Array.isArray(v) ? v.map(Number) : [];
          })(),
          bosTokenId: this.numOpt("tokenizer.ggml.bos_token_id"),
          eosTokenId: this.numOpt("tokenizer.ggml.eos_token_id")
        };
      }
    };
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/tensors/registry.ts
var TensorRegistry;
var init_registry = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/tensors/registry.ts"() {
    "use strict";
    TensorRegistry = class {
      constructor(parsed) {
        this.byName = /* @__PURE__ */ new Map();
        this.ordered = [];
        this.tensorDataBase = parsed.tensorDataBase;
        for (const info of parsed.tensors) {
          const e = this.toEntry(info, parsed.tensorDataBase);
          this.byName.set(e.name, e);
          this.ordered.push(e);
        }
        this.ordered.sort((a, b) => a.absStart - b.absStart);
      }
      toEntry(info, base) {
        const absStart = base + info.relOffset;
        return {
          name: info.name,
          type: info.type,
          dims: info.dims,
          absStart,
          nBytes: info.nBytes,
          absEnd: absStart + info.nBytes
        };
      }
      get(name) {
        const e = this.byName.get(name);
        if (!e) throw new Error(`bonsai-tensors: no tensor named '${name}'`);
        return e;
      }
      has(name) {
        return this.byName.has(name);
      }
      /** All tensors whose name starts with `prefix` (e.g. "blk.0."). */
      withPrefix(prefix) {
        return this.ordered.filter((e) => e.name.startsWith(prefix));
      }
      /**
       * Coalesce a set of tensors into contiguous ranged GETs. Adjacent members
       * (end == next.start) merge; a gap larger than `maxGap` splits into a new range so
       * we never fetch large dead spans.
       */
      coalesce(entries, maxGap = 1 << 20, maxBytes = 64 << 20) {
        const sorted = [...entries].sort((a, b) => a.absStart - b.absStart);
        const ranges = [];
        for (const e of sorted) {
          const last = ranges[ranges.length - 1];
          if (last && e.absStart - last.absEnd <= maxGap && e.absEnd - last.absStart <= maxBytes) {
            last.absEnd = Math.max(last.absEnd, e.absEnd);
            last.nBytes = last.absEnd - last.absStart;
            last.members.push(e);
          } else {
            ranges.push({ absStart: e.absStart, absEnd: e.absEnd, nBytes: e.nBytes, members: [e] });
          }
        }
        return ranges;
      }
      /** Coalesced ranges for one decoder block's weights. */
      coalesceBlock(layerIndex) {
        return this.coalesce(this.withPrefix(`blk.${layerIndex}.`));
      }
    };
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/model/config.ts
function deriveDeltaNetDims(arch) {
  const numVHeads = arch.ssmTimeStepRank ?? 0;
  const numKHeads = arch.ssmGroupCount ?? 0;
  const headDim = arch.ssmStateSize ?? 0;
  const vDim = arch.ssmInnerSize ?? numVHeads * headDim;
  const qDim = numKHeads * headDim;
  const kDim = numKHeads * headDim;
  const convDim = qDim + kDim + vDim;
  const convKernel = arch.ssmConvKernel ?? 0;
  if (numVHeads <= 0 || numKHeads <= 0 || headDim <= 0 || convKernel <= 0) {
    throw new Error(
      `bonsai-config: '${arch.arch}' has no DeltaNet layers \u2014 this in-browser runtime only runs the qwen35 hybrid (Bonsai-27B). Dense sizes run on a local node or the hosted lane instead. (numVHeads=${numVHeads}, numKHeads=${numKHeads}, headDim=${headDim}, convKernel=${convKernel})`
    );
  }
  if (numVHeads % numKHeads !== 0) {
    throw new Error(
      `bonsai-config: numVHeads ${numVHeads} not divisible by numKHeads ${numKHeads}`
    );
  }
  if (vDim !== numVHeads * headDim) {
    throw new Error(
      `bonsai-config: ssm.inner_size ${vDim} != numVHeads*headDim ${numVHeads * headDim}`
    );
  }
  return {
    numVHeads,
    numKHeads,
    headDim,
    qDim,
    kDim,
    vDim,
    convDim,
    convKernel,
    vPerKHead: numVHeads / numKHeads
  };
}
function deriveLayerKinds(reg, arch) {
  const blockCount = arch.blockCount;
  const headDim = arch.keyLength && arch.keyLength > 0 ? arch.keyLength : arch.embeddingLength / arch.headCount;
  const plainWidth = arch.headCount * headDim;
  const gatedWidth = plainWidth * 2;
  const kinds = [];
  for (let i = 0; i < blockCount; i++) {
    const p = `blk.${i}.`;
    const hasSsm = reg.ordered.some((e) => e.name.startsWith(p) && e.name.includes("ssm"));
    if (hasSsm) {
      kinds.push("linear-attn");
      continue;
    }
    const hasFullKv = reg.has(`${p}attn_k.weight`) || reg.has(`${p}attn_v.weight`) || reg.ordered.some((e) => e.name.startsWith(p) && /attn_(k|v)\b/.test(e.name));
    if (!hasFullKv) {
      throw new Error(
        `bonsai-config: block ${i} has neither ssm_* nor attn_k/v tensors \u2014 cannot classify layer`
      );
    }
    const qName = `${p}attn_q.weight`;
    if (!reg.has(qName)) {
      throw new Error(
        `bonsai-config: block ${i} has attn_k/v but no '${qName}' \u2014 cannot determine whether its attention is gated (qwen35) or plain (qwen3)`
      );
    }
    const qDims = reg.get(qName).dims;
    const outWidth = qDims.length >= 2 ? qDims[qDims.length - 1] : qDims[0];
    if (outWidth === gatedWidth) kinds.push("full-attn");
    else if (outWidth === plainWidth) kinds.push("dense-attn");
    else {
      throw new Error(
        `bonsai-config: block ${i} '${qName}' has output width ${outWidth}, which matches neither plain attention (nHeads*headDim = ${plainWidth}) nor gated attention (2*nHeads*headDim = ${gatedWidth}). headCount=${arch.headCount}, headDim=${headDim} (key_length=${arch.keyLength ?? "absent"}, embedding_length=${arch.embeddingLength}). Refusing to guess \u2014 the wrong choice produces fluent garbage, not an error.`
      );
    }
  }
  return kinds;
}
function deriveFfnNormNames(reg, blockCount) {
  const names = [];
  for (let i = 0; i < blockCount; i++) {
    const post = `blk.${i}.post_attention_norm.weight`;
    const ffn = `blk.${i}.ffn_norm.weight`;
    if (reg.has(post)) names.push(post);
    else if (reg.has(ffn)) names.push(ffn);
    else {
      throw new Error(
        `bonsai-config: block ${i} has neither '${post}' nor '${ffn}' \u2014 cannot locate the pre-FFN norm`
      );
    }
  }
  return names;
}
function resolveKernelDims(cfg) {
  const headDim = cfg.keyLength && cfg.keyLength > 0 ? cfg.keyLength : cfg.embeddingLength / cfg.headCount;
  let deltaNetDv;
  if (cfg.ssmInnerSize !== void 0 && cfg.headCount > 0 && cfg.ssmInnerSize % cfg.headCount === 0) {
    deltaNetDv = cfg.ssmInnerSize / cfg.headCount;
  }
  return { headDim, deltaNetDv };
}
function assertKernelDimBounds(cfg) {
  const { headDim, deltaNetDv } = resolveKernelDims(cfg);
  if (!Number.isInteger(headDim) || headDim <= 0) {
    throw new Error(
      `bonsai-config: head_dim (embedding_length ${cfg.embeddingLength} / head_count ${cfg.headCount}) = ${headDim} is not a positive integer \u2014 cannot size attention kernels`
    );
  }
  if (headDim > KERNEL_MAX_HEAD_DIM) {
    throw new Error(
      `bonsai-config: head_dim ${headDim} exceeds the WGSL fixed array bound ${KERNEL_MAX_HEAD_DIM} (softmax_attn.wgsl acc[${KERNEL_MAX_HEAD_DIM}]) \u2014 refusing to load; the kernel would read out of bounds on the GPU`
    );
  }
  if (deltaNetDv !== void 0 && deltaNetDv > KERNEL_MAX_HEAD_DIM) {
    throw new Error(
      `bonsai-config: DeltaNet d_v ${deltaNetDv} (ssm.inner_size ${cfg.ssmInnerSize} / head_count ${cfg.headCount}) exceeds the WGSL fixed array bound ${KERNEL_MAX_HEAD_DIM} (deltanet.wgsl err/o[${KERNEL_MAX_HEAD_DIM}]) \u2014 refusing to load`
    );
  }
  const dvNote = deltaNetDv !== void 0 ? `, DeltaNet d_v=${deltaNetDv}` : "";
  return { message: `head_dim=${headDim}${dvNote} (<= ${KERNEL_MAX_HEAD_DIM})` };
}
function resolveQwen35Config(arch, reg) {
  const layerKinds = deriveLayerKinds(reg, arch);
  const fullAttnLayers = [];
  const linearAttnLayers = [];
  layerKinds.forEach((k, i) => (k === "linear-attn" ? linearAttnLayers : fullAttnLayers).push(i));
  const deltaNet = linearAttnLayers.length > 0 ? deriveDeltaNetDims(arch) : void 0;
  const ffnNormNames = deriveFfnNormNames(reg, arch.blockCount);
  return { ...arch, layerKinds, fullAttnLayers, linearAttnLayers, deltaNet, ffnNormNames };
}
function assertLayerSchedule(cfg) {
  const total = cfg.fullAttnLayers.length + cfg.linearAttnLayers.length;
  if (total !== cfg.blockCount) {
    return { ok: false, message: `layer kinds (${total}) != blockCount (${cfg.blockCount})` };
  }
  if (cfg.linearAttnLayers.length === 0) {
    const dense = cfg.layerKinds.filter((k) => k === "dense-attn").length;
    return {
      ok: true,
      message: `dense: ${dense} plain-attn / ${cfg.blockCount - dense} gated-attn, no DeltaNet`
    };
  }
  if (cfg.blockCount === 64 && cfg.fullAttnLayers.length !== 16) {
    console.warn(
      `bonsai-config: Bonsai-27B expected 16 full-attn layers (64 blocks), got ${cfg.fullAttnLayers.length}. This may be a model variant; loading anyway.`
    );
  }
  return {
    ok: true,
    message: `${cfg.fullAttnLayers.length} full-attn / ${cfg.linearAttnLayers.length} linear-attn`
  };
}
var KERNEL_MAX_HEAD_DIM;
var init_config = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/model/config.ts"() {
    "use strict";
    KERNEL_MAX_HEAD_DIM = 256;
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/tokenizer/bpe.ts
function byteToUnicode() {
  const bs = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  const map = /* @__PURE__ */ new Map();
  for (let i = 0; i < bs.length; i++) map.set(bs[i], String.fromCodePoint(cs[i]));
  return map;
}
function buildTables(tokens, merges, tokenType = []) {
  const vocab = /* @__PURE__ */ new Map();
  tokens.forEach((t, i) => vocab.set(t, i));
  const mergeRank = /* @__PURE__ */ new Map();
  merges.forEach((m, i) => mergeRank.set(m, i));
  const byteEncoder = byteToUnicode();
  const byteDecoder = /* @__PURE__ */ new Map();
  byteEncoder.forEach((v, k) => byteDecoder.set(v, k));
  const specialEntries = [];
  const haveTypes = tokenType.length === tokens.length;
  tokens.forEach((t, i) => {
    const isSpecial = haveTypes ? tokenType[i] === TOKEN_TYPE_CONTROL || tokenType[i] === TOKEN_TYPE_USER_DEFINED : t.length >= 5 && t.startsWith("<|") && t.endsWith("|>");
    if (isSpecial) specialEntries.push([t, i]);
  });
  specialEntries.sort((a, b) => b[0].length - a[0].length);
  const specialTokens = new Map(specialEntries);
  return { vocab, idToToken: tokens, mergeRank, byteEncoder, byteDecoder, specialTokens };
}
function bpeMerge(symbols, mergeRank) {
  if (symbols.length < 2) return symbols;
  let word = symbols;
  for (; ; ) {
    let bestRank = Infinity;
    let bestIdx = -1;
    for (let i = 0; i < word.length - 1; i++) {
      const rank = mergeRank.get(`${word[i]} ${word[i + 1]}`);
      if (rank !== void 0 && rank < bestRank) {
        bestRank = rank;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    word = [
      ...word.slice(0, bestIdx),
      word[bestIdx] + word[bestIdx + 1],
      ...word.slice(bestIdx + 2)
    ];
  }
  return word;
}
function specialSplitRe(t) {
  let re = SPECIAL_RE_CACHE.get(t);
  if (re === void 0) {
    if (t.specialTokens.size === 0) {
      re = null;
    } else {
      const alt = [...t.specialTokens.keys()].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      re = new RegExp(alt, "g");
    }
    SPECIAL_RE_CACHE.set(t, re);
  }
  return re;
}
function encodePlain(text, t, ids) {
  let remaining = text;
  while (remaining.length > 0) {
    PRETOKEN_RE.lastIndex = 0;
    const match = PRETOKEN_RE.exec(remaining);
    if (!match) break;
    const piece = match[0];
    const enc = new TextEncoder();
    const bytes = enc.encode(piece);
    const symbols = Array.from(bytes, (b) => t.byteEncoder.get(b));
    const merged = bpeMerge(symbols, t.mergeRank);
    for (const tok of merged) {
      const id = t.vocab.get(tok);
      if (id !== void 0) ids.push(id);
      else for (const ch of tok) {
        const cid = t.vocab.get(ch);
        if (cid !== void 0) ids.push(cid);
      }
    }
    remaining = remaining.slice(piece.length);
  }
}
function encode(text, t) {
  const ids = [];
  const re = specialSplitRe(t);
  let pos = 0;
  if (re) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > pos) encodePlain(text.slice(pos, m.index), t, ids);
      ids.push(t.specialTokens.get(m[0]));
      pos = m.index + m[0].length;
    }
  }
  if (pos < text.length) encodePlain(text.slice(pos), t, ids);
  return ids;
}
function decode(ids, t) {
  let unicode = "";
  for (const id of ids) {
    const tok = t.idToToken[id];
    if (tok !== void 0) unicode += tok;
  }
  const bytes = [];
  for (const ch of unicode) {
    const b = t.byteDecoder.get(ch);
    if (b !== void 0) bytes.push(b);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
}
var TOKEN_TYPE_CONTROL, TOKEN_TYPE_USER_DEFINED, PRETOKEN_RE, SPECIAL_RE_CACHE;
var init_bpe = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/tokenizer/bpe.ts"() {
    "use strict";
    TOKEN_TYPE_CONTROL = 3;
    TOKEN_TYPE_USER_DEFINED = 4;
    PRETOKEN_RE = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;
    SPECIAL_RE_CACHE = /* @__PURE__ */ new WeakMap();
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/tokenizer/chat_template.ts
function renderChatML(messages, addGenerationPrompt = true, tools) {
  let out = "";
  if (tools && tools.length > 0) {
    out += `<|im_start|>system
`;
    if (messages[0]?.role === "system") {
      out += messages[0].content + "\n\n";
    }
    out += "# Tools\n\nYou may call one or more functions to assist with the user query.\n\n";
    out += "You are provided with function signatures within <tools></tools> XML tags:\n";
    out += "<tools>";
    for (const tool of tools) {
      out += "\n" + JSON.stringify(tool);
    }
    out += "\n</tools>\n\n";
    out += "For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:\n";
    out += "<tool_call>\n";
    out += '{"name": <function-name>, "arguments": <args-json-object>}\n';
    out += "</tool_call>";
    out += `<|im_end|>
`;
  } else {
    if (messages[0]?.role === "system") {
      out += `<|im_start|>system
${messages[0].content}<|im_end|>
`;
    }
  }
  const startIdx = tools && tools.length > 0 && messages[0]?.role === "system" ? 1 : !tools && messages[0]?.role === "system" ? 1 : 0;
  for (let i = startIdx; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "user") {
      out += `<|im_start|>user
${m.content}<|im_end|>
`;
    } else if (m.role === "assistant") {
      let content = m.content;
      let reasoning = m.reasoning_content || "";
      if (reasoning) {
        out += `<|im_start|>assistant
<think>
${reasoning.trim()}
</think>

`;
      } else {
        out += `<|im_start|>assistant
`;
      }
      if (content) {
        out += content;
      }
      if (m.tool_calls && m.tool_calls.length > 0) {
        for (const toolCall of m.tool_calls) {
          if (content) out += "\n";
          const fn = toolCall.function || toolCall;
          out += "<tool_call>\n";
          out += JSON.stringify({
            name: fn.name,
            arguments: typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments
          });
          out += "\n</tool_call>";
        }
      }
      out += `<|im_end|>
`;
    } else if (m.role === "tool") {
      out += `<|im_start|>user
<tool_response>
${m.content}
</tool_response><|im_end|>
`;
    }
  }
  if (addGenerationPrompt) {
    out += `<|im_start|>assistant
<think>

</think>

`;
  }
  return out;
}
var init_chat_template = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/tokenizer/chat_template.ts"() {
    "use strict";
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/tokenizer/load.ts
var BonsaiTokenizer;
var init_load = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/tokenizer/load.ts"() {
    "use strict";
    init_bpe();
    init_chat_template();
    BonsaiTokenizer = class {
      constructor(spec) {
        this.tables = buildTables(spec.tokens, spec.merges, spec.tokenType);
        this.bosTokenId = spec.bosTokenId;
        this.eosTokenId = spec.eosTokenId;
        this.thinkStartId = this.tables.specialTokens.get("<think>");
        this.thinkEndId = this.tables.specialTokens.get("</think>");
        const stops = /* @__PURE__ */ new Set();
        if (spec.eosTokenId !== void 0) stops.add(spec.eosTokenId);
        for (const name of ["<|im_end|>", "<|endoftext|>"]) {
          const id = this.tables.specialTokens.get(name);
          if (id !== void 0) stops.add(id);
        }
        this.stopIds = stops;
      }
      get vocabSize() {
        return this.tables.idToToken.length;
      }
      encode(text) {
        return encode(text, this.tables);
      }
      decode(ids) {
        return decode(ids, this.tables);
      }
      /** Render + encode a chat turn with optional tools. */
      encodeChat(messages, tools) {
        return this.encode(renderChatML(messages, true, tools));
      }
      /** True when `id` ends the assistant turn (GGUF eos, `<|im_end|>`, or `<|endoftext|>`). */
      isStop(id) {
        return this.stopIds.has(id);
      }
      /** @deprecated Only ever matched the single GGUF eos id — use {@link isStop}. */
      isEos(id) {
        return this.eosTokenId !== void 0 && id === this.eosTokenId;
      }
    };
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/kernels/gpu-min.ts
var BufferUsage, MapMode;
var init_gpu_min = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/kernels/gpu-min.ts"() {
    "use strict";
    BufferUsage = {
      MAP_READ: 1,
      MAP_WRITE: 2,
      COPY_SRC: 4,
      COPY_DST: 8,
      STORAGE: 128,
      UNIFORM: 64
    };
    MapMode = { READ: 1, WRITE: 2 };
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/tensors/upload.ts
function needsChunking(device, nBytes) {
  return nBytes > device.limits.maxStorageBufferBindingSize;
}
async function uploadCoalescedRange(device, fetchRange, range) {
  const body = await fetchRange(range.absStart, range.absEnd - 1);
  const out = [];
  for (const m of range.members) {
    const localStart = m.absStart - range.absStart;
    const slice = body.subarray(localStart, localStart + m.nBytes);
    if (needsChunking(device, m.nBytes)) {
      const cap = device.limits.maxStorageBufferBindingSize;
      const hint = cap === WEBGPU_DEFAULT_MAX_STORAGE_BINDING ? " \u2014 this is the WebGPU DEFAULT limit, so the device was almost certainly created without requiredLimits; mirror adapter.limits in requestDevice()" : " \u2014 this adapter genuinely caps here; a chunked upload path is required";
      throw new Error(
        `bonsai-upload: tensor '${m.name}' (${m.nBytes} B) exceeds maxStorageBufferBindingSize (${cap})${hint}`
      );
    }
    const payload = m.type === GGML_Q1_0 ? repackQ1_0(slice) : m.type === GGML_Q2_0 ? repackQ2_0(slice) : padTo4(slice);
    const buffer = device.createBuffer({
      size: payload.byteLength,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: m.name
    });
    device.queue.writeBuffer(buffer, 0, payload);
    out.push({ entry: m, buffer });
  }
  return out;
}
function repackQ1_0(slice) {
  const nBlocks = Math.floor(slice.length / Q1_0_RAW_BYTES);
  const packed = new Uint8Array(nBlocks * Q1_0_GPU_BYTES);
  for (let b = 0; b < nBlocks; b++) {
    packed.set(
      slice.subarray(b * Q1_0_RAW_BYTES, b * Q1_0_RAW_BYTES + Q1_0_RAW_BYTES),
      b * Q1_0_GPU_BYTES
    );
  }
  return packed;
}
function repackQ2_0(slice) {
  const nBlocks = Math.floor(slice.length / Q2_0_RAW_BYTES);
  const packed = new Uint8Array(nBlocks * Q2_0_GPU_BYTES);
  for (let b = 0; b < nBlocks; b++) {
    packed.set(
      slice.subarray(b * Q2_0_RAW_BYTES, b * Q2_0_RAW_BYTES + Q2_0_RAW_BYTES),
      b * Q2_0_GPU_BYTES
    );
  }
  return packed;
}
function padTo4(slice) {
  const n = alignUp(slice.length, 4);
  if (n === slice.length) return slice;
  const padded = new Uint8Array(n);
  padded.set(slice);
  return padded;
}
function alignUp(n, a) {
  return n + (a - n % a) % a;
}
var WEBGPU_DEFAULT_MAX_STORAGE_BINDING, GGML_Q1_0, GGML_Q2_0, Q1_0_RAW_BYTES, Q1_0_GPU_BYTES, Q2_0_RAW_BYTES, Q2_0_GPU_BYTES;
var init_upload = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/tensors/upload.ts"() {
    "use strict";
    init_gpu_min();
    WEBGPU_DEFAULT_MAX_STORAGE_BINDING = 134217728;
    GGML_Q1_0 = 41;
    GGML_Q2_0 = 42;
    Q1_0_RAW_BYTES = 18;
    Q1_0_GPU_BYTES = 20;
    Q2_0_RAW_BYTES = 34;
    Q2_0_GPU_BYTES = 36;
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/model/weights.ts
var WeightStore;
var init_weights = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/model/weights.ts"() {
    "use strict";
    init_types();
    init_upload();
    WeightStore = class {
      constructor(device, registry, fetchRange) {
        this.device = device;
        this.registry = registry;
        this.fetchRange = fetchRange;
        this.buffers = /* @__PURE__ */ new Map();
        this.loadedLayers = /* @__PURE__ */ new Set();
        /** Layers whose upload has STARTED but not finished — see ensureLayer's re-entrancy note. */
        this.inflight = /* @__PURE__ */ new Map();
      }
      has(name) {
        return this.buffers.has(name);
      }
      get(name) {
        const b = this.buffers.get(name);
        if (!b) throw new Error(`bonsai-weights: '${name}' not resident (load its layer first)`);
        return b;
      }
      /**
       * The GGUF quant type of a tensor, from the file's own header.
       *
       * Consumers used to assume Q1_0 everywhere — hardcoded 18-byte blocks, hardcoded
       * `readQ1Block`, hardcoded `projectQ1`. With a second quant type that assumption reads a
       * 34-byte Q2_0 block as an 18-byte Q1_0 one and produces fluent garbage instead of
       * crashing, which is the hardest failure in this runtime to notice. So the type comes from
       * the registry, never from a default.
       */
      typeOf(name) {
        return this.registry.get(name).type;
      }
      /**
       * The quant type shared by every DECODER-BLOCK weight tensor in this file.
       *
       * This is what `OpCtx.quantType` is set from, and it is the reason the block projections
       * can keep dispatching off the context instead of threading a type through ~20 call sites:
       * the homogeneity the context-level dispatch assumes is CHECKED here against the file's
       * own header rather than believed.
       *
       * A mixed-quant file THROWS. That is deliberate — the failure mode of guessing wrong is a
       * 34-byte Q2_0 block read at the 18-byte Q1_0 stride, which does not crash and does not
       * produce noise; it produces fluent, plausible text. Refusing to load is the only outcome
       * a human can notice. Per-tensor dispatch (`projectQuantized`) is the way to SUPPORT mixed
       * quant if a future file needs it — not a default picked here.
       *
       * Reads the registry (the parsed header), so it is valid before any layer is uploaded.
       * Non-quantized block tensors (F32/F16 norms) are ignored; an unsupported QUANT type is
       * not — it throws, because it would otherwise fall through to the Q1_0 path.
       */
      weightQuantType() {
        if (this.blockQuantType !== void 0) return this.blockQuantType;
        const isFloat = (t) => t === 0 /* F32 */ || t === 1 /* F16 */;
        const quantized = this.registry.ordered.filter(
          (e) => e.name.startsWith("blk.") && !isFloat(e.type)
        );
        if (quantized.length === 0) {
          throw new Error(
            "bonsai-weights: no quantized 'blk.*' weight tensors in the registry \u2014 cannot determine the model's weight quant type"
          );
        }
        const byType = /* @__PURE__ */ new Map();
        for (const e of quantized) if (!byType.has(e.type)) byType.set(e.type, e.name);
        for (const [t, example] of byType) {
          if (t !== 41 /* Q1_0 */ && t !== 42 /* Q2_0 */) {
            throw new Error(
              `bonsai-weights: block tensor '${example}' has unsupported quant type ${t} (supported: Q1_0=${41 /* Q1_0 */}, Q2_0=${42 /* Q2_0 */})`
            );
          }
        }
        if (byType.size > 1) {
          const seen = [...byType].map(([t, n]) => `${t} (e.g. '${n}')`).join(", ");
          throw new Error(
            `bonsai-weights: decoder blocks mix quant types \u2014 ${seen}. The block projections dispatch once per context, so a mixed file would silently run some layers through the wrong kernel and emit fluent garbage. Use projectQuantized per tensor to support this.`
          );
        }
        this.blockQuantType = quantized[0].type;
        return this.blockQuantType;
      }
      register(uploaded) {
        for (const u of uploaded) this.buffers.set(u.entry.name, u.buffer);
      }
      /** Upload the non-layer globals: token embeddings, output norm, LM head. */
      async loadGlobals(names) {
        const entries = names.filter((n) => this.registry.has(n)).map((n) => this.registry.get(n));
        for (const range of this.registry.coalesce(entries)) {
          this.register(await uploadCoalescedRange(this.device, this.fetchRange, range));
        }
      }
      /** Lazily upload one decoder block's weights (coalesced). Idempotent AND re-entrant.
       *
       * RE-ENTRANCY IS LOAD-BEARING, not defensive polish. The old body checked `loadedLayers`,
       * awaited the fetches, and only THEN recorded the layer — so two overlapping calls for the
       * same block both missed the guard, both fetched it over HTTP, and both uploaded it, with
       * the second `register()` overwriting the first buffer handle and LEAKING the first
       * (nothing else holds it, and `evictLayer` walks names, not orphans). That was harmless
       * only because every caller awaited serially. `prefetchLayer` makes overlap the normal
       * case, so the in-flight map has to exist before the prefetch does. */
      ensureLayer(layerIndex) {
        if (this.loadedLayers.has(layerIndex)) return Promise.resolve();
        const inflight = this.inflight.get(layerIndex);
        if (inflight) return inflight;
        const started = this.loadLayer(layerIndex).finally(() => this.inflight.delete(layerIndex));
        this.inflight.set(layerIndex, started);
        return started;
      }
      async loadLayer(layerIndex) {
        for (const range of this.registry.coalesceBlock(layerIndex)) {
          this.register(await uploadCoalescedRange(this.device, this.fetchRange, range));
        }
        this.loadedLayers.add(layerIndex);
      }
      /**
       * Start streaming a layer WITHOUT waiting for it — the read-ahead that turns first-token
       * latency from a sum into an overlap.
       *
       * The first generation streams the whole model layer by layer, and every fetch used to sit
       * on the critical path: `await ensureLayer(l)` then compute l, 36 times, so the link idled
       * through every block's compute and the GPU idled through every block's download. Nothing
       * required that ordering — layer l+1's bytes depend on nothing layer l produces.
       *
       * Errors are swallowed HERE and only here: a prefetch is speculative, so a failure must not
       * surface as an unhandled rejection from a promise nobody awaited. The real `ensureLayer`
       * call for that block still runs (the map entry is gone by then) and still throws where a
       * caller can see it, so a genuinely broken fetch fails at the point that needs the bytes
       * rather than being converted into silence.
       */
      prefetchLayer(layerIndex) {
        if (layerIndex < 0 || this.loadedLayers.has(layerIndex)) return;
        if (this.registry.coalesceBlock(layerIndex).length === 0) return;
        void this.ensureLayer(layerIndex).catch(() => {
        });
      }
      /** Layers currently uploaded, for tests and the read-ahead's own assertions. */
      get residentLayerCount() {
        return this.loadedLayers.size;
      }
      /** Free a layer's buffers (for streaming under tight memory). */
      evictLayer(layerIndex, tensorNames) {
        this.inflight.delete(layerIndex);
        for (const n of tensorNames) {
          const b = this.buffers.get(n);
          if (b) {
            b.destroy();
            this.buffers.delete(n);
          }
        }
        this.loadedLayers.delete(layerIndex);
      }
    };
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/kernels/pipelines.ts
var KERNEL_NAMES, PipelineCache;
var init_pipelines = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/kernels/pipelines.ts"() {
    "use strict";
    KERNEL_NAMES = [
      "quantize_q8_0",
      "q1_0_dequant",
      "q1_0_q8_0_matmul",
      "q2_0_dequant",
      "q2_0_q8_0_matmul",
      "kv_quant_4bit",
      "rmsnorm",
      "rope_imrope",
      "softmax_attn",
      "softmax_attn_batched",
      "causal_conv1d",
      "deltanet",
      "deltanet_gate",
      "deltanet_seq",
      "swiglu",
      "sampling",
      "logit_topk",
      "vae_ops",
      "elementwise",
      "elementwise_inplace"
    ];
    PipelineCache = class {
      constructor(device, sources) {
        this.device = device;
        this.sources = sources;
        this.cache = /* @__PURE__ */ new Map();
      }
      /**
       * `entry` names a non-default entry point in the same WGSL module.
       *
       * Almost every kernel here is one module with one `main`, and that stays the default. The
       * exception is a kernel whose passes MUST share a binding layout and a set of constants —
       * logit_topk's histogram and gather read the same logits buffer and the same uniform, and
       * splitting them into two files would duplicate the struct and the bin arithmetic, which
       * is precisely the kind of copy that drifts and produces a silently wrong threshold.
       *
       * The cache key includes the entry point; keying on the module name alone would hand the
       * gather pipeline back for the histogram pass, which is a wrong-kernel bug that still
       * dispatches successfully.
       */
      get(name, entry = "main") {
        const key = entry === "main" ? name : `${name}:${entry}`;
        const hit = this.cache.get(key);
        if (hit) return hit;
        const code = this.sources[name];
        if (!code) throw new Error(`bonsai-pipelines: no WGSL source registered for '${name}'`);
        const module = this.device.createShaderModule({ code, label: name });
        const pipeline = this.device.createComputePipeline({
          label: key,
          layout: "auto",
          compute: { module, entryPoint: entry }
        });
        this.cache.set(key, pipeline);
        return pipeline;
      }
      /** Warm the whole set at load so first-token latency doesn't eat compile time. */
      warmAll() {
        for (const n of KERNEL_NAMES) {
          if (!this.sources[n]) continue;
          if (n === "logit_topk") {
            this.get(n, "hist_main");
            this.get(n, "gather_main");
            continue;
          }
          if (n === "vae_ops") {
            this.get(n, "conv2d_main");
            this.get(n, "groupnorm_main");
            this.get(n, "upsample_nearest_main");
            continue;
          }
          this.get(n);
        }
      }
    };
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/runtime.ts
function createBonsaiRuntime(deps) {
  return new BonsaiRuntime(deps);
}
var BonsaiRuntime;
var init_runtime = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/runtime.ts"() {
    "use strict";
    init_reader();
    init_idb_cache();
    init_parser();
    init_metadata();
    init_registry();
    init_config();
    init_load();
    init_weights();
    init_pipelines();
    BonsaiRuntime = class {
      constructor(deps) {
        this.deps = deps;
      }
      /** Parse the GGUF and build everything needed to run. Emits progress 0-100. */
      async load(opts) {
        const urls = opts.mirrorUrls?.length ? opts.mirrorUrls : [opts.modelUrl];
        const baseFetch = this.deps.fetchRange ?? mirroredRangeFetcher(urls);
        const fetchRange = this.deps.fetchRange ? baseFetch : cachedRangeFetcher(opts.modelUrl, baseFetch);
        const p = opts.onProgress ?? (() => {
        });
        p({ phase: "parse", percent: 2, detail: "range-fetching header + KV" });
        const reader = new RangeReader({ url: opts.modelUrl, fetchRange });
        const parsed = await parseGguf(reader);
        const meta = new GgufMetadata(parsed.kv);
        p({ phase: "config", percent: 30, detail: `arch=${meta.arch}` });
        const registry = new TensorRegistry(parsed);
        const arch = meta.resolveArchConfig();
        const config = resolveQwen35Config(arch, registry);
        const schedule = assertLayerSchedule(config);
        const dimBounds = assertKernelDimBounds(config);
        console.log(`bonsai: kernel dims OK \u2014 ${dimBounds.message}`);
        p({ phase: "tokenizer", percent: 45, detail: "building BPE tables" });
        const tokenizer = new BonsaiTokenizer(meta.resolveTokenizer());
        p({ phase: "pipelines", percent: 60, detail: "compiling WGSL" });
        const pipelines = new PipelineCache(this.deps.device, this.deps.kernelSources);
        pipelines.warmAll();
        p({ phase: "globals", percent: 75, detail: "uploading embeddings + LM head + norms" });
        const weights = new WeightStore(this.deps.device, registry, fetchRange);
        const requiredGlobals = ["token_embd.weight", "output_norm.weight"];
        await weights.loadGlobals(requiredGlobals);
        for (const name of requiredGlobals) {
          if (!weights.has(name)) {
            throw new Error(
              `bonsai-runtime: required tensor '${name}' was not found in the GGUF file. The model file may be corrupted or incomplete \u2014 try clearing your browser cache and reloading, or switch to a different model size.`
            );
          }
        }
        const optionalGlobals = ["output.weight"];
        try {
          await weights.loadGlobals(optionalGlobals);
        } catch (e) {
          console.warn(`bonsai-runtime: optional globals not loaded: ${e.message}`);
        }
        p({ phase: "ready", percent: 100 });
        const model = {
          device: this.deps.device,
          parsed,
          meta,
          registry,
          config,
          tokenizer,
          pipelines,
          weights,
          scheduleOk: schedule.ok,
          scheduleMessage: schedule.message
        };
        this.model = model;
        return model;
      }
      get loaded() {
        return this.model;
      }
    };
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/kernels/reference.ts
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
function readQ1Block(bytes, off = 0) {
  if (bytes.length - off < Q1_0_BYTES) throw new Error("readQ1Block: need 18 bytes");
  const dBits = bytes[off] | bytes[off + 1] << 8;
  const qs = bytes.subarray(off + 2, off + 2 + 16);
  return { d: f16ToF32(dBits), qs: new Uint8Array(qs) };
}
function q1Bit(qs, j) {
  return qs[j >> 3] >> (j & 7) & 1;
}
function dequantQ1Block(block) {
  const out = new Float32Array(QK1_0);
  for (let j = 0; j < QK1_0; j++) out[j] = q1Bit(block.qs, j) ? block.d : -block.d;
  return out;
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
var _f32, _u32;
var init_reference = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/kernels/reference.ts"() {
    "use strict";
    init_types();
    _f32 = new Float32Array(1);
    _u32 = new Uint32Array(_f32.buffer);
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/provenance.ts
var PROVENANCE_MARKER, PROVENANCE_HEADER_TS, PROVENANCE_HEADER_WGSL;
var init_provenance = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/provenance.ts"() {
    "use strict";
    PROVENANCE_MARKER = "Numerics ported from owner-owned fork";
    PROVENANCE_HEADER_TS = `/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * \xA9 2026 Aitherium, LLC. Original work.
 * ${PROVENANCE_MARKER}: github.com/PrismML-Eng/llama.cpp @ branch "prism"
 * GGUF container: public spec ggml-org/ggml docs/gguf.md (format v3).
 * NO third-party WebGPU kernel source was consulted (HF Spaces bonsai-* excluded).
 */`;
    PROVENANCE_HEADER_WGSL = `// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// ${PROVENANCE_MARKER}: github.com/PrismML-Eng/llama.cpp @ branch "prism"
// NO third-party WebGPU kernel source was consulted (HF Spaces bonsai-* excluded).`;
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/index.ts
var init_bonsai = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/index.ts"() {
    "use strict";
    init_runtime();
    init_reader();
    init_parser();
    init_metadata();
    init_types();
    init_registry();
    init_config();
    init_reference();
    init_pipelines();
    init_load();
    init_chat_template();
    init_provenance();
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/gpu-class.ts
function classifyAdapter(hint) {
  if (hint?.isFallbackAdapter === true) return "software";
  const vendor = hint?.vendor?.trim().toLowerCase();
  if (!vendor) return "unknown";
  if (SOFTWARE_VENDORS.includes(vendor)) return "software";
  if (INTEGRATED_VENDORS.includes(vendor)) return "integrated";
  return "unknown";
}
function maxDispatchesPerSubmit(cls, opts) {
  if (opts?.mobile) return 4;
  switch (cls) {
    case "software":
    case "integrated":
      return 8;
    // An unknown adapter is NOT assumed weak — Safari and Firefox expose no adapter info
    // at all, and throttling every one of them to protect a class we cannot see would slow
    // the majority to guard the minority. Unknown keeps the discrete path.
    case "unknown":
    case "discrete":
    default:
      return opts?.windowsTdr ? 64 : 0;
  }
}
var INTEGRATED_VENDORS, SOFTWARE_VENDORS;
var init_gpu_class = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/gpu-class.ts"() {
    "use strict";
    INTEGRATED_VENDORS = ["intel", "arm", "qualcomm", "imgtec"];
    SOFTWARE_VENDORS = ["microsoft"];
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/kernels/dispatch.ts
function ceilDiv(a, b) {
  return Math.floor((a + b - 1) / b);
}
function setSubmitBudget(device, maxDispatches) {
  submitBudget.set(device, Math.max(0, Math.floor(maxDispatches)));
}
function beginBatch(device) {
  if (!activeBatch.has(device)) {
    activeBatch.set(device, { enc: device.createCommandEncoder(), dispatches: 0 });
  }
}
function flushBatch(device) {
  const b = activeBatch.get(device);
  if (!b) return;
  activeBatch.delete(device);
  device.queue.submit([b.enc.finish()]);
}
function beginCopies(device) {
  const batch = activeBatch.get(device);
  if (batch) return { enc: batch.enc, batched: true };
  return { enc: device.createCommandEncoder(), batched: false };
}
function finishCopies(device, t) {
  if (!t.batched) device.queue.submit([t.enc.finish()]);
}
function poolFor(device) {
  let m = bufferPool.get(device);
  if (!m) {
    m = /* @__PURE__ */ new Map();
    bufferPool.set(device, m);
  }
  return m;
}
function statsFor(device) {
  let s = poolStats.get(device);
  if (!s) {
    s = { created: 0, reused: 0 };
    poolStats.set(device, s);
  }
  return s;
}
function keyOf(usage, size) {
  return `${usage}:${size}`;
}
function acquire(device, usage, size, label, queueInit = false) {
  const pool = poolFor(device);
  const key = keyOf(usage, size);
  const free = pool.get(key);
  const st = statsFor(device);
  if (globalThis.__BONSAI_NO_POOL === true) {
    st.created++;
    return device.createBuffer({ size, usage, label });
  }
  if (free && free.length > 0) {
    st.reused++;
    const buf = free.pop();
    if (queueInit) return buf;
    const tgt = beginCopies(device);
    tgt.enc.clearBuffer(buf, 0, size);
    finishCopies(device, tgt);
    return buf;
  }
  st.created++;
  return device.createBuffer({ size, usage, label });
}
function deferDestroy(device, buf) {
  let l = deferredDestroy.get(device);
  if (!l) {
    l = [];
    deferredDestroy.set(device, l);
  }
  l.push(buf);
}
function flushDeferred(device) {
  const l = deferredDestroy.get(device);
  if (!l) return;
  const pool = poolFor(device);
  for (const b of l) {
    const key = b[POOL_KEY];
    if (key === void 0) {
      try {
        b.destroy();
      } catch {
      }
      continue;
    }
    let list = pool.get(key);
    if (!list) {
      list = [];
      pool.set(key, list);
    }
    list.push(b);
  }
  l.length = 0;
}
function createStorage(device, bytes, label, opts) {
  const size = Math.max(4, align4(bytes));
  const buf = acquire(device, STORAGE_USAGE, size, label, opts?.queueInit === true);
  buf[POOL_KEY] = keyOf(STORAGE_USAGE, size);
  return buf;
}
function createUniform(device, bytes, label) {
  const size = Math.max(16, align4(bytes));
  const buf = acquire(device, UNIFORM_USAGE, size, label, true);
  buf[POOL_KEY] = keyOf(UNIFORM_USAGE, size);
  return buf;
}
function align4(n) {
  return n + (4 - n % 4) % 4;
}
function bindGroup(device, pipeline, buffers) {
  return device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: buffers.map((b, i) => ({ binding: i, resource: { buffer: b } }))
  });
}
function dispatch1D(device, pipeline, group, totalThreads, workgroupSize) {
  const batch = activeBatch.get(device);
  const enc = batch ? batch.enc : device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  const groups = ceilDiv(totalThreads, workgroupSize);
  if (groups <= MAX_WORKGROUPS_PER_DIM) {
    pass.dispatchWorkgroups(groups);
  } else {
    const gx = MAX_WORKGROUPS_PER_DIM;
    const gy = ceilDiv(groups, gx);
    if (gy > MAX_WORKGROUPS_PER_DIM) {
      throw new Error(
        `bonsai-dispatch: ${groups} workgroups exceeds even a 2-D grid (${MAX_WORKGROUPS_PER_DIM}^2). This is a context-length bug upstream, not a dispatch bug \u2014 chunk the work.`
      );
    }
    pass.dispatchWorkgroups(gx, gy);
  }
  pass.end();
  if (!batch) {
    device.queue.submit([enc.finish()]);
    return;
  }
  batch.dispatches++;
  const budget = submitBudget.get(device) ?? 0;
  if (budget > 0 && batch.dispatches >= budget) {
    console.debug(
      `[bonsai] TDR budget limit reached: submitted ${batch.dispatches} dispatches, opening new batch to stay under GPU watchdog deadline`
    );
    activeBatch.delete(device);
    device.queue.submit([batch.enc.finish()]);
    activeBatch.set(device, { enc: device.createCommandEncoder(), dispatches: 0 });
  }
}
function takeStaging(device, size) {
  let bySize = stagingPool.get(device);
  if (!bySize) {
    bySize = /* @__PURE__ */ new Map();
    stagingPool.set(device, bySize);
  }
  const free = bySize.get(size);
  if (free && free.length) return free.pop();
  return device.createBuffer({
    size,
    usage: BufferUsage.MAP_READ | BufferUsage.COPY_DST,
    label: "readback"
  });
}
function giveBackStaging(device, size, buf) {
  const bySize = stagingPool.get(device);
  if (!bySize) {
    buf.destroy();
    return;
  }
  let free = bySize.get(size);
  if (!free) {
    free = [];
    bySize.set(size, free);
  }
  if (free.length >= 4) {
    buf.destroy();
    return;
  }
  free.push(buf);
}
async function readback(device, src, byteLength) {
  flushBatch(device);
  const size = align4(byteLength);
  const staging = takeStaging(device, size);
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(src, 0, staging, 0, size);
  device.queue.submit([enc.finish()]);
  await staging.mapAsync(MapMode.READ);
  const copy = staging.getMappedRange().slice(0, byteLength);
  staging.unmap();
  giveBackStaging(device, size, staging);
  return copy;
}
function packUniform(fields) {
  const buf = new ArrayBuffer(align16(fields.length * 4));
  const dv = new DataView(buf);
  fields.forEach((f, i) => {
    if (f.u32 !== void 0) dv.setUint32(i * 4, f.u32, true);
    else dv.setFloat32(i * 4, f.f32 ?? 0, true);
  });
  return buf;
}
function align16(n) {
  return n + (16 - n % 16) % 16;
}
var activeBatch, submitBudget, deferredDestroy, bufferPool, poolStats, POOL_KEY, STORAGE_USAGE, UNIFORM_USAGE, MAX_WORKGROUPS_PER_DIM, stagingPool;
var init_dispatch = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/kernels/dispatch.ts"() {
    "use strict";
    init_gpu_min();
    activeBatch = /* @__PURE__ */ new WeakMap();
    submitBudget = /* @__PURE__ */ new WeakMap();
    deferredDestroy = /* @__PURE__ */ new WeakMap();
    bufferPool = /* @__PURE__ */ new WeakMap();
    poolStats = /* @__PURE__ */ new WeakMap();
    POOL_KEY = Symbol("aither.poolKey");
    STORAGE_USAGE = BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC;
    UNIFORM_USAGE = BufferUsage.UNIFORM | BufferUsage.COPY_DST;
    MAX_WORKGROUPS_PER_DIM = 65535;
    stagingPool = /* @__PURE__ */ new WeakMap();
  }
});

// AitherOS/apps/packages/awkit/src/webml/device-class.ts
function classifyAdapter2(hint) {
  if (hint?.isFallbackAdapter === true) return "software";
  const vendor = hint?.vendor?.trim().toLowerCase();
  if (!vendor) return "unknown";
  if (SOFTWARE_VENDORS2.includes(vendor)) return "software";
  if (INTEGRATED_VENDORS2.includes(vendor)) return "integrated";
  return "unknown";
}
function mayAutoBoot(cls) {
  if (isMobileDevice()) return false;
  return cls !== "software";
}
function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true;
  const touch = navigator.maxTouchPoints ?? 0;
  return /Macintosh/i.test(ua) && touch > 1;
}
function gpuLaneAllowed() {
  return !isMobileDevice();
}
function autoBootAllowed(hint) {
  if (isMobileDevice()) return false;
  if (!hint) return true;
  return mayAutoBoot(classifyAdapter2(hint));
}
var FIRST_TOKEN_FAIL_MS, LOAD_FAIL_MS, INTEGRATED_VENDORS2, SOFTWARE_VENDORS2;
var init_device_class = __esm({
  "AitherOS/apps/packages/awkit/src/webml/device-class.ts"() {
    "use strict";
    FIRST_TOKEN_FAIL_MS = 6e4;
    LOAD_FAIL_MS = 18e4;
    INTEGRATED_VENDORS2 = ["intel", "arm", "qualcomm", "imgtec"];
    SOFTWARE_VENDORS2 = ["microsoft"];
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai-models.ts
function getBonsaiModel(id) {
  return BONSAI_MODELS_INFO.find((m) => m.id === id);
}
function resolveBonsaiUrl(id) {
  const m = getBonsaiModel(id) ?? getBonsaiModel(DEFAULT_BONSAI_MODEL_ID);
  return bonsaiMirrorUrl(m);
}
function bonsaiMirrorUrl(m) {
  const file = m.url.split("/").pop();
  if (!file) return m.url;
  return `${BONSAI_MIRROR.replace(/\/+$/, "")}/${file}`;
}
function suggestBonsaiModelId() {
  if (typeof navigator === "undefined") return DEFAULT_BONSAI_MODEL_ID;
  const nav = navigator;
  if (nav.connection?.saveData) return "bonsai-1.7b";
  const slowLink = nav.connection?.effectiveType && /2g/.test(nav.connection.effectiveType);
  if (slowLink) return "bonsai-1.7b";
  const mem = nav.deviceMemory ?? 4;
  const mobile = isMobileDevice();
  if (mobile) return mem >= 6 ? "bonsai-4b" : "bonsai-1.7b";
  if (mem >= 8) return "bonsai-8b";
  return DEFAULT_BONSAI_MODEL_ID;
}
function pickBonsaiContext(model) {
  const mem = typeof navigator !== "undefined" && navigator.deviceMemory || 4;
  const tier = mem >= 16 ? 32768 : mem >= 8 ? 16384 : mem >= 4 ? 8192 : 4096;
  return Math.min(tier, model.contextWindow);
}
var HF_PRISM, BONSAI_MIRROR, BONSAI_MODELS_INFO, DEFAULT_BONSAI_MODEL_ID;
var init_bonsai_models = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai-models.ts"() {
    "use strict";
    init_device_class();
    HF_PRISM = "https://huggingface.co/prism-ml";
    BONSAI_MIRROR = "https://weights.aitherium.com";
    BONSAI_MODELS_INFO = [
      {
        id: "bonsai-1.7b",
        label: "Bonsai 1.7B",
        params: "1.7B",
        sizeMb: 236,
        url: `${HF_PRISM}/Bonsai-1.7B-gguf/resolve/main/Bonsai-1.7B-Q1_0.gguf`,
        contextWindow: 32768,
        blurb: "The lightest size \u2014 236 MB, runs on phones and older laptops.",
        arch: "qwen3"
      },
      {
        id: "bonsai-4b",
        label: "Bonsai 4B",
        params: "4B",
        sizeMb: 545,
        url: `${HF_PRISM}/Bonsai-4B-gguf/resolve/main/Bonsai-4B-Q1_0.gguf`,
        contextWindow: 32768,
        blurb: "Balanced: smarter than 1.7B, quick to download and run.",
        arch: "qwen3"
      },
      {
        id: "bonsai-8b",
        label: "Bonsai 8B",
        params: "8B",
        sizeMb: 1104,
        url: `${HF_PRISM}/Bonsai-8B-gguf/resolve/main/Bonsai-8B-Q1_0.gguf`,
        contextWindow: 65536,
        blurb: "Better reasoning, ~1 GB. Desktop GPU recommended.",
        arch: "qwen3"
      },
      {
        id: "bonsai-27b-text",
        label: "Bonsai 27B (Reasoning)",
        params: "27B",
        sizeMb: 3627,
        url: `${HF_PRISM}/Bonsai-27B-gguf/resolve/main/Bonsai-27B-Q1_0.gguf`,
        contextWindow: 262144,
        blurb: "Full reasoning brain. 3.6 GB, needs a real desktop GPU.",
        arch: "qwen35"
      }
    ];
    DEFAULT_BONSAI_MODEL_ID = "bonsai-4b";
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/kernels/wgsl-sources.ts
var wgsl_sources_exports = {};
__export(wgsl_sources_exports, {
  WGSL_SOURCES: () => WGSL_SOURCES
});
var CAUSAL_CONV1D, DELTANET, DELTANET_GATE, DELTANET_SEQ, ELEMENTWISE, ELEMENTWISE_INPLACE, KV_QUANT_4BIT, LOGIT_TOPK, Q1_0_DEQUANT, Q1_0_Q8_0_MATMUL, Q2_0_DEQUANT, Q2_0_Q8_0_MATMUL, QUANTIZE_Q8_0, RMSNORM, ROPE_IMROPE, SAMPLING, SOFTMAX_ATTN, SOFTMAX_ATTN_BATCHED, SWIGLU, VAE_OPS, WGSL_SOURCES;
var init_wgsl_sources = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/kernels/wgsl-sources.ts"() {
    "use strict";
    CAUSAL_CONV1D = `// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
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
`;
    DELTANET = `// ============================================================================
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
`;
    DELTANET_GATE = `// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
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
`;
    DELTANET_SEQ = "// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\n// \xA9 2026 Aitherium, LLC. Original work.\n// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\n// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\n// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\n//\n// Gated DeltaNet (Qwen3-Next) sequential recurrence \u2014 the WHOLE token sequence for a\n// layer in ONE dispatch, no host readback. Per v-head state S is [d_k \xD7 d_v] (d_k==d_v==\n// head_dim). q/k are grouped: each v-head h reads the k/q of k-head (h / v_per_k). q,k are\n// already L2-normalized; v is already conv+SiLU'd; g (decay) and beta (write strength) are\n// precomputed per (token,v-head) by deltanet_gate.\n//\n// Recurrence, per token t, per v-head h (from modeling_qwen3_next GatedDeltaNet):\n//   Sdec[i,j] = g_t * S[i,j]                    (scalar decay per head/step)\n//   kv[j]     = sum_i Sdec[i,j] * k[i]          (retrieve current key)\n//   err[j]    = v[j] - kv[j]\n//   S[i,j]    = Sdec[i,j] + k[i] * (beta_t * err[j])   (rank-1 write)\n//   o[j]      = (sum_i S[i,j] * q[i]) / sqrt(d_k)      (read-out)\n//\n// Parallelism: one thread per (v-head h, value-column j). Thread (h,j) owns column j of\n// head h's state \u2014 columns are disjoint across threads, so the update is race-free and the\n// per-token loop runs inside the thread with NO barriers. Grid = heads * head_dim threads.\n\nstruct SeqP {\n  n_tokens  : u32,\n  v_heads   : u32,   // num_v_heads (48)\n  k_heads   : u32,   // num_k_heads (16)\n  head_dim  : u32,   // d_k == d_v (128)\n  v_per_k   : u32,   // v_heads / k_heads (3)\n  _p0 : u32, _p1 : u32, _p2 : u32,\n};\n\n@group(0) @binding(0) var<storage, read>        q     : array<f32>;   // [n_tokens * k_heads * head_dim]\n@group(0) @binding(1) var<storage, read>        k     : array<f32>;   // [n_tokens * k_heads * head_dim]\n@group(0) @binding(2) var<storage, read>        v     : array<f32>;   // [n_tokens * v_heads * head_dim]\n@group(0) @binding(3) var<storage, read>        gdec  : array<f32>;   // [n_tokens * v_heads]\n@group(0) @binding(4) var<storage, read>        beta  : array<f32>;   // [n_tokens * v_heads]\n@group(0) @binding(5) var<storage, read_write>  state : array<f32>;   // [v_heads * head_dim * head_dim]\n@group(0) @binding(6) var<storage, read_write>  out   : array<f32>;   // [n_tokens * v_heads * head_dim]\n@group(0) @binding(7) var<uniform>              p     : SeqP;\n\n@compute @workgroup_size(64)\nfn main(@builtin(workgroup_id) wg_ : vec3<u32>,\n        @builtin(local_invocation_id) lid_ : vec3<u32>,\n        @builtin(num_workgroups) nwg_ : vec3<u32>) {\n  let d   = p.head_dim;\n  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.\n  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension\n  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to\n  // EXACTLY the old expression, so the working 27B numerics are untouched.\n  let idx = (wg_.x + wg_.y * nwg_.x) * 64u + lid_.x;\n  let total = p.v_heads * d;\n  if (idx >= total) { return; }\n\n  let h = idx / d;            // v-head\n  let j = idx % d;            // value column this thread owns\n  // Fork-verified GQA mapping: ggml_repeat_4d TILES cyclically (dst head i1*ne01+k1\n  // reads src head k1), so v-head h uses k-head (h % k_heads) - NOT h / v_per_k\n  // (interleave). The old mapping paired 32 of 48 v-heads with the wrong q/k.\n  let kh = h % p.k_heads;     // shared k/q head for this v-head (cyclic, fork parity)\n  let sbase = h * d * d;      // base of head h's [d\xD7d] state\n  let inv_scale = inverseSqrt(f32(d));\n\n  for (var t : u32 = 0u; t < p.n_tokens; t = t + 1u) {\n    let qb = (t * p.k_heads + kh) * d;\n    let vb = (t * p.v_heads + h) * d;\n    let g  = gdec[t * p.v_heads + h];\n    let b  = beta[t * p.v_heads + h];\n\n    // pass 1: kv[j] = sum_i (g*S[i,j]) * k[i]\n    var kv : f32 = 0.0;\n    for (var i : u32 = 0u; i < d; i = i + 1u) {\n      kv = kv + g * state[sbase + i * d + j] * k[qb + i];\n    }\n    let err = v[vb + j] - kv;\n\n    // pass 2: write S[:,j] and read out o[j] = (sum_i S_new[i,j] * q[i]) / sqrt(d)\n    var o : f32 = 0.0;\n    for (var i : u32 = 0u; i < d; i = i + 1u) {\n      let s_new = g * state[sbase + i * d + j] + k[qb + i] * (b * err);\n      state[sbase + i * d + j] = s_new;\n      o = o + s_new * q[qb + i];\n    }\n    out[vb + j] = o * inv_scale;\n  }\n}\n";
    ELEMENTWISE = `// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
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
`;
    ELEMENTWISE_INPLACE = "// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\n// \xA9 2026 Aitherium, LLC. Original work.\n// In-place elementwise (io = io OP b) \u2014 single read_write binding for the accumulator to\n// avoid the read/read_write aliasing WebGPU rejects. Pairs with elementwise.wgsl.\n// op: 0=add, 1=mul, 2=copy(no-op), 3=silu (unary: io = io*sigmoid(io), b ignored).\nstruct EW { n : u32, op : u32, _p0 : u32, _p1 : u32 };\n@group(0) @binding(0) var<storage, read_write> io : array<f32>;\n@group(0) @binding(1) var<storage, read>       b  : array<f32>;\n@group(0) @binding(2) var<uniform>             p  : EW;\n@compute @workgroup_size(256)\nfn main(@builtin(workgroup_id) wg_ : vec3<u32>,\n        @builtin(local_invocation_id) lid_ : vec3<u32>,\n        @builtin(num_workgroups) nwg_ : vec3<u32>) {\n  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.\n  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension\n  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to\n  // EXACTLY the old expression, so the working 27B numerics are untouched.\n  let i = (wg_.x + wg_.y * nwg_.x) * 256u + lid_.x;\n  if (i >= p.n) { return; }\n  switch (p.op) {\n    case 0u: { io[i] = io[i] + b[i]; }\n    case 1u: { io[i] = io[i] * b[i]; }\n    case 3u: { let z = io[i]; io[i] = z / (1.0 + exp(-z)); }   // SiLU\n    case 4u: { io[i] = io[i] / (1.0 + exp(-b[i])); }          // io *= sigmoid(b) (attn out-gate)\n    default: { }\n  }\n}\n";
    KV_QUANT_4BIT = `// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
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
`;
    LOGIT_TOPK = '// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\n// \xA9 2026 Aitherium, LLC. Original work.\n// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\n// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\n// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\n//\n// SELECT THE TOP-K LOGITS ON THE GPU, so decode stops shipping the whole vocabulary to the\n// host every single token.\n//\n// \u2500\u2500 WHY (measured 2026-07-31) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// sampleToken() read back the ENTIRE logits row \u2014 vocab 248,320 x 4 B \u2248 993 KB \u2014 per token,\n// then picked the top-k in JS. Once the attention kernel was parallelised, that readback\n// became the single largest cost in the decode loop. Splitting the sample phase into its two\n// halves settled which half, and it was not the half the code comments worried about:\n//\n//     sample=83.9ms  [readback=83.4ms  select=0.4ms]     (4B, 1285-token context)\n//\n// The JS selection pass over a quarter-million floats costs FOUR TENTHS of a millisecond.\n// The transfer around it costs two hundred times that, and it scales with nothing useful \u2014\n// it is the same 993 KB whether the answer is one token or a thousand. So the fix is not a\n// better loop, it is to stop moving the data: select on the device and return a few hundred\n// bytes. Pooling the staging buffer first was tried and did NOT move the number.\n//\n// \u2500\u2500 HOW, AND WHY IT IS EXACT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// A parallel exact top-k is awkward in WGSL (no cross-workgroup reduction primitive), and a\n// per-block top-1 is NOT exact \u2014 the whole top-k can live inside one block. So: threshold,\n// then gather.\n//\n//   pass 1 `hist`   \u2014 histogram every logit into NBINS bins over a FIXED logit range.\n//                     Fixed, so no max-reduction pass is needed first; out-of-range values\n//                     clamp into the end bins, which keeps them findable rather than lost.\n//   host            \u2014 read NBINS u32 (4 KB), walk from the top bin down accumulating counts\n//                     until at least K have been seen. That bin\'s lower edge is a threshold\n//                     T with a PROVEN property: at least K logits are >= T.\n//   pass 2 `gather` \u2014 append every (index, value) with value >= T into a compact list via an\n//                     atomic counter. Read back only the counter and that list.\n//\n// Every logit >= T is collected, and at least K logits are >= T, so the true top-K is a\n// SUBSET of what comes back. The host then does an exact top-k over a few hundred candidates\n// instead of 248,320 \u2014 the same code that already cost 0.4 ms, now on a smaller input.\n//\n// OVERFLOW IS NOT SILENTLY WRONG. If more candidates clear T than the output can hold, the\n// gather writes what fits and the counter keeps counting, so the host sees count > capacity\n// and FALLS BACK to the full readback. That is slow and correct, which is the right way\n// round; dropping candidates would silently change which token is sampled, and a sampling\n// bug reads as the model being dumb rather than as a bug.\n\nstruct TopKP {\n  vocab      : u32,\n  n_bins     : u32,\n  lo         : f32,   // histogram range, in logit units\n  hi         : f32,\n  threshold  : f32,   // gather: keep values >= this (ignored by the hist entry point)\n  capacity   : u32,   // gather: max pairs the output buffers can hold\n  _p0 : u32, _p1 : u32,\n};\n\n@group(0) @binding(0) var<storage, read>        logits  : array<f32>;\n@group(0) @binding(1) var<storage, read_write>  hist    : array<atomic<u32>>;\n@group(0) @binding(2) var<storage, read_write>  out_idx : array<u32>;\n@group(0) @binding(3) var<storage, read_write>  out_val : array<f32>;\n// [0] = number of candidates that cleared the threshold, INCLUDING any that did not fit.\n@group(0) @binding(4) var<storage, read_write>  counter : array<atomic<u32>>;\n@group(0) @binding(5) var<uniform>              p       : TopKP;\n\n// One thread per logit. 256 is a safe workgroup size everywhere (the spec guarantees 256).\nconst WG : u32 = 256u;\n\n/** Bin index for a logit value: bin 0 is the TOP of the range, so walking bins in ascending\n *  order walks logits in DESCENDING order \u2014 which is the direction the host needs. */\nfn bin_of(v : f32) -> u32 {\n  let span = max(p.hi - p.lo, 1e-6);\n  // Fraction from the TOP of the range.\n  let f = (p.hi - v) / span;\n  let b = i32(floor(f * f32(p.n_bins)));\n  // Clamp rather than discard: a logit above `hi` belongs in the top bin and a logit below\n  // `lo` in the bottom one. Discarding out-of-range values would make the count wrong, and\n  // the threshold derived from it wrong, in the one case that matters most \u2014 an unusually\n  // confident token sitting above the assumed range.\n  return u32(clamp(b, 0, i32(p.n_bins) - 1));\n}\n\n@compute @workgroup_size(256)\nfn hist_main(@builtin(global_invocation_id) gid : vec3<u32>,\n             @builtin(num_workgroups) nwg : vec3<u32>) {\n  // Grid-stride, so the dispatch size does not have to divide the vocabulary and a 2-D\n  // workgroup grid (dispatch1D folds past 65535) still covers every element exactly once.\n  let stride = nwg.x * nwg.y * WG;\n  let start = gid.x + gid.y * nwg.x * WG;\n  var i = start;\n  loop {\n    if (i >= p.vocab) { break; }\n    atomicAdd(&hist[bin_of(logits[i])], 1u);\n    i = i + stride;\n  }\n}\n\n@compute @workgroup_size(256)\nfn gather_main(@builtin(global_invocation_id) gid : vec3<u32>,\n               @builtin(num_workgroups) nwg : vec3<u32>) {\n  let stride = nwg.x * nwg.y * WG;\n  let start = gid.x + gid.y * nwg.x * WG;\n  var i = start;\n  loop {\n    if (i >= p.vocab) { break; }\n    let v = logits[i];\n    if (v >= p.threshold) {\n      // The counter is incremented even when the slot does not fit, so the host can tell\n      // "collected everything" from "there were more than we could hold" and fall back.\n      let slot = atomicAdd(&counter[0], 1u);\n      if (slot < p.capacity) {\n        out_idx[slot] = i;\n        out_val[slot] = v;\n      }\n    }\n    i = i + stride;\n  }\n}\n';
    Q1_0_DEQUANT = `// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
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
`;
    Q1_0_Q8_0_MATMUL = `// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
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
`;
    Q2_0_DEQUANT = `// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
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
`;
    Q2_0_Q8_0_MATMUL = `// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
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
`;
    QUANTIZE_Q8_0 = `// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
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
`;
    RMSNORM = `// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
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
`;
    ROPE_IMROPE = `// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
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
`;
    SAMPLING = '// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\n// \xA9 2026 Aitherium, LLC. Original work.\n// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\n// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\n// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\n// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"\n//   - temperature / top-k / top-p sampling (card defaults temp 0.7, top-k 20, top-p 0.95)\n//\n// v1 strategy: this kernel computes the argmax fast path (temp ~ 0) and a temperature-\n// scaled max for numerical stability; full top-k/top-p nucleus truncation is done on the\n// host over the reduced candidate set for v1 (simpler + exact), with a GPU bitonic top-k\n// as the follow-up optimisation. Runs over the final logits row (~151K vocab).\n\nstruct SampleP { vocab : u32, temperature : f32, _p0 : u32, _p1 : u32 };\n\n@group(0) @binding(0) var<storage, read>       logits  : array<f32>;   // [vocab]\n@group(0) @binding(1) var<storage, read_write> argmax  : array<u32>;   // [1] best token id\n@group(0) @binding(2) var<storage, read_write> maxval  : array<f32>;   // [1] max logit\n@group(0) @binding(3) var<uniform>             p       : SampleP;\n\nconst WG : u32 = 256u;\nvar<workgroup> best_val : array<f32, WG>;\nvar<workgroup> best_idx : array<u32, WG>;\n\n@compute @workgroup_size(WG)\nfn main(@builtin(local_invocation_id) lid : vec3<u32>) {\n  let tid = lid.x;\n  var bv : f32 = -3.0e38;\n  var bi : u32 = 0u;\n  var i : u32 = tid;\n  loop {\n    if (i >= p.vocab) { break; }\n    let l = logits[i];\n    if (l > bv) { bv = l; bi = i; }\n    i = i + WG;\n  }\n  best_val[tid] = bv;\n  best_idx[tid] = bi;\n  workgroupBarrier();\n\n  var stride : u32 = WG >> 1u;\n  loop {\n    if (stride == 0u) { break; }\n    if (tid < stride) {\n      if (best_val[tid + stride] > best_val[tid]) {\n        best_val[tid] = best_val[tid + stride];\n        best_idx[tid] = best_idx[tid + stride];\n      }\n    }\n    workgroupBarrier();\n    stride = stride >> 1u;\n  }\n\n  if (tid == 0u) {\n    argmax[0] = best_idx[0];\n    maxval[0] = best_val[0];\n  }\n}\n';
    SOFTMAX_ATTN = '// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\n// \xA9 2026 Aitherium, LLC. Original work.\n// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\n// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\n// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\n// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"\n//   - scaled-dot-product attention with causal mask + GQA (head_count / head_count_kv).\n//\n// Full-attention layers (16 of 64). Online (flash-style) softmax to bound memory over\n// long context. One workgroup per (query token, query head). K/V read from the 4-bit KV\n// cache and dequantized inline (see kvcache.ts / elementwise KV unpack helpers).\n// v1: f32 K/V input path (dequant done host/pre-pass); 4-bit inline unpack is a follow-up.\n\nstruct AttnP {\n  head_dim   : u32,\n  n_kv       : u32,   // number of cached keys (context length so far)\n  q_head     : u32,   // this query head index\n  kv_head    : u32,   // mapped KV head (GQA: q_head / (n_head/n_head_kv))\n  scale      : f32,   // 1/sqrt(head_dim)\n  _p0 : u32, _p1 : u32, _p2 : u32,\n};\n\n@group(0) @binding(0) var<storage, read>       q  : array<f32>;   // [head_dim] for this query\n@group(0) @binding(1) var<storage, read>       k  : array<f32>;   // [n_kv * head_dim]\n@group(0) @binding(2) var<storage, read>       v  : array<f32>;   // [n_kv * head_dim]\n@group(0) @binding(3) var<storage, read_write> out : array<f32>;  // [head_dim]\n@group(0) @binding(4) var<uniform>             p   : AttnP;\n\n@compute @workgroup_size(1)\nfn main() {\n  let hd = p.head_dim;\n\n  // online softmax accumulators\n  var m : f32 = -3.0e38;             // running max\n  var l : f32 = 0.0;                 // running denom\n  var acc : array<f32, 256>;         // running weighted V (head_dim <= 256)\n  for (var d : u32 = 0u; d < hd; d = d + 1u) { acc[d] = 0.0; }\n\n  for (var t : u32 = 0u; t < p.n_kv; t = t + 1u) {\n    // score = scale * dot(q, k_t)\n    var s : f32 = 0.0;\n    let kb = t * hd;\n    for (var d : u32 = 0u; d < hd; d = d + 1u) { s = s + q[d] * k[kb + d]; }\n    s = s * p.scale;\n\n    let m_new = max(m, s);\n    let correction = exp(m - m_new);\n    let w = exp(s - m_new);\n    l = l * correction + w;\n    let vb = t * hd;\n    for (var d : u32 = 0u; d < hd; d = d + 1u) {\n      acc[d] = acc[d] * correction + w * v[vb + d];\n    }\n    m = m_new;\n  }\n\n  let inv = select(0.0, 1.0 / l, l > 0.0);\n  for (var d : u32 = 0u; d < hd; d = d + 1u) { out[d] = acc[d] * inv; }\n}\n';
    SOFTMAX_ATTN_BATCHED = "// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\n// \xA9 2026 Aitherium, LLC. Original work.\n// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\n// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\n// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\n//\n// Batched causal GQA softmax attention \u2014 the WHOLE (token \xD7 head) grid in ONE dispatch,\n// reading Q/K/V straight from the resident buffers. Replaces the per-(token,head) host loop\n// that submitted ~n_tokens\xB7n_heads\xB73 GPU commands per layer (the dominant prefill cost).\n// One WORKGROUP per (query token, query head); online (flash-style) softmax over the causal\n// key range. GQA maps each query head to kv_head = q_head / (n_heads / n_heads_kv).\n//\n//   q       : [n_tokens \xB7 n_heads   \xB7 head_dim]   (this batch's queries, post-RoPE)\n//   k_cache : [kv_len   \xB7 n_heads_kv \xB7 head_dim]  (all keys so far, incl. this batch)\n//   v_cache : [kv_len   \xB7 n_heads_kv \xB7 head_dim]\n//   out     : [n_tokens \xB7 n_heads   \xB7 head_dim]\n// Causal: query at absolute position (pos_base + t) attends to cache positions [0, pos_base+t].\n//\n// \u2500\u2500 WHY THIS IS PARALLEL OVER head_dim (measured 2026-07-31) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// This kernel was `@workgroup_size(1)`: ONE GPU thread per (token, head), walking the entire\n// KV cache serially and reading head_dim floats one at a time. For a DECODE step n_tokens is\n// 1, so the whole dispatch was n_heads threads \u2014 32 of a 5090's 21,760 lanes \u2014 each doing\n// kv_len\xB7head_dim\xB72 serial scalar ops, per layer, per token. Cost was therefore LINEAR in\n// context length with a ~1-lane constant, and every read was strided by head_dim (one lane\n// touching a whole cache line and using 4 bytes of it).\n//\n// That is invisible until the prompt grows. Measured on Bonsai-4B, same box, same session:\n//\n//     prompt tokens   forward/token   tok/s\n//     20              111 ms          7.6\n//     169             ~128 ms         7.8\n//     1285            646 ms          1.0        <- the shipped greeter prompt\n//\n// The greeter sends its framing plus getToolDefinitions() \u2014 1290 tokens \u2014 so aitherium.com\n// visitors were getting ~1 tok/s while the microbenchmark (a 20-token prompt) reported 7.6\n// and the engine was blamed. NOTHING regressed in this file; the prompt crossed the point\n// where an O(kv_len) single-lane loop dominates the 545 MB of weight matmuls around it.\n//\n// So: one workgroup per (token, head), WG threads cooperating over head_dim.\n//   - thread `tid` owns dims {tid, tid+WG, \u2026}, keeping q and the output accumulator in\n//     REGISTERS (never workgroup storage \u2014 head_dim\xB7WG floats would blow the 16 KB\n//     guaranteed workgroup-storage limit; only the WG-float reduction scratch lives there).\n//   - at each position the q\xB7k dot product is a tree reduction across the workgroup, so\n//     adjacent threads read ADJACENT k_cache/v_cache elements \u2014 coalesced, one cache line\n//     serving the whole warp instead of one lane.\n// The position loop stays serial and in the same order, which is what keeps the online\n// softmax exact; only the dot product's summation order changes (sequential -> tree), and a\n// tree reduction is no less accurate than the sequential sum it replaces. Correctness is\n// gated by the whole-model GPU-vs-CPU differential in selftest/, which requires argmax\n// agreement \u2014 an attention bug corrupts every downstream logit and shows up there.\n\nstruct BAttnP {\n  n_tokens   : u32,\n  n_heads    : u32,\n  n_heads_kv : u32,\n  head_dim   : u32,\n  pos_base   : u32,   // absolute position of this batch's first token\n  scale      : f32,   // 1/sqrt(head_dim)\n  mode : u32, _p1 : u32,   // mode: 0 = f32 cache (default), 1 = 4-bit packed cache\n};\n\n@group(0) @binding(0) var<storage, read>       q          : array<f32>;\n@group(0) @binding(1) var<storage, read>       k_cache    : array<u32>;\n@group(0) @binding(2) var<storage, read>       v_cache    : array<u32>;\n@group(0) @binding(3) var<storage, read_write> out        : array<f32>;\n@group(0) @binding(4) var<uniform>             p          : BAttnP;\n// 4-bit mode only (mode==1): per-(pos,kv_head) f16 scales, one u32 per row (f16 in low 16\n// bits). In f32 mode these are 4-byte DUMMY buffers, always bound but NEVER indexed \u2014 the\n// uniform `if (p.mode == 1u)` guard is what keeps them unread, because `select()` would\n// evaluate both operands and index them OOB at large positions.\n@group(0) @binding(5) var<storage, read> k_scale_buf : array<u32>;\n@group(0) @binding(6) var<storage, read> v_scale_buf : array<u32>;\n\n// 4-bit dequant read. mode==1: element e (row-aligned, head_dim%8==0 asserted on the host)\n// is a NIBBLE: word e>>3, nibble e&7, value (raw-8)*scale. mode==0: the buffer holds raw\n// f32 bytes and bitcast reinterprets them \u2014 byte-identical to the historical array<f32>\n// binding. The scale is passed in, never re-fetched here.\nfn readK(mode : u32, e : u32, scale : f32) -> f32 {\n  if (mode == 1u) {\n    let w = e >> 3u;\n    let n = e & 7u;\n    let raw = (k_cache[w] >> (n * 4u)) & 0xFu;\n    return (f32(raw) - 8.0) * scale;\n  }\n  return bitcast<f32>(k_cache[e]);\n}\nfn readV(mode : u32, e : u32, scale : f32) -> f32 {\n  if (mode == 1u) {\n    let w = e >> 3u;\n    let n = e & 7u;\n    let raw = (v_cache[w] >> (n * 4u)) & 0xFu;\n    return (f32(raw) - 8.0) * scale;\n  }\n  return bitcast<f32>(v_cache[e]);\n}\n\n// 128 lanes: WebGPU GUARANTEES maxComputeInvocationsPerWorkgroup >= 256 and\n// maxComputeWorkgroupSizeX >= 256, so this is portable, and it equals head_dim on every\n// Bonsai size (1.7B/4B/8B/27B all use 128) \u2014 i.e. exactly one dim per lane, no tail.\nconst WG : u32 = 128u;\n// head_dim <= 256 (asserted by the host), so at most 2 dims per lane.\nconst DPT : u32 = 2u;\n\n// Reduction scratch: WG floats = 512 bytes, far under the 16 KB guaranteed limit.\nvar<workgroup> red : array<f32, 128>;\n\n@compute @workgroup_size(128)\nfn main(@builtin(workgroup_id) wg_ : vec3<u32>,\n        @builtin(local_invocation_id) lid_ : vec3<u32>,\n        @builtin(num_workgroups) nwg_ : vec3<u32>) {\n  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.\n  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension\n  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to\n  // wg_.x. The index is now the WORKGROUP's, not the invocation's: the whole workgroup\n  // cooperates on one (token, head).\n  let idx = wg_.x + wg_.y * nwg_.x;\n  let total = p.n_tokens * p.n_heads;\n  // UNIFORM across the workgroup (it depends only on workgroup_id), so returning here before\n  // the barriers below is legal \u2014 a non-uniform early return would be undefined behaviour.\n  if (idx >= total) { return; }\n\n  let tid = lid_.x;\n  let hd  = p.head_dim;\n  let t   = idx / p.n_heads;         // query token in this batch\n  let h   = idx % p.n_heads;         // query head\n  let kv_head = h / (p.n_heads / p.n_heads_kv);\n\n  let q_base = (t * p.n_heads + h) * hd;\n  let kv_per_pos = p.n_heads_kv * hd;\n  let last = p.pos_base + t;         // inclusive causal limit\n\n  // This lane's slice of q and of the output accumulator, held in registers.\n  var qv  : array<f32, 2>;\n  var acc : array<f32, 2>;\n  for (var i : u32 = 0u; i < DPT; i = i + 1u) {\n    let d = tid + i * WG;\n    qv[i]  = select(0.0, q[q_base + d], d < hd);\n    acc[i] = 0.0;\n  }\n\n  // online softmax accumulators \u2014 identical algebra to the scalar version, and every lane\n  // carries the same m/l because they all consume the same reduced score.\n  var m : f32 = -3.0e38;\n  var l : f32 = 0.0;\n\n  for (var pos : u32 = 0u; pos <= last; pos = pos + 1u) {\n    // Per-(pos,kv_head) f16 scales, fetched ONCE per position. The `if` is a uniform branch\n    // (the same value for every lane in the workgroup), so it cannot diverge a barrier; it\n    // is deliberately NOT a `select()`, which would read the dummy 4-byte scale buffer OOB\n    // in f32 mode once sIdx grows past element 0.\n    var kScale : f32 = 0.0;\n    var vScale : f32 = 0.0;\n    if (p.mode == 1u) {\n      let sIdx = pos * p.n_heads_kv + kv_head;\n      kScale = unpack2x16float(k_scale_buf[sIdx]).x;\n      vScale = unpack2x16float(v_scale_buf[sIdx]).x;\n    }\n    let k_base = pos * kv_per_pos + kv_head * hd;\n    var part : f32 = 0.0;\n    for (var i : u32 = 0u; i < DPT; i = i + 1u) {\n      let d = tid + i * WG;\n      if (d < hd) { part = part + qv[i] * readK(p.mode, k_base + d, kScale); }\n    }\n    red[tid] = part;\n    workgroupBarrier();\n\n    // Tree reduction. The barrier is OUTSIDE the `if`, because a barrier inside non-uniform\n    // control flow is undefined behaviour; the trip count is a constant so every lane runs\n    // the same number of iterations.\n    var stride : u32 = WG / 2u;\n    loop {\n      if (stride == 0u) { break; }\n      if (tid < stride) { red[tid] = red[tid] + red[tid + stride]; }\n      workgroupBarrier();\n      stride = stride / 2u;\n    }\n\n    let s = red[0] * p.scale;\n\n    let m_new = max(m, s);\n    let corr  = exp(m - m_new);\n    let w     = exp(s - m_new);\n    l = l * corr + w;\n    let v_base = pos * kv_per_pos + kv_head * hd;\n    for (var i : u32 = 0u; i < DPT; i = i + 1u) {\n      let d = tid + i * WG;\n      if (d < hd) { acc[i] = acc[i] * corr + w * readV(p.mode, v_base + d, vScale); }\n    }\n    m = m_new;\n\n    // Every lane has now READ red[0]; without this the next iteration's `red[tid] = part`\n    // could overwrite it while a slower lane is still reading. Silent wrong scores, not a\n    // crash \u2014 the failure mode this whole file exists to avoid.\n    workgroupBarrier();\n  }\n\n  let inv = select(0.0, 1.0 / l, l > 0.0);\n  for (var i : u32 = 0u; i < DPT; i = i + 1u) {\n    let d = tid + i * WG;\n    if (d < hd) { out[q_base + d] = acc[i] * inv; }\n  }\n}\n";
    SWIGLU = `// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
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
`;
    VAE_OPS = "// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\n// \xA9 2026 Aitherium, LLC. Original work.\n// Original Aitherium WebGPU implementation.\n//\n// THE THREE OPS THE VAE DECODER NEEDS AND THE TRANSFORMER DOES NOT.\n//\n// In-browser image generation was written off as needing a foreign kernel family. It does\n// not. `:8798` serves FLUX.2 Klein 4B, and the giveaway is in its own tensor names \u2014\n// `transformer_blocks.0.attn.to_q` \u2014 MMDiT is a diffusion TRANSFORMER: attention + MLP over\n// latent patches, which the existing kernels already do. Its text encoder is Qwen3-4B, the\n// same architecture family as the Bonsai text models that already run in a visitor's browser.\n//\n// What genuinely has no equivalent is the VAE DECODER, and only three ops of it. From the\n// shipped model's own vae/config.json (AutoencoderKLFlux2):\n//\n//     block_out_channels : [128, 256, 512, 512]\n//     up_block_types     : 4 x UpDecoderBlock2D\n//     layers_per_block   : 2\n//     latent_channels    : 32\n//     norm_num_groups    : 32\n//     act_fn             : silu\n//\n// so the decode graph is: conv_in -> mid(resnet + attn) -> 4 x (2 resnets + 2x upsample)\n// -> GroupNorm -> SiLU -> conv_out(3ch). Attention and SiLU already exist. These are the rest.\n//\n// LAYOUT: NCHW, f32, batch 1 \u2014 one image at a time is what a browser does, and NCHW keeps a\n// channel's plane contiguous, which is what makes GroupNorm's reduction a simple range.\n//\n// PERFORMANCE NOTE, learned the expensive way on softmax_attn_batched: a kernel written as\n// one-thread-per-output looks fine and silently becomes the bottleneck when the tensor grows.\n// The last up block runs at full output resolution, so at 1024x1024x128 that is 134M outputs.\n// conv2d here is one thread per OUTPUT ELEMENT with the reduction inside it \u2014 correct, and\n// deliberately the simple version first, because the transformer kernels earned their\n// optimisations only after a CPU differential proved them right. Optimise after it is correct\n// and after a measurement says which part is slow, not before.\n\nstruct ConvP {\n  in_c   : u32,\n  out_c  : u32,\n  h      : u32,   // input height\n  w      : u32,   // input width\n  k      : u32,   // square kernel size (1 or 3 here)\n  pad    : u32,\n  stride : u32,\n  _p0    : u32,\n};\n\n@group(0) @binding(0) var<storage, read>       x       : array<f32>;  // [in_c*h*w]\n@group(0) @binding(1) var<storage, read>       weight  : array<f32>;  // [out_c*in_c*k*k]\n@group(0) @binding(2) var<storage, read>       bias    : array<f32>;  // [out_c]\n@group(0) @binding(3) var<storage, read_write> y       : array<f32>;  // [out_c*oh*ow]\n@group(0) @binding(4) var<uniform>             p       : ConvP;\n\nfn out_h() -> u32 { return (p.h + 2u * p.pad - p.k) / p.stride + 1u; }\nfn out_w() -> u32 { return (p.w + 2u * p.pad - p.k) / p.stride + 1u; }\n\n/**\n * 2-D convolution, NCHW, one thread per output element.\n *\n * Zero padding is done by SKIPPING out-of-range taps rather than by materialising a padded\n * input. Materialising would allocate another full tensor per layer \u2014 at decoder resolutions\n * that is hundreds of megabytes of pure copy, on a device that is also holding a language\n * model.\n */\n@compute @workgroup_size(64)\nfn conv2d_main(@builtin(global_invocation_id) gid : vec3<u32>,\n               @builtin(num_workgroups) nwg : vec3<u32>) {\n  let oh = out_h();\n  let ow = out_w();\n  let total = p.out_c * oh * ow;\n  let idx = gid.x + gid.y * nwg.x * 64u;\n  if (idx >= total) { return; }\n\n  let ox = idx % ow;\n  let oy = (idx / ow) % oh;\n  let oc = idx / (ow * oh);\n\n  var acc : f32 = bias[oc];\n  for (var ic : u32 = 0u; ic < p.in_c; ic = ic + 1u) {\n    let x_plane = ic * p.h * p.w;\n    let w_base = ((oc * p.in_c) + ic) * p.k * p.k;\n    for (var ky : u32 = 0u; ky < p.k; ky = ky + 1u) {\n      // Signed arithmetic: with pad=1 the first row's taps land at -1, and doing this in\n      // u32 wraps to ~4 billion and reads far out of bounds. WebGPU's robust access would\n      // return 0 there, which LOOKS like correct zero-padding and is not \u2014 it silently\n      // drops the real taps too on the opposite edge.\n      let iy = i32(oy * p.stride) + i32(ky) - i32(p.pad);\n      if (iy < 0 || iy >= i32(p.h)) { continue; }\n      for (var kx : u32 = 0u; kx < p.k; kx = kx + 1u) {\n        let ix = i32(ox * p.stride) + i32(kx) - i32(p.pad);\n        if (ix < 0 || ix >= i32(p.w)) { continue; }\n        acc = acc + x[x_plane + u32(iy) * p.w + u32(ix)] * weight[w_base + ky * p.k + kx];\n      }\n    }\n  }\n  y[idx] = acc;\n}\n\nstruct GroupNormP {\n  c       : u32,\n  h       : u32,\n  w       : u32,\n  groups  : u32,\n  eps     : f32,\n  _p0 : u32, _p1 : u32, _p2 : u32,\n};\n\n@group(0) @binding(0) var<storage, read>       gx      : array<f32>;\n@group(0) @binding(1) var<storage, read>       gamma   : array<f32>;  // [c]\n@group(0) @binding(2) var<storage, read>       beta    : array<f32>;  // [c]\n@group(0) @binding(3) var<storage, read_write> gy      : array<f32>;\n@group(0) @binding(4) var<uniform>             gp      : GroupNormP;\n\n/**\n * GroupNorm \u2014 one WORKGROUP per group, cooperating over that group's whole slab.\n *\n * NOT one thread per group. A group at decoder sizes is (c/groups) x h x w elements \u2014 with\n * 128 channels, 32 groups and a 512x512 plane that is over a million values, and a single\n * thread walking it is the same one-lane mistake that made attention 8x slower than it had\n * to be. The mean and variance are a parallel reduction; the normalise pass is grid-strided.\n *\n * Two passes over the slab (mean, then variance) rather than the sum/sum-of-squares trick:\n * at f32 with a million-element reduction the one-pass form loses precision exactly where\n * the variance is small, which is where a VAE's activations live.\n */\nvar<workgroup> red_sum : array<f32, 256>;\n\n@compute @workgroup_size(256)\nfn groupnorm_main(@builtin(workgroup_id) wg : vec3<u32>,\n                  @builtin(local_invocation_id) lid : vec3<u32>) {\n  let g = wg.x;\n  if (g >= gp.groups) { return; }        // uniform across the workgroup \u2014 safe with barriers\n\n  let cpg = gp.c / gp.groups;            // channels per group\n  let plane = gp.h * gp.w;\n  let slab = cpg * plane;                // elements this group owns\n  let base = g * slab;\n  let tid = lid.x;\n\n  // ---- mean ----\n  var s : f32 = 0.0;\n  var i : u32 = tid;\n  loop {\n    if (i >= slab) { break; }\n    s = s + gx[base + i];\n    i = i + 256u;\n  }\n  red_sum[tid] = s;\n  workgroupBarrier();\n  var stride : u32 = 128u;\n  loop {\n    if (stride == 0u) { break; }\n    if (tid < stride) { red_sum[tid] = red_sum[tid] + red_sum[tid + stride]; }\n    workgroupBarrier();\n    stride = stride / 2u;\n  }\n  let mean = red_sum[0] / f32(slab);\n  workgroupBarrier();\n\n  // ---- variance ----\n  var v : f32 = 0.0;\n  i = tid;\n  loop {\n    if (i >= slab) { break; }\n    let d = gx[base + i] - mean;\n    v = v + d * d;\n    i = i + 256u;\n  }\n  red_sum[tid] = v;\n  workgroupBarrier();\n  stride = 128u;\n  loop {\n    if (stride == 0u) { break; }\n    if (tid < stride) { red_sum[tid] = red_sum[tid] + red_sum[tid + stride]; }\n    workgroupBarrier();\n    stride = stride / 2u;\n  }\n  let inv_std = 1.0 / sqrt(red_sum[0] / f32(slab) + gp.eps);\n  workgroupBarrier();\n\n  // ---- normalise + per-CHANNEL affine ----\n  // gamma/beta are indexed by absolute channel, not by group: a group spans cpg channels and\n  // each has its own scale. Using the group index here is an easy and completely silent\n  // error \u2014 the image comes out plausible and wrong.\n  i = tid;\n  loop {\n    if (i >= slab) { break; }\n    let ch = g * cpg + (i / plane);\n    gy[base + i] = (gx[base + i] - mean) * inv_std * gamma[ch] + beta[ch];\n    i = i + 256u;\n  }\n}\n\nstruct UpP {\n  c : u32,\n  h : u32,\n  w : u32,\n  scale : u32,\n};\n\n@group(0) @binding(0) var<storage, read>       ux : array<f32>;\n@group(0) @binding(1) var<storage, read_write> uy : array<f32>;\n@group(0) @binding(2) var<uniform>             up : UpP;\n\n/**\n * Nearest-neighbour upsample by an integer factor \u2014 what UpDecoderBlock2D does before its\n * convolution (diffusers' Upsample2D default is nearest, and the conv that follows is what\n * turns the blockiness into detail). Bilinear here would be a different model.\n */\n@compute @workgroup_size(64)\nfn upsample_nearest_main(@builtin(global_invocation_id) gid : vec3<u32>,\n                         @builtin(num_workgroups) nwg : vec3<u32>) {\n  let oh = up.h * up.scale;\n  let ow = up.w * up.scale;\n  let total = up.c * oh * ow;\n  let idx = gid.x + gid.y * nwg.x * 64u;\n  if (idx >= total) { return; }\n\n  let ox = idx % ow;\n  let oy = (idx / ow) % oh;\n  let ch = idx / (ow * oh);\n\n  let sx = ox / up.scale;\n  let sy = oy / up.scale;\n  uy[idx] = ux[ch * up.h * up.w + sy * up.w + sx];\n}\n";
    WGSL_SOURCES = {
      "causal_conv1d": CAUSAL_CONV1D,
      "deltanet": DELTANET,
      "deltanet_gate": DELTANET_GATE,
      "deltanet_seq": DELTANET_SEQ,
      "elementwise": ELEMENTWISE,
      "elementwise_inplace": ELEMENTWISE_INPLACE,
      "kv_quant_4bit": KV_QUANT_4BIT,
      "logit_topk": LOGIT_TOPK,
      "q1_0_dequant": Q1_0_DEQUANT,
      "q1_0_q8_0_matmul": Q1_0_Q8_0_MATMUL,
      "q2_0_dequant": Q2_0_DEQUANT,
      "q2_0_q8_0_matmul": Q2_0_Q8_0_MATMUL,
      "quantize_q8_0": QUANTIZE_Q8_0,
      "rmsnorm": RMSNORM,
      "rope_imrope": ROPE_IMROPE,
      "sampling": SAMPLING,
      "softmax_attn": SOFTMAX_ATTN,
      "softmax_attn_batched": SOFTMAX_ATTN_BATCHED,
      "swiglu": SWIGLU,
      "vae_ops": VAE_OPS
    };
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/model/kv_f32.ts
var kv_f32_exports = {};
__export(kv_f32_exports, {
  F32KvCache: () => F32KvCache
});
var F32KvCache;
var init_kv_f32 = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/model/kv_f32.ts"() {
    "use strict";
    init_gpu_min();
    init_dispatch();
    F32KvCache = class {
      // headCountKv * headDim
      constructor(device, cfg) {
        this.device = device;
        this.cfg = cfg;
        this.layers = /* @__PURE__ */ new Map();
        this.capacity = cfg.capacity;
        this.perPos = cfg.headCountKv * cfg.headDim;
        const totalElems = this.capacity * this.perPos;
        const bytes = totalElems * 4;
        for (const l of cfg.fullAttnLayers) {
          this.layers.set(l, {
            k: this.alloc(bytes, `kv_f32.k.${l}`),
            v: this.alloc(bytes, `kv_f32.v.${l}`),
            length: 0
          });
        }
      }
      alloc(bytes, label) {
        return this.device.createBuffer({
          size: Math.max(4, bytes),
          usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
          label
        });
      }
      layer(index) {
        const l = this.layers.get(index);
        if (!l) throw new Error(`bonsai-kv_f32: layer ${index} has no F32 KV cache (not a full-attn layer)`);
        return l;
      }
      /**
       * Append nTok positions worth of f32 K/V data to a layer.
       * kF32 and vF32 must be [nTok * headCountKv * headDim] f32 buffers.
       * This advances the layer's internal length; does NOT advance the global KvCache.
       * kSrcOffset and vSrcOffset allow extracting a slice from the source buffers (in bytes).
       */
      append(layer, kF32, vF32, nTok, kSrcOffset = 0, vSrcOffset = 0) {
        const l = this.layers.get(layer);
        if (!l) throw new Error(`bonsai-kv_f32: layer ${layer} has no F32 KV cache`);
        if (l.length + nTok > this.capacity) {
          throw new Error(
            `bonsai-kv_f32: layer ${layer} capacity ${this.capacity} exceeded (length=${l.length}, append=${nTok})`
          );
        }
        const offsetElems = l.length * this.perPos;
        const offsetBytes = offsetElems * 4;
        const nElems = nTok * this.perPos;
        const nBytes = nElems * 4;
        const tgt = beginCopies(this.device);
        tgt.enc.copyBufferToBuffer(kF32, kSrcOffset, l.k, offsetBytes, nBytes);
        tgt.enc.copyBufferToBuffer(vF32, vSrcOffset, l.v, offsetBytes, nBytes);
        finishCopies(this.device, tgt);
        l.length += nTok;
      }
      /**
       * Global position advance. forward.ts (prefill/decodeStep) calls this once after the
       * block loop. For the F32 cache each full-attn layer's length is already advanced by
       * append() (see its docstring), so this is a no-op — present for interface parity with
       * the 4-bit KvCache so the forward-pass orchestration runs end-to-end.
       */
      advance(_nTok) {
      }
      /**
       * The filled length shared by EVERY full-attention layer.
       *
       * Layers advance independently (append() bumps each one as its block runs), so
       * they are only ever equal because every layer sees every token. If they ever
       * disagree, some layer silently skipped or double-counted a position and its
       * attention is reading a different history from its neighbours' — fluent, wrong
       * output with nothing in the logs. Cross-turn reuse depends on there being ONE
       * true length, so this asserts that rather than trusting layer 0.
       */
      filledLength() {
        let seen = null;
        for (const [idx, l] of this.layers) {
          if (seen === null) seen = l.length;
          else if (l.length !== seen) {
            throw new Error(
              `bonsai-kv_f32: layers disagree on filled length (layer ${idx}=${l.length}, expected ${seen}) \u2014 the KV cache is inconsistent`
            );
          }
        }
        return seen ?? 0;
      }
      /** Get the current filled length for a layer. */
      currentLength(layer) {
        const l = this.layers.get(layer);
        if (!l) throw new Error(`bonsai-kv_f32: layer ${layer} has no F32 KV cache`);
        return l.length;
      }
      /** Reset all layer lengths to 0 at the start of a generation. */
      reset() {
        for (const l of this.layers.values()) {
          l.length = 0;
        }
      }
      /**
       * Keep the first `n` positions and drop the rest — cross-turn prefix reuse.
       *
       * Exact for attention, because position t's K/V depend only on token t: the
       * surviving entries are bit-identical to what a fresh prefill of that prefix
       * would write. Nothing is zeroed, matching reset(): the buffers past `n` are
       * simply unreachable, since attention reads only [0, length).
       *
       * 🪤 This is NOT a general "rewind the model" operation. Layers with a
       * RECURRENT state (DeltaNet) fold every token into one running value that has
       * no inverse, and truncating their history is impossible — the caller decides
       * via `planReuse(canTruncate)`, which refuses for any model carrying such
       * layers. Calling this on a hybrid model would leave attention rewound and the
       * recurrent state still holding the future: fluent, wrong output, no error.
       */
      truncate(n) {
        if (n < 0) throw new Error(`bonsai-kv_f32: truncate(${n}) \u2014 negative length`);
        for (const l of this.layers.values()) {
          if (n > l.length) {
            throw new Error(
              `bonsai-kv_f32: truncate(${n}) exceeds filled length ${l.length} \u2014 cannot extend a cache by declaration`
            );
          }
          l.length = n;
        }
      }
    };
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/model/ssm_state.ts
var ssm_state_exports = {};
__export(ssm_state_exports, {
  SsmState: () => SsmState
});
var SsmState;
var init_ssm_state = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/model/ssm_state.ts"() {
    "use strict";
    init_gpu_min();
    SsmState = class {
      constructor(device, cfg) {
        this.device = device;
        this.cfg = cfg;
        /** Bumped by reset(). Consumers that cache per-generation scratch OUTSIDE this
         *  class (e.g. block_deltanet's causal-conv history) compare against this to
         *  know their cache is stale. Without it, reset() silently missed that history
         *  and every generation after the first began with the PREVIOUS conversation's
         *  last conv_kernel-1 rows still in place, in all 48 DeltaNet layers. */
        this.gen = 0;
        this.states = /* @__PURE__ */ new Map();
        this.convStates = /* @__PURE__ */ new Map();
        const stateElems = cfg.heads * cfg.dK * cfg.dV;
        const bytes = stateElems * 4;
        for (const l of cfg.linearAttnLayers) {
          this.states.set(l, this.alloc(bytes, `ssm.S.${l}`));
        }
        if (cfg.dConv !== void 0 && cfg.ssmInnerSize !== void 0) {
          const convHistoryElems = (cfg.dConv - 1) * (cfg.convDim ?? cfg.ssmInnerSize);
          const convBytes = convHistoryElems * 4;
          for (const l of cfg.linearAttnLayers) {
            this.convStates.set(l, this.alloc(convBytes, `ssm.conv_state.${l}`));
          }
        }
      }
      alloc(bytes, label) {
        return this.device.createBuffer({
          size: Math.max(4, bytes),
          usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
          label
        });
      }
      state(layerIndex) {
        const s = this.states.get(layerIndex);
        if (!s) throw new Error(`bonsai-ssm: layer ${layerIndex} has no DeltaNet state`);
        return s;
      }
      /** Convolution sliding-window state (for streaming decode). */
      convState(layerIndex) {
        return this.convStates.get(layerIndex);
      }
      /** Zero all state buffers at the start of a generation (prefill re-fills them). */
      /** Monotonic generation id — changes on every reset(). */
      get generation() {
        return this.gen;
      }
      reset() {
        this.gen++;
        const zero = new Float32Array(this.cfg.heads * this.cfg.dK * this.cfg.dV);
        for (const buf of this.states.values()) this.device.queue.writeBuffer(buf, 0, zero);
        if (this.cfg.dConv !== void 0 && this.cfg.ssmInnerSize !== void 0) {
          const convWidth = this.cfg.convDim ?? this.cfg.ssmInnerSize;
          const convZero = new Float32Array((this.cfg.dConv - 1) * convWidth);
          for (const buf of this.convStates.values()) this.device.queue.writeBuffer(buf, 0, convZero);
        }
      }
    };
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/model/topk-threshold.ts
var topk_threshold_exports = {};
__export(topk_threshold_exports, {
  LOGIT_HIST_BINS: () => LOGIT_HIST_BINS,
  LOGIT_RANGE_HI: () => LOGIT_RANGE_HI,
  LOGIT_RANGE_LO: () => LOGIT_RANGE_LO,
  TOPK_GATHER_CAPACITY: () => TOPK_GATHER_CAPACITY,
  chooseThreshold: () => chooseThreshold
});
function chooseThreshold(hist, lo, hi, k, capacity) {
  const nBins = hist.length;
  const span = Math.max(hi - lo, 1e-6);
  let acc = 0;
  for (let b = 0; b < nBins; b++) {
    acc += hist[b];
    if (acc >= k) {
      const threshold = hi - (b + 1) / nBins * span;
      return {
        threshold,
        expected: acc,
        overflow: acc > capacity,
        reason: acc > capacity ? `bin ${b} of ${nBins} holds ${acc} candidates, over the ${capacity} the gather can hold` : `bin ${b} of ${nBins} reaches ${acc} candidates for k=${k}`
      };
    }
  }
  return {
    threshold: lo,
    expected: acc,
    overflow: true,
    reason: `histogram holds only ${acc} counts, fewer than k=${k} \u2014 refusing to threshold`
  };
}
var LOGIT_RANGE_LO, LOGIT_RANGE_HI, LOGIT_HIST_BINS, TOPK_GATHER_CAPACITY;
var init_topk_threshold = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/model/topk-threshold.ts"() {
    "use strict";
    LOGIT_RANGE_LO = -50;
    LOGIT_RANGE_HI = 50;
    LOGIT_HIST_BINS = 1024;
    TOPK_GATHER_CAPACITY = 2048;
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/model/ops.ts
var ops_exports = {};
__export(ops_exports, {
  Q8_BLOCK: () => Q8_BLOCK,
  Q8_BYTES_PER_BLOCK: () => Q8_BYTES_PER_BLOCK,
  causalConv1d: () => causalConv1d,
  dbgStats: () => dbgStats,
  deltanetGate: () => deltanetGate,
  deltanetSeq: () => deltanetSeq,
  deltanetStep: () => deltanetStep,
  elementwise: () => elementwise,
  elementwiseInplace: () => elementwiseInplace,
  f32Buffer: () => f32Buffer,
  gpuTopK: () => gpuTopK,
  mulSigmoidInplace: () => mulSigmoidInplace,
  projectQ1: () => projectQ1,
  projectQuantized: () => projectQuantized,
  q1q8Matmul: () => q1q8Matmul,
  q2q8Matmul: () => q2q8Matmul,
  quantizeQ8: () => quantizeQ8,
  readbackF32: () => readbackF32,
  residualAdd: () => residualAdd,
  rmsnorm: () => rmsnorm,
  ropeImrope: () => ropeImrope,
  sampleArgmax: () => sampleArgmax,
  sampleTiming: () => sampleTiming,
  sampleToken: () => sampleToken,
  scratchBuffer: () => scratchBuffer,
  siluInplace: () => siluInplace,
  softmaxAttnBatched: () => softmaxAttnBatched,
  softmaxAttnHead: () => softmaxAttnHead,
  swigluMul: () => swigluMul
});
function f32Buffer(device, count, label, opts) {
  return createStorage(device, Math.max(F32, count * F32), label, opts);
}
function scratchBuffer(ctx, count, label, opts) {
  const b = f32Buffer(ctx.device, count, label, opts);
  deferDestroy(ctx.device, b);
  return b;
}
function uniform(device, fields) {
  const bytes = packUniform(fields);
  const buf = createUniform(device, bytes.byteLength);
  device.queue.writeBuffer(buf, 0, bytes);
  deferDestroy(device, buf);
  return buf;
}
function rmsnorm(ctx, x, weight, y, nRows, n, eps) {
  const p = uniform(ctx.device, [{ u32: n }, { f32: eps }, { u32: 0 }, { u32: 0 }]);
  const pipe = ctx.pipelines.get("rmsnorm");
  dispatch1D(ctx.device, pipe, bindGroup(ctx.device, pipe, [x, weight, y, p]), nRows, 1);
}
function quantizeQ8(ctx, activations, count) {
  const nBlocks = Math.ceil(count / Q8_BLOCK);
  const d = createStorage(ctx.device, nBlocks * 4, "act_d");
  const qs = createStorage(ctx.device, nBlocks * 8 * 4, "act_qs");
  const pipe = ctx.pipelines.get("quantize_q8_0");
  dispatch1D(ctx.device, pipe, bindGroup(ctx.device, pipe, [activations, d, qs]), nBlocks, 1);
  return { d, qs, nBlocks };
}
function q1q8Matmul(ctx, weightsQ1, act, out, nRows, K, nCols) {
  const colTiles = Math.ceil(nCols / 64);
  const dims = uniform(ctx.device, [{ u32: K }, { u32: nCols }, { u32: nRows }, { u32: colTiles }]);
  const pipe = ctx.pipelines.get("q1_0_q8_0_matmul");
  const bg = bindGroup(ctx.device, pipe, [weightsQ1, act.d, act.qs, out, dims]);
  dispatch1D(ctx.device, pipe, bg, nRows * colTiles * 64, 64);
}
function q2q8Matmul(ctx, weightsQ2, act, out, nRows, K, nCols) {
  const colTiles = Math.ceil(nCols / 64);
  const dims = uniform(ctx.device, [{ u32: K }, { u32: nCols }, { u32: nRows }, { u32: colTiles }]);
  const pipe = ctx.pipelines.get("q2_0_q8_0_matmul");
  const bg = bindGroup(ctx.device, pipe, [weightsQ2, act.d, act.qs, out, dims]);
  dispatch1D(ctx.device, pipe, bg, nRows * colTiles * 64, 64);
}
function projectQ1(ctx, x, weights, out, nRows, K, nCols) {
  const act = quantizeQ8(ctx, x, nRows * K);
  if (ctx.quantType === 42 /* Q2_0 */) {
    q2q8Matmul(ctx, weights, act, out, nRows, K, nCols);
  } else {
    q1q8Matmul(ctx, weights, act, out, nRows, K, nCols);
  }
}
function projectQuantized(ctx, x, weights, out, nRows, K, nCols, quantType) {
  const act = quantizeQ8(ctx, x, nRows * K);
  if (quantType === 42 /* Q2_0 */) {
    q2q8Matmul(ctx, weights, act, out, nRows, K, nCols);
  } else if (quantType === 41 /* Q1_0 */) {
    q1q8Matmul(ctx, weights, act, out, nRows, K, nCols);
  } else {
    throw new Error(
      `projectQuantized: unsupported weight quant type ${quantType} (supported: Q1_0=${41 /* Q1_0 */}, Q2_0=${42 /* Q2_0 */})`
    );
  }
}
function ropeImrope(ctx, data, nTokens, nHeads, headDim, rotDim, posBase, freqBase, scale = 1) {
  const p = uniform(ctx.device, [
    { u32: nHeads },
    { u32: headDim },
    { u32: rotDim },
    { u32: posBase },
    { f32: freqBase },
    { f32: scale },
    { u32: 0 },
    { u32: 0 }
  ]);
  const pipe = ctx.pipelines.get("rope_imrope");
  const pairsPerHead = Math.floor(rotDim / 2);
  dispatch1D(ctx.device, pipe, bindGroup(ctx.device, pipe, [data, p]), nTokens * nHeads * pairsPerHead, 64);
}
function softmaxAttnHead(ctx, q, k, v, out, headDim, nKv, qHead, kvHead, scale) {
  const p = uniform(ctx.device, [
    { u32: headDim },
    { u32: nKv },
    { u32: qHead },
    { u32: kvHead },
    { f32: scale },
    { u32: 0 },
    { u32: 0 },
    { u32: 0 }
  ]);
  const pipe = ctx.pipelines.get("softmax_attn");
  dispatch1D(ctx.device, pipe, bindGroup(ctx.device, pipe, [q, k, v, out, p]), 1, 1);
}
function softmaxAttnBatched(ctx, q, kCache, vCache, out, nTokens, nHeads, nHeadsKv, headDim, posBase, scale, kScale, vScale) {
  const mode4bit = !!(kScale && vScale);
  const p = uniform(ctx.device, [
    { u32: nTokens },
    { u32: nHeads },
    { u32: nHeadsKv },
    { u32: headDim },
    { u32: posBase },
    { f32: scale },
    { u32: mode4bit ? 1 : 0 },
    { u32: 0 }
  ]);
  if (headDim > 256) {
    throw new Error(
      `bonsai-ops: softmaxAttnBatched supports head_dim <= 256, got ${headDim}. Raise DPT in softmax_attn_batched.wgsl to ceil(head_dim/128) to extend it.`
    );
  }
  if (mode4bit && headDim % 8 !== 0) {
    throw new Error(
      `bonsai-ops: softmaxAttnBatched 4-bit mode requires head_dim % 8 == 0, got ${headDim}.`
    );
  }
  const pipe = ctx.pipelines.get("softmax_attn_batched");
  const bg = bindGroup(ctx.device, pipe, [
    q,
    kCache,
    vCache,
    out,
    p,
    kScale ?? kvScaleDummy(ctx.device),
    vScale ?? kvScaleDummy(ctx.device)
  ]);
  dispatch1D(ctx.device, pipe, bg, nTokens * nHeads, 1);
}
function causalConv1d(ctx, x, weight, bias, out, nTokens, channels, kernel) {
  const p = uniform(ctx.device, [{ u32: nTokens }, { u32: channels }, { u32: kernel }, { u32: 0 }]);
  const pipe = ctx.pipelines.get("causal_conv1d");
  const bg = bindGroup(ctx.device, pipe, [x, weight, bias, out, p]);
  dispatch1D(ctx.device, pipe, bg, nTokens * channels, 64);
}
function deltanetStep(ctx, q, k, v, g, beta, state, out, dK, dV, head) {
  const p = uniform(ctx.device, [{ u32: dK }, { u32: dV }, { u32: head }, { u32: 0 }]);
  const pipe = ctx.pipelines.get("deltanet");
  const bg = bindGroup(ctx.device, pipe, [q, k, v, g, beta, state, out, p]);
  dispatch1D(ctx.device, pipe, bg, 1, 1);
}
function swigluMul(ctx, gate, up, out, n) {
  const p = uniform(ctx.device, [{ u32: n }]);
  const pipe = ctx.pipelines.get("swiglu");
  dispatch1D(ctx.device, pipe, bindGroup(ctx.device, pipe, [gate, up, out, p]), n, 256);
}
function elementwiseInplace(ctx, io, b, n, op) {
  const p = uniform(ctx.device, [{ u32: n }, { u32: op }, { u32: 0 }, { u32: 0 }]);
  const pipe = ctx.pipelines.get("elementwise_inplace");
  dispatch1D(ctx.device, pipe, bindGroup(ctx.device, pipe, [io, b, p]), n, 256);
}
function siluDummy(device) {
  let b = siluScratch.get(device);
  if (!b) {
    b = createStorage(device, 4, "silu_dummy");
    siluScratch.set(device, b);
  }
  return b;
}
function kvScaleDummy(device) {
  let b = kvScaleScratch.get(device);
  if (!b) {
    b = createStorage(device, 4, "kv_scale_dummy");
    kvScaleScratch.set(device, b);
  }
  return b;
}
function mulSigmoidInplace(ctx, io, gate, n) {
  elementwiseInplace(ctx, io, gate, n, 4);
}
function siluInplace(ctx, io, n) {
  elementwiseInplace(ctx, io, siluDummy(ctx.device), n, 3);
}
function deltanetGate(ctx, alphaRaw, betaRaw, aLog, dtBias, gOut, betaOut, nTokens, heads) {
  const p = uniform(ctx.device, [{ u32: nTokens }, { u32: heads }, { u32: 0 }, { u32: 0 }]);
  const pipe = ctx.pipelines.get("deltanet_gate");
  const bg = bindGroup(ctx.device, pipe, [alphaRaw, betaRaw, aLog, dtBias, gOut, betaOut, p]);
  dispatch1D(ctx.device, pipe, bg, nTokens * heads, 64);
}
function deltanetSeq(ctx, q, k, v, gdec, beta, state, out, nTokens, vHeads, kHeads, headDim, vPerK) {
  const p = uniform(ctx.device, [
    { u32: nTokens },
    { u32: vHeads },
    { u32: kHeads },
    { u32: headDim },
    { u32: vPerK },
    { u32: 0 },
    { u32: 0 },
    { u32: 0 }
  ]);
  const pipe = ctx.pipelines.get("deltanet_seq");
  const bg = bindGroup(ctx.device, pipe, [q, k, v, gdec, beta, state, out, p]);
  dispatch1D(ctx.device, pipe, bg, vHeads * headDim, 64);
}
function elementwise(ctx, a, b, out, n, op) {
  if (out === a) {
    elementwiseInplace(ctx, out, b, n, op);
    return;
  }
  if (out === b) {
    elementwiseInplace(ctx, out, a, n, op);
    return;
  }
  const p = uniform(ctx.device, [{ u32: n }, { u32: op }, { u32: 0 }, { u32: 0 }]);
  const pipe = ctx.pipelines.get("elementwise");
  dispatch1D(ctx.device, pipe, bindGroup(ctx.device, pipe, [a, b, out, p]), n, 256);
}
function residualAdd(ctx, acc, delta, n) {
  elementwiseInplace(ctx, acc, delta, n, 0);
}
function sampleFromCandidates(ids, vals, k, temperature, opts, rng) {
  const n = ids.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => vals[b] - vals[a]);
  const keep = order.slice(0, Math.max(1, Math.min(k, n)));
  if (temperature <= 0) return ids[keep[0]];
  const maxLogit = vals[keep[0]];
  const probs = new Float64Array(keep.length);
  let sum = 0;
  for (let i = 0; i < keep.length; i++) {
    const p = Math.exp((vals[keep[i]] - maxLogit) / temperature);
    probs[i] = p;
    sum += p;
  }
  if (!(sum > 0) || !Number.isFinite(sum)) return ids[keep[0]];
  let cutoff = keep.length;
  const topP = opts.topP ?? 1;
  if (topP > 0 && topP < 1) {
    let acc = 0;
    for (let i = 0; i < keep.length; i++) {
      acc += probs[i] / sum;
      if (acc >= topP) {
        cutoff = i + 1;
        break;
      }
    }
  }
  let mass = 0;
  for (let i = 0; i < cutoff; i++) mass += probs[i];
  let r = rng() * mass;
  for (let i = 0; i < cutoff; i++) {
    r -= probs[i];
    if (r <= 0) return ids[keep[i]];
  }
  return ids[keep[cutoff - 1]];
}
async function sampleToken(ctx, logits, vocab, opts = {}) {
  const temperature = opts.temperature ?? 0;
  const rng = opts.random ?? Math.random;
  const TIMING = globalThis.__BONSAI_TIMING === true;
  const _t0 = TIMING ? performance.now() : 0;
  const penaltyActive = (opts.repetitionPenalty ?? 1) !== 1 && !!opts.recentIds?.length;
  const kWanted = opts.topK && opts.topK > 0 ? Math.min(opts.topK, vocab) : Math.min(64, vocab);
  const useGpuTopK = globalThis.__BONSAI_GPU_TOPK === true;
  if (!penaltyActive && useGpuTopK) {
    const picked = await gpuTopK(ctx, logits, vocab, Math.max(kWanted, 1));
    if (picked && picked.ids.length) {
      const _tg = TIMING ? performance.now() : 0;
      if (TIMING) {
        sampleTiming.readbackMs += _tg - _t0;
        sampleTiming.calls++;
      }
      const out = sampleFromCandidates(picked.ids, picked.vals, kWanted, temperature, opts, rng);
      if (TIMING) sampleTiming.selectMs += performance.now() - _tg;
      return out;
    }
  }
  const row = await readbackF32(ctx, logits, vocab);
  const _t1 = TIMING ? performance.now() : 0;
  if (TIMING) {
    sampleTiming.readbackMs += _t1 - _t0;
    sampleTiming.calls++;
  }
  const done = (v) => {
    if (TIMING) sampleTiming.selectMs += performance.now() - _t1;
    return v;
  };
  const penalty = opts.repetitionPenalty ?? 1;
  if (penalty !== 1 && opts.recentIds?.length) {
    for (const id of new Set(opts.recentIds)) {
      if (id < 0 || id >= vocab) continue;
      const v = row[id];
      row[id] = v > 0 ? v / penalty : v * penalty;
    }
  }
  if (temperature <= 0) {
    let bi = 0;
    let bv = -Infinity;
    for (let i = 0; i < vocab; i++) if (row[i] > bv) {
      bv = row[i];
      bi = i;
    }
    return done(bi);
  }
  const k = opts.topK && opts.topK > 0 ? Math.min(opts.topK, vocab) : Math.min(64, vocab);
  const cand = [];
  let worst = -Infinity;
  for (let i = 0; i < vocab; i++) {
    const v = row[i];
    if (cand.length === k && v <= worst) continue;
    let j = cand.length;
    while (j > 0 && row[cand[j - 1]] < v) j--;
    cand.splice(j, 0, i);
    if (cand.length > k) cand.pop();
    worst = row[cand[cand.length - 1]];
  }
  const maxLogit = row[cand[0]];
  const probs = new Float64Array(cand.length);
  let sum = 0;
  for (let i = 0; i < cand.length; i++) {
    const p = Math.exp((row[cand[i]] - maxLogit) / temperature);
    probs[i] = p;
    sum += p;
  }
  if (!(sum > 0) || !Number.isFinite(sum)) return done(cand[0]);
  let cutoff = cand.length;
  const topP = opts.topP ?? 1;
  if (topP > 0 && topP < 1) {
    let acc = 0;
    for (let i = 0; i < cand.length; i++) {
      acc += probs[i] / sum;
      if (acc >= topP) {
        cutoff = i + 1;
        break;
      }
    }
  }
  let mass = 0;
  for (let i = 0; i < cutoff; i++) mass += probs[i];
  let r = rng() * mass;
  for (let i = 0; i < cutoff; i++) {
    r -= probs[i];
    if (r <= 0) return done(cand[i]);
  }
  return done(cand[cutoff - 1]);
}
async function sampleArgmax(ctx, logits, vocab, temperature = 0) {
  const argmax = createStorage(ctx.device, 4, "argmax");
  const maxval = createStorage(ctx.device, 4, "maxval");
  const p = uniform(ctx.device, [{ u32: vocab }, { f32: temperature }, { u32: 0 }, { u32: 0 }]);
  const pipe = ctx.pipelines.get("sampling");
  dispatch1D(ctx.device, pipe, bindGroup(ctx.device, pipe, [logits, argmax, maxval, p]), 1, 1);
  const buf = await readback(ctx.device, argmax, 4);
  return new Uint32Array(buf)[0];
}
async function gpuTopK(ctx, logits, vocab, k) {
  const {
    chooseThreshold: chooseThreshold2,
    LOGIT_HIST_BINS: LOGIT_HIST_BINS2,
    LOGIT_RANGE_LO: LOGIT_RANGE_LO2,
    LOGIT_RANGE_HI: LOGIT_RANGE_HI2,
    TOPK_GATHER_CAPACITY: TOPK_GATHER_CAPACITY2
  } = await Promise.resolve().then(() => (init_topk_threshold(), topk_threshold_exports));
  const NBINS = LOGIT_HIST_BINS2;
  const CAP = TOPK_GATHER_CAPACITY2;
  const hist = createStorage(ctx.device, NBINS * 4, "topk_hist");
  const outIdx = createStorage(ctx.device, CAP * 4, "topk_idx");
  const outVal = createStorage(ctx.device, CAP * 4, "topk_val");
  const counter = createStorage(ctx.device, 4, "topk_count");
  const mkUniform = (threshold) => uniform(ctx.device, [
    { u32: vocab },
    { u32: NBINS },
    { f32: LOGIT_RANGE_LO2 },
    { f32: LOGIT_RANGE_HI2 },
    { f32: threshold },
    { u32: CAP },
    { u32: 0 },
    { u32: 0 }
  ]);
  const histPipe = ctx.pipelines.get("logit_topk", "hist_main");
  const p1 = mkUniform(0);
  dispatch1D(
    ctx.device,
    histPipe,
    bindGroup(ctx.device, histPipe, [logits, hist, outIdx, outVal, counter, p1]),
    Math.min(vocab, 65536),
    256
  );
  const histBytes = await readback(ctx.device, hist, NBINS * 4);
  const choice = chooseThreshold2(new Uint32Array(histBytes), LOGIT_RANGE_LO2, LOGIT_RANGE_HI2, k, CAP);
  if (choice.overflow) return null;
  const gatherPipe = ctx.pipelines.get("logit_topk", "gather_main");
  const p2 = mkUniform(choice.threshold);
  dispatch1D(
    ctx.device,
    gatherPipe,
    bindGroup(ctx.device, gatherPipe, [logits, hist, outIdx, outVal, counter, p2]),
    Math.min(vocab, 65536),
    256
  );
  const countBytes = await readback(ctx.device, counter, 4);
  const count = new Uint32Array(countBytes)[0];
  if (count === 0 || count > CAP) return null;
  const idsBytes = await readback(ctx.device, outIdx, count * 4);
  const valsBytes = await readback(ctx.device, outVal, count * 4);
  return { ids: new Uint32Array(idsBytes), vals: new Float32Array(valsBytes) };
}
async function readbackF32(ctx, buf, count) {
  const ab = await readback(ctx.device, buf, count * F32);
  return new Float32Array(ab);
}
async function dbgStats(ctx, buf, count, label) {
  const a = await readbackF32(ctx, buf, Math.min(count, 8192));
  let bad = 0, mn = Infinity, mx = -Infinity, s = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (!Number.isFinite(v)) bad++;
    else {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      s += Math.abs(v);
    }
  }
  const str = `${label}[bad=${bad} min=${mn.toExponential(1)} max=${mx.toExponential(1)} mean=${(s / a.length).toExponential(1)}]`;
  console.log(`[bonsai] ${str}`);
  return str;
}
var F32, Q8_BLOCK, Q8_BYTES_PER_BLOCK, siluScratch, kvScaleScratch, sampleTiming;
var init_ops = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/model/ops.ts"() {
    "use strict";
    init_dispatch();
    init_types();
    F32 = 4;
    Q8_BLOCK = 32;
    Q8_BYTES_PER_BLOCK = (1 + 8) * 4;
    siluScratch = /* @__PURE__ */ new WeakMap();
    kvScaleScratch = /* @__PURE__ */ new WeakMap();
    sampleTiming = { readbackMs: 0, selectMs: 0, calls: 0 };
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/model/block_full_attn.ts
var block_full_attn_exports = {};
__export(block_full_attn_exports, {
  runFullAttnBlock: () => runFullAttnBlock
});
async function runFullAttnBlock(ctx, layer, io) {
  const { hidden, nTokens, posBase } = io;
  const { device, pipelines, weights, config, kv, kvMode } = ctx;
  const kind = config.layerKinds[layer];
  const gated = kind !== "dense-attn";
  const names = blockTensorNames(kind, layer, config.ffnNormNames?.[layer]);
  const [
    attnNormName,
    attnQName,
    attnKName,
    attnVName,
    attnQNormName,
    attnKNormName,
    attnOutName,
    ffnNormName,
    ffnGateName,
    ffnUpName,
    ffnDownName
  ] = names;
  const { headCount, headCountKv, embeddingLength, keyLength, ropeDimensionCount, ropeFreqBase, rmsEps } = config;
  const nHeads = headCount;
  const nHeadsKv = headCountKv;
  const headDim = keyLength ?? embeddingLength / headCount;
  const attnScale = 1 / Math.sqrt(headDim);
  const rotDim = ropeDimensionCount ?? headDim;
  await weights.ensureLayer(layer);
  const attnNormW = weights.get(attnNormName);
  const attnQW = weights.get(attnQName);
  const attnKW = weights.get(attnKName);
  const attnVW = weights.get(attnVName);
  const attnQNormW = weights.get(attnQNormName);
  const attnKNormW = weights.get(attnKNormName);
  const attnOutW = weights.get(attnOutName);
  const ffnNormW = weights.get(ffnNormName);
  const ffnGateW = weights.get(ffnGateName);
  const ffnUpW = weights.get(ffnUpName);
  const ffnDownW = weights.get(ffnDownName);
  const h1 = scratchBuffer(ctx, nTokens * embeddingLength, "h1_attn");
  rmsnorm(ctx, hidden, attnNormW, h1, nTokens, embeddingLength, rmsEps);
  const tempQ = scratchBuffer(ctx, nTokens * nHeads * headDim, "tempQ");
  const tempK = scratchBuffer(ctx, nTokens * nHeadsKv * headDim, "tempK");
  const tempV = scratchBuffer(ctx, nTokens * nHeadsKv * headDim, "tempV");
  const tempG = gated ? scratchBuffer(ctx, nTokens * nHeads * headDim, "tempG") : null;
  projectQ1(ctx, h1, attnKW, tempK, nTokens, embeddingLength, nHeadsKv * headDim);
  projectQ1(ctx, h1, attnVW, tempV, nTokens, embeddingLength, nHeadsKv * headDim);
  if (gated) {
    const tempQG = scratchBuffer(ctx, nTokens * nHeads * headDim * 2, "tempQG");
    projectQ1(ctx, h1, attnQW, tempQG, nTokens, embeddingLength, nHeads * headDim * 2);
    const tgt = beginCopies(device);
    const rowQG = nHeads * headDim * 2;
    const rowQ = nHeads * headDim;
    for (let t = 0; t < nTokens; t++) {
      for (let h = 0; h < nHeads; h++) {
        const src = (t * rowQG + h * headDim * 2) * 4;
        const dst = (t * rowQ + h * headDim) * 4;
        tgt.enc.copyBufferToBuffer(tempQG, src, tempQ, dst, headDim * 4);
        tgt.enc.copyBufferToBuffer(tempQG, src + headDim * 4, tempG, dst, headDim * 4);
      }
    }
    finishCopies(device, tgt);
  } else {
    projectQ1(ctx, h1, attnQW, tempQ, nTokens, embeddingLength, nHeads * headDim);
  }
  const tempQn = scratchBuffer(ctx, nTokens * nHeads * headDim, "tempQn");
  const tempKn = scratchBuffer(ctx, nTokens * nHeadsKv * headDim, "tempKn");
  rmsnorm(ctx, tempQ, attnQNormW, tempQn, nTokens * nHeads, headDim, rmsEps);
  rmsnorm(ctx, tempK, attnKNormW, tempKn, nTokens * nHeadsKv, headDim, rmsEps);
  ropeImrope(ctx, tempQn, nTokens, nHeads, headDim, rotDim, posBase, ropeFreqBase);
  ropeImrope(ctx, tempKn, nTokens, nHeadsKv, headDim, rotDim, posBase, ropeFreqBase);
  const attnOut = scratchBuffer(ctx, nTokens * nHeads * headDim, "attn_out");
  if (kvMode === "4bit") {
    kv.append(layer, tempKn, tempV, nTokens, posBase);
    const l4 = kv.layer(layer);
    softmaxAttnBatched(ctx, tempQn, l4.k, l4.v, attnOut, nTokens, nHeads, nHeadsKv, headDim, posBase, attnScale, l4.kScale, l4.vScale);
  } else {
    kv.append(layer, tempKn, tempV, nTokens, 0, 0);
    const { k: kCache, v: vCache } = kv.layer(layer);
    softmaxAttnBatched(ctx, tempQn, kCache, vCache, attnOut, nTokens, nHeads, nHeadsKv, headDim, posBase, attnScale);
  }
  if (gated) mulSigmoidInplace(ctx, attnOut, tempG, nTokens * nHeads * headDim);
  const attnOutProj = scratchBuffer(ctx, nTokens * embeddingLength, "attn_out_proj");
  projectQ1(ctx, attnOut, attnOutW, attnOutProj, nTokens, nHeads * headDim, embeddingLength);
  residualAdd(ctx, hidden, attnOutProj, nTokens * embeddingLength);
  const h2 = scratchBuffer(ctx, nTokens * embeddingLength, "h2_ffn");
  rmsnorm(ctx, hidden, ffnNormW, h2, nTokens, embeddingLength, rmsEps);
  const ffnGate = scratchBuffer(ctx, nTokens * config.feedForwardLength, "ffn_gate");
  const ffnUp = scratchBuffer(ctx, nTokens * config.feedForwardLength, "ffn_up");
  projectQ1(ctx, h2, ffnGateW, ffnGate, nTokens, embeddingLength, config.feedForwardLength);
  projectQ1(ctx, h2, ffnUpW, ffnUp, nTokens, embeddingLength, config.feedForwardLength);
  const ffnGatedUp = scratchBuffer(ctx, nTokens * config.feedForwardLength, "ffn_gated_up");
  swigluMul(ctx, ffnGate, ffnUp, ffnGatedUp, nTokens * config.feedForwardLength);
  const ffnOut = scratchBuffer(ctx, nTokens * embeddingLength, "ffn_out");
  projectQ1(ctx, ffnGatedUp, ffnDownW, ffnOut, nTokens, config.feedForwardLength, embeddingLength);
  residualAdd(ctx, hidden, ffnOut, nTokens * embeddingLength);
}
var init_block_full_attn = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/model/block_full_attn.ts"() {
    "use strict";
    init_dispatch();
    init_ops();
    init_layers();
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/model/block_deltanet.ts
var block_deltanet_exports = {};
__export(block_deltanet_exports, {
  runDeltaNetBlock: () => runDeltaNetBlock
});
async function runDeltaNetBlock(ctx, layer, io) {
  const cfg = ctx.config;
  const device = ctx.device;
  const w = ctx.weights;
  const dn = cfg.deltaNet;
  if (!dn) {
    throw new Error(
      `bonsai-deltanet: layer ${layer} routed to the DeltaNet path but this model has no ssm.* geometry (dense model). This is a layer-classification bug, not a bad file.`
    );
  }
  const nTokens = io.nTokens;
  const embedLen = cfg.embeddingLength;
  const ffnLen = cfg.feedForwardLength;
  const eps = cfg.rmsEps;
  const { numVHeads, numKHeads, headDim, qDim, kDim, vDim, convDim, convKernel, vPerKHead } = dn;
  const names = blockTensorNames("linear-attn", layer);
  if (names.length !== 14) {
    throw new Error(
      `block_deltanet layer ${layer}: expected 14 tensor names, got ${names.length}`
    );
  }
  const [
    attnNormN,
    attnQkvN,
    attnGateN,
    ssmConvN,
    ssmBetaN,
    ssmAlphaN,
    ssmAN,
    ssmDtBiasN,
    ssmNormN,
    ssmOutN,
    postAttnNormN,
    ffnGateN,
    ffnUpN,
    ffnDownN
  ] = names;
  for (const name of names) {
    if (!w.has(name)) {
      throw new Error(
        `block_deltanet layer ${layer}: missing tensor '${name}'. This layer is DeltaNet (linear-attn); ensure it was streamed via weights.ensureLayer(${layer}).`
      );
    }
  }
  const h1 = scratchBuffer(ctx, nTokens * embedLen, `dn.${layer}.h1`);
  const qkv = scratchBuffer(ctx, nTokens * convDim, `dn.${layer}.qkv`);
  const z = scratchBuffer(ctx, nTokens * vDim, `dn.${layer}.z`);
  const qc = scratchBuffer(ctx, nTokens * qDim, `dn.${layer}.qc`);
  const kc = scratchBuffer(ctx, nTokens * kDim, `dn.${layer}.kc`);
  const vc = scratchBuffer(ctx, nTokens * vDim, `dn.${layer}.vc`);
  const qn = scratchBuffer(ctx, nTokens * qDim, `dn.${layer}.qn`);
  const kn = scratchBuffer(ctx, nTokens * kDim, `dn.${layer}.kn`);
  const alphaRaw = scratchBuffer(ctx, nTokens * numVHeads, `dn.${layer}.alpha`);
  const betaRaw = scratchBuffer(ctx, nTokens * numVHeads, `dn.${layer}.beta`);
  const gBuf = scratchBuffer(ctx, nTokens * numVHeads, `dn.${layer}.g`);
  const betaBuf = scratchBuffer(ctx, nTokens * numVHeads, `dn.${layer}.betaG`);
  const recur = scratchBuffer(ctx, nTokens * vDim, `dn.${layer}.recur`);
  const normOut = scratchBuffer(ctx, nTokens * vDim, `dn.${layer}.normOut`);
  const ssmProj = scratchBuffer(ctx, nTokens * embedLen, `dn.${layer}.ssmProj`);
  const h2 = scratchBuffer(ctx, nTokens * embedLen, `dn.${layer}.h2`);
  const ffnG = scratchBuffer(ctx, nTokens * ffnLen, `dn.${layer}.ffnG`);
  const ffnU = scratchBuffer(ctx, nTokens * ffnLen, `dn.${layer}.ffnU`);
  const ffnM = scratchBuffer(ctx, nTokens * ffnLen, `dn.${layer}.ffnM`);
  const ffnD = scratchBuffer(ctx, nTokens * embedLen, `dn.${layer}.ffnD`);
  const convBias = scratchBuffer(ctx, convDim, `dn.${layer}.convBias`, { queueInit: true });
  device.queue.writeBuffer(convBias, 0, new Float32Array(convDim));
  const l2w = scratchBuffer(ctx, headDim, `dn.${layer}.l2w`, { queueInit: true });
  device.queue.writeBuffer(l2w, 0, new Float32Array(headDim).fill(1 / Math.sqrt(headDim)));
  const l2eps = 1e-6 / headDim;
  rmsnorm(ctx, io.hidden, w.get(attnNormN), h1, nTokens, embedLen, eps);
  projectQ1(ctx, h1, w.get(attnQkvN), qkv, nTokens, embedLen, convDim);
  projectQ1(ctx, h1, w.get(attnGateN), z, nTokens, embedLen, vDim);
  const histRows = convKernel - 1;
  const ssmGen = ctx.ssm.generation ?? 0;
  let entry = CONV_HISTORY.get(ctx.ssm);
  if (!entry) {
    entry = { gen: ssmGen, bufs: /* @__PURE__ */ new Map(), zeroed: /* @__PURE__ */ new Set() };
    CONV_HISTORY.set(ctx.ssm, entry);
  }
  if (entry.gen !== ssmGen) {
    entry.gen = ssmGen;
    entry.zeroed.clear();
  }
  let hist = entry.bufs.get(layer);
  if (!hist) {
    hist = f32Buffer(device, histRows * convDim, `dn.${layer}.convHist`);
    entry.bufs.set(layer, hist);
    device.queue.writeBuffer(hist, 0, new Float32Array(histRows * convDim));
    entry.zeroed.add(layer);
  } else if (!entry.zeroed.has(layer)) {
    device.queue.writeBuffer(hist, 0, new Float32Array(histRows * convDim));
    entry.zeroed.add(layer);
  }
  const convIn = scratchBuffer(ctx, (nTokens + histRows) * convDim, `dn.${layer}.convIn`);
  const convOutFull = scratchBuffer(ctx, (nTokens + histRows) * convDim, `dn.${layer}.convOutF`);
  {
    const tgt = beginCopies(device);
    tgt.enc.copyBufferToBuffer(hist, 0, convIn, 0, histRows * convDim * 4);
    tgt.enc.copyBufferToBuffer(qkv, 0, convIn, histRows * convDim * 4, nTokens * convDim * 4);
    tgt.enc.copyBufferToBuffer(convIn, nTokens * convDim * 4, hist, 0, histRows * convDim * 4);
    finishCopies(device, tgt);
  }
  causalConv1d(ctx, convIn, w.get(ssmConvN), convBias, convOutFull, nTokens + histRows, convDim, convKernel);
  siluInplace(ctx, convOutFull, (nTokens + histRows) * convDim);
  {
    const tgt = beginCopies(device);
    for (let t = 0; t < nTokens; t++) {
      const src = (t + histRows) * convDim * 4;
      tgt.enc.copyBufferToBuffer(convOutFull, src, qc, t * qDim * 4, qDim * 4);
      tgt.enc.copyBufferToBuffer(convOutFull, src + qDim * 4, kc, t * kDim * 4, kDim * 4);
      tgt.enc.copyBufferToBuffer(convOutFull, src + (qDim + kDim) * 4, vc, t * vDim * 4, vDim * 4);
    }
    finishCopies(device, tgt);
  }
  rmsnorm(ctx, qc, l2w, qn, nTokens * numKHeads, headDim, l2eps);
  rmsnorm(ctx, kc, l2w, kn, nTokens * numKHeads, headDim, l2eps);
  projectQ1(ctx, h1, w.get(ssmAlphaN), alphaRaw, nTokens, embedLen, numVHeads);
  projectQ1(ctx, h1, w.get(ssmBetaN), betaRaw, nTokens, embedLen, numVHeads);
  deltanetGate(ctx, alphaRaw, betaRaw, w.get(ssmAN), w.get(ssmDtBiasN), gBuf, betaBuf, nTokens, numVHeads);
  const state = ctx.ssm.state(layer);
  deltanetSeq(ctx, qn, kn, vc, gBuf, betaBuf, state, recur, nTokens, numVHeads, numKHeads, headDim, vPerKHead);
  rmsnorm(ctx, recur, w.get(ssmNormN), normOut, nTokens * numVHeads, headDim, eps);
  siluInplace(ctx, z, nTokens * vDim);
  elementwise(ctx, normOut, z, normOut, nTokens * vDim, 1);
  projectQ1(ctx, normOut, w.get(ssmOutN), ssmProj, nTokens, vDim, embedLen);
  residualAdd(ctx, io.hidden, ssmProj, nTokens * embedLen);
  rmsnorm(ctx, io.hidden, w.get(postAttnNormN), h2, nTokens, embedLen, eps);
  projectQ1(ctx, h2, w.get(ffnGateN), ffnG, nTokens, embedLen, ffnLen);
  projectQ1(ctx, h2, w.get(ffnUpN), ffnU, nTokens, embedLen, ffnLen);
  swigluMul(ctx, ffnG, ffnU, ffnM, nTokens * ffnLen);
  projectQ1(ctx, ffnM, w.get(ffnDownN), ffnD, nTokens, ffnLen, embedLen);
  residualAdd(ctx, io.hidden, ffnD, nTokens * embedLen);
}
var CONV_HISTORY;
var init_block_deltanet = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/model/block_deltanet.ts"() {
    "use strict";
    init_ops();
    init_dispatch();
    init_layers();
    CONV_HISTORY = /* @__PURE__ */ new WeakMap();
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/model/layers.ts
function blockTensorNames(kind, layer, ffnNormName) {
  const p = `blk.${layer}.`;
  if (kind === "full-attn" || kind === "dense-attn") {
    return [
      `${p}attn_norm.weight`,
      // 0 input RMSNorm
      `${p}attn_q.weight`,
      // 1 q proj -> nHeads*headDim (2x when gated; see LayerKind)
      `${p}attn_k.weight`,
      // 2 k proj -> nKvHeads*headDim
      `${p}attn_v.weight`,
      // 3 v proj -> nKvHeads*headDim
      `${p}attn_q_norm.weight`,
      // 4 per-head RMSNorm over headDim, applied to q
      `${p}attn_k_norm.weight`,
      // 5 per-head RMSNorm over headDim, applied to k
      `${p}attn_output.weight`,
      // 6 output proj -> embedding
      // 7 pre-FFN RMSNorm. qwen35 calls it post_attention_norm, stock qwen3 calls it
      // ffn_norm; the caller passes the name config resolved BY PRESENCE. The default keeps
      // the qwen35 name so existing callers (harnesses, tests) are unchanged.
      ffnNormName ?? `${p}post_attention_norm.weight`,
      `${p}ffn_gate.weight`,
      // 8
      `${p}ffn_up.weight`,
      // 9
      `${p}ffn_down.weight`
      // 10
    ];
  }
  return [
    `${p}attn_norm.weight`,
    // 0 input RMSNorm
    `${p}attn_qkv.weight`,
    // 1 fused in-proj -> q|k|v (qDim+kDim+vDim)
    `${p}attn_gate.weight`,
    // 2 output gate z -> vDim
    `${p}ssm_conv1d.weight`,
    // 3 depthwise causal conv over the qkv channels (F32)
    `${p}ssm_beta.weight`,
    // 4 beta proj -> numVHeads (write strength)
    `${p}ssm_alpha.weight`,
    // 5 alpha proj -> numVHeads (decay input)
    `${p}ssm_a`,
    // 6 A_log per v-head (F32 [numVHeads])
    `${p}ssm_dt.bias`,
    // 7 dt bias per v-head (F32 [numVHeads])
    `${p}ssm_norm.weight`,
    // 8 gated RMSNorm over v headDim (F32 [headDim])
    `${p}ssm_out.weight`,
    // 9 output proj vDim -> embedding
    `${p}post_attention_norm.weight`,
    // 10 pre-FFN RMSNorm
    `${p}ffn_gate.weight`,
    // 11
    `${p}ffn_up.weight`,
    // 12
    `${p}ffn_down.weight`
    // 13
  ];
}
async function runBlock(ctx, layer, io) {
  const kind = ctx.config.layerKinds[layer];
  await ctx.weights.ensureLayer(layer);
  if (kind === "full-attn" || kind === "dense-attn") {
    const { runFullAttnBlock: runFullAttnBlock2 } = await Promise.resolve().then(() => (init_block_full_attn(), block_full_attn_exports));
    await runFullAttnBlock2(ctx, layer, io);
  } else if (kind === "linear-attn") {
    const { runDeltaNetBlock: runDeltaNetBlock2 } = await Promise.resolve().then(() => (init_block_deltanet(), block_deltanet_exports));
    await runDeltaNetBlock2(ctx, layer, io);
  } else {
    throw new Error(`runBlock: unknown layer kind '${kind}' at layer ${layer}`);
  }
}
var init_layers = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/model/layers.ts"() {
    "use strict";
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/model/embed_lmhead.ts
var embed_lmhead_exports = {};
__export(embed_lmhead_exports, {
  embedTokens: () => embedTokens,
  projectLogits: () => projectLogits
});
async function embedTokens(ctx, tokenIds, hiddenOut, weights, embeddingLength) {
  const embeddingName = "token_embd.weight";
  if (!weights.has(embeddingName)) {
    throw new Error(
      `bonsai-embed: token embedding table '${embeddingName}' not loaded; call weights.loadGlobals(['${embeddingName}']) first`
    );
  }
  const embeddingBuffer = weights.get(embeddingName);
  const nTokens = tokenIds.length;
  if (embeddingLength % QK1_0 !== 0) {
    throw new Error(
      `bonsai-embed: embeddingLength ${embeddingLength} not a multiple of QK1_0 (${QK1_0})`
    );
  }
  const embedType = weights.typeOf(embeddingName);
  const isQ2 = embedType === 42 /* Q2_0 */;
  if (!isQ2 && embedType !== 41 /* Q1_0 */) {
    throw new Error(
      `bonsai-embed: '${embeddingName}' has unsupported quant type ${embedType} (supported: Q1_0=${41 /* Q1_0 */}, Q2_0=${42 /* Q2_0 */})`
    );
  }
  const GPU_BYTES_PER_BLOCK = isQ2 ? 36 : 20;
  const blocksPerRow = embeddingLength / QK1_0;
  const bytesPerRow = blocksPerRow * GPU_BYTES_PER_BLOCK;
  const f32Out = new Float32Array(nTokens * embeddingLength);
  const stagingBuffer = createStorage(ctx.device, bytesPerRow, "embed_staging");
  for (let t = 0; t < nTokens; t++) {
    const tokenId = tokenIds[t];
    if (!Number.isInteger(tokenId) || tokenId < 0) {
      throw new Error(
        `bonsai-embed: token ID ${tokenId} at position ${t} is invalid (must be non-negative integer)`
      );
    }
    const rowByteOffset = tokenId * bytesPerRow;
    const enc = ctx.device.createCommandEncoder();
    enc.copyBufferToBuffer(embeddingBuffer, rowByteOffset, stagingBuffer, 0, bytesPerRow);
    ctx.device.queue.submit([enc.finish()]);
    const rowBytes = await readback(ctx.device, stagingBuffer, bytesPerRow);
    const rowU8 = new Uint8Array(rowBytes);
    for (let b = 0; b < blocksPerRow; b++) {
      const blockStart = b * GPU_BYTES_PER_BLOCK;
      const dequantized = isQ2 ? dequantQ2Block(readQ2Block(rowU8, blockStart)) : dequantQ1Block(readQ1Block(rowU8, blockStart));
      const outOffset = t * embeddingLength + b * QK1_0;
      f32Out.set(dequantized, outOffset);
    }
  }
  ctx.device.queue.writeBuffer(hiddenOut, 0, f32Out);
  stagingBuffer.destroy();
}
async function projectLogits(ctx, hidden, lastTokenIndex, weights, config, vocabSize) {
  const outputNormName = "output_norm.weight";
  if (!weights.has(outputNormName)) {
    throw new Error(
      `bonsai-lmhead: output norm '${outputNormName}' not loaded; call weights.loadGlobals(['${outputNormName}']) first`
    );
  }
  const outputNormWeight = weights.get(outputNormName);
  const embeddingLength = config.embeddingLength;
  const eps = config.rmsEps;
  const lastRow = f32Buffer(ctx.device, embeddingLength, "last_row");
  {
    const enc = ctx.device.createCommandEncoder();
    enc.copyBufferToBuffer(
      hidden,
      lastTokenIndex * embeddingLength * 4,
      lastRow,
      0,
      embeddingLength * 4
    );
    ctx.device.queue.submit([enc.finish()]);
  }
  const normedHidden = f32Buffer(ctx.device, embeddingLength, "normed_hidden");
  rmsnorm(ctx, lastRow, outputNormWeight, normedHidden, 1, embeddingLength, eps);
  {
    const { BONSAI_DEBUG: BONSAI_DEBUG2 } = await Promise.resolve().then(() => (init_forward(), forward_exports));
    if (BONSAI_DEBUG2) {
      const { readbackF32: readbackF322 } = await Promise.resolve().then(() => (init_ops(), ops_exports));
      const nh = await readbackF322(ctx, normedHidden, embeddingLength);
      let sabs = 0, mn = Infinity, mx = -Infinity;
      for (const v of nh) {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
        sabs += Math.abs(v);
      }
      console.log(`[bonsai] normedHidden: min=${mn.toFixed(3)} max=${mx.toFixed(3)} meanabs=${(sabs / nh.length).toFixed(4)}`);
      console.log("[bonsai] NH_DUMP " + JSON.stringify(Array.from(nh)));
    }
  }
  const outputWeightName = "output.weight";
  const usingWeightTie = !weights.has(outputWeightName);
  const headWeightName = usingWeightTie ? "token_embd.weight" : outputWeightName;
  if (!weights.has(headWeightName)) {
    throw new Error(
      `bonsai-lmhead: LM head weights '${headWeightName}' not loaded; call weights.loadGlobals(['${headWeightName}']) first`
    );
  }
  const headWeights = weights.get(headWeightName);
  const logits = f32Buffer(ctx.device, vocabSize, "logits");
  projectQuantized(
    ctx,
    normedHidden,
    headWeights,
    logits,
    1,
    embeddingLength,
    vocabSize,
    weights.typeOf(headWeightName)
  );
  lastRow.destroy();
  normedHidden.destroy();
  return logits;
}
var init_embed_lmhead = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/model/embed_lmhead.ts"() {
    "use strict";
    init_dispatch();
    init_ops();
    init_reference();
    init_types();
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai/model/forward.ts
var forward_exports = {};
__export(forward_exports, {
  BONSAI_DEBUG: () => BONSAI_DEBUG,
  bonsaiDebugEnabled: () => bonsaiDebugEnabled,
  captureRow: () => captureRow,
  decodeStep: () => decodeStep,
  prefill: () => prefill
});
function bonsaiDebugEnabled() {
  return globalThis.__BONSAI_DEBUG === true;
}
function captureRow(layer, row) {
  const g = globalThis;
  const tag = g.__BONSAI_CAPTURE_TAG;
  if (!tag) return;
  (g.__BONSAI_ROWS ?? (g.__BONSAI_ROWS = {}))[`${tag}:${layer}`] = row.slice();
}
function captureActive() {
  return typeof globalThis.__BONSAI_CAPTURE_TAG === "string";
}
async function prefill(ctx, hidden, tokenIds, tokenizer, onLayer, posBase = 0) {
  await embedTokens(ctx, tokenIds, hidden, ctx.weights, ctx.config.embeddingLength);
  const embedLen = ctx.config.embeddingLength;
  const lastOff = (tokenIds.length - 1) * embedLen;
  const probeLast = async (label, layer) => {
    if (!bonsaiDebugEnabled() && !captureActive()) return;
    const slice = await readbackF32(ctx, hidden, tokenIds.length * embedLen);
    const row = slice.subarray(lastOff, lastOff + embedLen);
    if (layer !== void 0) {
      const wantPos = globalThis.__BONSAI_CAPTURE_POS;
      const off = typeof wantPos === "number" && wantPos >= 0 && wantPos < tokenIds.length ? wantPos * embedLen : lastOff;
      captureRow(layer, slice.subarray(off, off + embedLen));
    }
    if (!bonsaiDebugEnabled()) return;
    let nan = 0, mn = Infinity, mx = -Infinity, sabs = 0;
    for (let i = 0; i < row.length; i++) {
      const v = row[i];
      if (!Number.isFinite(v)) nan++;
      else {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
        sabs += Math.abs(v);
      }
    }
    console.log(`[bonsai] ${label}: bad=${nan} min=${mn.toFixed(3)} max=${mx.toFixed(3)} meanabs=${(sabs / row.length).toFixed(4)}`);
  };
  const probeRows = async (label, positions) => {
    if (!bonsaiDebugEnabled()) return;
    const slice = await readbackF32(ctx, hidden, tokenIds.length * embedLen);
    for (const p of positions) {
      const row = slice.subarray(p * embedLen, (p + 1) * embedLen);
      let sabs = 0, mn = Infinity, mx = -Infinity;
      for (let i = 0; i < row.length; i++) {
        const v = row[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
        sabs += Math.abs(v);
      }
      console.log(`[bonsai] ${label} pos${p} (id ${tokenIds[p]}): min=${mn.toFixed(4)} max=${mx.toFixed(4)} meanabs=${(sabs / row.length).toFixed(5)}`);
    }
  };
  await probeRows("embed-row", [0, 1, 2, tokenIds.length - 1]);
  await probeLast("after embed");
  const io = { hidden, nTokens: tokenIds.length, posBase };
  for (let l = 0; l < ctx.config.blockCount; l++) {
    for (let ahead = 1; ahead <= READ_AHEAD_LAYERS; ahead++) {
      if (l + ahead < ctx.config.blockCount) ctx.weights.prefetchLayer(l + ahead);
    }
    await ctx.weights.ensureLayer(l);
    onLayer?.(l, ctx.config.blockCount);
    beginBatch(ctx.device);
    try {
      await runBlock(ctx, l, io);
    } finally {
      flushBatch(ctx.device);
      flushDeferred(ctx.device);
    }
    const kind = ctx.config.layerKinds[l];
    await probeLast(`after L${l} (${kind})`, l);
  }
  ctx.kv.advance(tokenIds.length);
  const lastTokenIndex = tokenIds.length - 1;
  const logits = await projectLogits(ctx, hidden, lastTokenIndex, ctx.weights, ctx.config, tokenizer.vocabSize);
  return { logits };
}
async function decodeStep(ctx, hidden, posBase, tokenizer) {
  const io = { hidden, nTokens: 1, posBase };
  const probeDecode = async (l) => {
    if (!bonsaiDebugEnabled() && !captureActive()) return;
    const row = await readbackF32(ctx, hidden, ctx.config.embeddingLength);
    captureRow(l, row);
    if (!bonsaiDebugEnabled()) return;
    let nan = 0, mn = Infinity, mx = -Infinity, sabs = 0;
    for (let i = 0; i < row.length; i++) {
      const v = row[i];
      if (!Number.isFinite(v)) nan++;
      else {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
        sabs += Math.abs(v);
      }
    }
    console.log(
      `[bonsai] DECODE_L${l}: bad=${nan} min=${mn.toFixed(3)} max=${mx.toFixed(3)} meanabs=${(sabs / row.length).toFixed(4)}`
    );
  };
  for (let l = 0; l < ctx.config.blockCount; l++) {
    await ctx.weights.ensureLayer(l);
    beginBatch(ctx.device);
    try {
      await runBlock(ctx, l, io);
    } finally {
      flushBatch(ctx.device);
      flushDeferred(ctx.device);
    }
    await probeDecode(l);
    const inj = globalThis.__BONSAI_INJECT;
    if (inj && inj.layer === l && inj.row.length === ctx.config.embeddingLength) {
      ctx.device.queue.writeBuffer(hidden, 0, inj.row);
      console.log(`[bonsai] INJECT applied at L${l} (decode hidden <- prefill row)`);
    }
  }
  ctx.kv.advance(1);
  const logits = await projectLogits(ctx, hidden, 0, ctx.weights, ctx.config, tokenizer.vocabSize);
  return { logits };
}
var READ_AHEAD_LAYERS, BONSAI_DEBUG;
var init_forward = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai/model/forward.ts"() {
    "use strict";
    init_layers();
    init_embed_lmhead();
    init_ops();
    init_dispatch();
    READ_AHEAD_LAYERS = 3;
    BONSAI_DEBUG = false;
  }
});

// AitherOS/apps/packages/awkit/src/webml/bonsai-worker-core.ts
var bonsai_worker_core_exports = {};
__export(bonsai_worker_core_exports, {
  initBonsaiRuntime: () => initBonsaiRuntime
});
async function initBonsaiRuntime(scope) {
  let runtime = null;
  let currentModelId = "";
  let stopped = false;
  const post = (m) => scope.postMessage(m);
  async function loadKernels() {
    const { WGSL_SOURCES: WGSL_SOURCES2 } = await Promise.resolve().then(() => (init_wgsl_sources(), wgsl_sources_exports));
    return WGSL_SOURCES2;
  }
  async function acquireDevice() {
    const gpu = navigator.gpu;
    if (!gpu) {
      throw new Error("WebGPU not available on this browser");
    }
    let adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {
      adapter = await gpu.requestAdapter({ forceFallbackAdapter: true }).catch(() => null);
    }
    if (!adapter) {
      throw new Error("No WebGPU adapter found");
    }
    const limits = adapter.limits ?? {};
    const requiredLimits = {};
    for (const key of [
      "maxStorageBufferBindingSize",
      "maxBufferSize",
      "maxComputeWorkgroupStorageSize"
    ]) {
      const v = limits[key];
      if (typeof v === "number" && v > 0) requiredLimits[key] = v;
    }
    const device = await adapter.requestDevice({ requiredLimits });
    const mobile = isMobileDevice();
    const budget = maxDispatchesPerSubmit(classifyAdapter(adapter.info), {
      windowsTdr: typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent ?? ""),
      mobile
    });
    if (budget > 0) setSubmitBudget(device, budget);
    return device;
  }
  async function load(modelId) {
    try {
      const device = await acquireDevice();
      const kernelSources = await loadKernels();
      runtime = createBonsaiRuntime({ device, kernelSources });
      currentModelId = modelId;
      await runtime.load({
        modelUrl: resolveBonsaiUrl(modelId),
        onProgress: (p) => post({ type: "progress", progress: p.percent, file: p.detail })
      });
      post({ type: "ready", modelId });
    } catch (e) {
      post({
        type: "error",
        message: `bonsai load failed: ${e.message}`
      });
    }
  }
  async function generate(req) {
    if (!runtime?.loaded) {
      return post({
        type: "error",
        message: "no model loaded \u2014 send {type:'load'} first"
      });
    }
    stopped = false;
    try {
      const { tokenizer, config, device, pipelines, weights } = runtime.loaded;
      const maxTokens = req.maxTokens ?? 256;
      const temperature = req.temperature ?? 0.7;
      const topK = req.topK ?? 20;
      const topP = req.topP ?? 0.95;
      const repetitionPenalty = req.repetitionPenalty ?? 1.1;
      const ANSWER_RESERVE = 128;
      const reasoningBudget = req.reasoningBudget ?? Math.max(32, maxTokens - ANSWER_RESERVE);
      const promptIds = tokenizer.encodeChat(req.messages);
      const promptLen = promptIds.length;
      const KV_CEILING = 8192;
      const KV_CAPACITY = Math.min(KV_CEILING, promptLen + maxTokens + 1);
      if (promptLen + maxTokens + 1 > KV_CEILING) {
        return post({
          type: "error",
          message: `context too long: prompt ${promptLen} + maxTokens ${maxTokens} > ${KV_CEILING} KV slots. Shorten the prompt or lower maxTokens.`
        });
      }
      const { F32KvCache: F32KvCache2 } = await Promise.resolve().then(() => (init_kv_f32(), kv_f32_exports));
      const { SsmState: SsmState2 } = await Promise.resolve().then(() => (init_ssm_state(), ssm_state_exports));
      const { f32Buffer: f32Buffer2, sampleToken: sampleToken2 } = await Promise.resolve().then(() => (init_ops(), ops_exports));
      const { prefill: prefill2, decodeStep: decodeStep2 } = await Promise.resolve().then(() => (init_forward(), forward_exports));
      const { embedTokens: embedTokens2 } = await Promise.resolve().then(() => (init_embed_lmhead(), embed_lmhead_exports));
      const kv = new F32KvCache2(device, {
        fullAttnLayers: config.fullAttnLayers,
        headCountKv: config.headCountKv,
        headDim: config.keyLength ?? config.embeddingLength / config.headCount,
        capacity: KV_CEILING
      });
      const dn = config.deltaNet;
      const ssmState = new SsmState2(device, {
        linearAttnLayers: config.linearAttnLayers,
        heads: dn?.numVHeads ?? 0,
        dK: dn?.headDim ?? 0,
        dV: dn?.headDim ?? 0,
        dConv: dn?.convKernel,
        ssmInnerSize: dn?.vDim,
        convDim: dn?.convDim
      });
      if (!dn && config.linearAttnLayers.length > 0) {
        throw new Error(
          `bonsai: ${config.linearAttnLayers.length} DeltaNet layers classified but model exposes no ssm.* geometry.`
        );
      }
      kv.reset();
      ssmState.reset();
      const hiddenBuffer = f32Buffer2(
        device,
        promptLen * config.embeddingLength,
        "hidden_prefill"
      );
      const decodeHidden = f32Buffer2(
        device,
        config.embeddingLength,
        "hidden_decode"
      );
      const quantType = weights.weightQuantType();
      const ctx = {
        device,
        pipelines,
        weights,
        config,
        kv,
        kvMode: "f32",
        ssm: ssmState,
        quantType
      };
      post({
        type: "progress",
        progress: 10,
        file: `prefill ${promptLen} tokens`
      });
      const prefillStart = Date.now();
      const prefillResult = await prefill2(ctx, hiddenBuffer, promptIds, tokenizer, (l, total) => {
        post({
          type: "progress",
          progress: 10 + Math.floor(l / total * 30),
          file: `layer ${l + 1}/${total}`
        });
      });
      const prefillMs = Date.now() - prefillStart;
      const REPLACEMENT = "\uFFFD";
      const stableText = (ids) => {
        const s = tokenizer.decode(ids);
        let end = s.length;
        while (end > 0 && s[end - 1] === REPLACEMENT) end--;
        return s.slice(0, end);
      };
      const thinkIds = [];
      const answerIds = [];
      let thinkText = "";
      let answerText = "";
      const emit = (ids, prev, channel) => {
        const next = stableText(ids);
        if (next.length > prev.length && next.startsWith(prev)) {
          post({ type: "token", text: next.slice(prev.length), channel });
          return next;
        }
        return next.length >= prev.length ? next : prev;
      };
      let inThink = false;
      if (tokenizer.thinkEndId !== void 0 && tokenizer.thinkStartId !== void 0) {
        const lastOpen = promptIds.lastIndexOf(tokenizer.thinkStartId);
        const lastClose = promptIds.lastIndexOf(tokenizer.thinkEndId);
        inThink = lastOpen !== -1 && lastOpen > lastClose;
      }
      let forcedClose = false;
      const REPEAT_WINDOW = 64;
      const recent = [];
      let logits = prefillResult.logits;
      let pos = promptLen;
      let produced = 0;
      let stopReason = "max-tokens";
      const decodeStartTime = Date.now();
      while (produced < maxTokens && !stopped) {
        const id = await sampleToken2(
          { device, pipelines, quantType },
          logits,
          tokenizer.vocabSize,
          {
            temperature,
            topK,
            topP,
            repetitionPenalty,
            recentIds: recent
          }
        );
        produced++;
        if (tokenizer.isStop(id)) {
          stopReason = "stop-token";
          break;
        }
        recent.push(id);
        if (recent.length > REPEAT_WINDOW) recent.shift();
        if (id === tokenizer.thinkEndId) {
          inThink = false;
        } else if (id === tokenizer.thinkStartId) {
          inThink = true;
        } else if (inThink) {
          thinkIds.push(id);
          thinkText = emit(thinkIds, thinkText, "thinking");
        } else {
          answerIds.push(id);
          answerText = emit(answerIds, answerText, "answer");
        }
        await embedTokens2(ctx, [id], decodeHidden, weights, config.embeddingLength);
        logits = (await decodeStep2(ctx, decodeHidden, pos++, tokenizer)).logits;
        if (inThink && !forcedClose && tokenizer.thinkEndId !== void 0 && produced >= reasoningBudget) {
          forcedClose = true;
          inThink = false;
          await embedTokens2(
            ctx,
            [tokenizer.thinkEndId],
            decodeHidden,
            weights,
            config.embeddingLength
          );
          logits = (await decodeStep2(ctx, decodeHidden, pos++, tokenizer)).logits;
          post({ type: "progress", file: "reasoning budget reached \u2014 answering" });
        }
        const progress = 10 + Math.floor(produced / maxTokens * 80);
        const tps = produced / ((Date.now() - decodeStartTime) / 1e3);
        const phase = inThink ? "thinking" : "answering";
        post({
          type: "progress",
          progress,
          file: `${phase} \xB7 ${produced} tok \xB7 ${tps.toFixed(1)} tok/s`
        });
      }
      if (stopped) stopReason = "interrupted";
      const elapsedMs = Date.now() - decodeStartTime;
      const tokensPerSecond = produced > 0 ? produced / elapsedMs * 1e3 : 0;
      const reply = answerText.trim() || (thinkText.trim() ? "I ran out of room to finish that thought \u2014 my reasoning is above. Ask again and I'll be more direct." : "");
      post({
        type: "done",
        text: reply,
        reasoning: thinkText.trim() || void 0,
        tokensPerSecond
      });
    } catch (e) {
      post({
        type: "error",
        message: `bonsai generate failed: ${e.message}`
      });
    }
  }
  return { load, generate, interrupt: () => {
    stopped = true;
  } };
}
var init_bonsai_worker_core = __esm({
  "AitherOS/apps/packages/awkit/src/webml/bonsai-worker-core.ts"() {
    "use strict";
    init_bonsai();
    init_gpu_class();
    init_dispatch();
    init_device_class();
    init_bonsai_models();
  }
});

// AitherOS/apps/packages/awkit/src/webml/models.ts
var WEBML_MODELS = [
  // Bonsai models via our own clean-room WGSL kernels (ported from the PrismML llama.cpp fork).
  // Aitherium's kernels, running on YOUR GPU, in your browser. Four sizes, all live as of 2026-07-28.
  {
    id: "bonsai-1.7b",
    label: "Bonsai 1.7B (Phone)",
    repo: "prism-ml/Bonsai-1.7B-gguf",
    runtime: "bonsai-kernels",
    task: "text-generation",
    approxDownloadMB: 236,
    blurb: "Lightest size \u2014 236 MB, designed for phones and older devices.",
    ready: true
  },
  {
    id: "bonsai-4b",
    label: "Bonsai 4B (Default)",
    repo: "prism-ml/Bonsai-4B-gguf",
    runtime: "bonsai-kernels",
    task: "text-generation",
    approxDownloadMB: 545,
    blurb: "Balanced: smart and fast \u2014 the recommended in-browser model.",
    ready: true
  },
  {
    id: "bonsai-8b",
    label: "Bonsai 8B (Desktop)",
    repo: "prism-ml/Bonsai-8B-gguf",
    runtime: "bonsai-kernels",
    task: "text-generation",
    approxDownloadMB: 1104,
    blurb: "Better reasoning, ~1 GB. Desktop GPU with 8+ GB RAM.",
    ready: true
  },
  {
    id: "bonsai-27b-text",
    label: "Bonsai 27B (Reasoning)",
    repo: "prism-ml/Bonsai-27B-gguf",
    runtime: "bonsai-kernels",
    task: "text-generation",
    approxDownloadMB: 3800,
    blurb: "Full reasoning brain. 3.6 GB, needs a real desktop GPU (e.g., RTX 4090).",
    ready: true
  },
  {
    // Gemma via transformers.js needs an ONNX build; the mobile-QAT repo has none
    // (it's for custom kernels, like the webml-community Space). Not runnable on
    // the transformers.js path — kept as a slot until we ship Gemma WGSL kernels.
    id: "gemma-4-e2b",
    label: "Gemma 4 (E2B, mobile)",
    repo: "google/gemma-4-E2B-it-qat-mobile-transformers",
    runtime: "transformers-js",
    task: "text-generation",
    dtype: "q4",
    approxDownloadMB: 900,
    blurb: "Google's QAT mobile Gemma 4 \u2014 needs its own WebGPU kernels (coming).",
    ready: false
  },
  {
    id: "bonsai-image",
    label: "Bonsai Image",
    repo: "prism-ml/Bonsai-27B-gguf",
    runtime: "bonsai-image",
    task: "text-to-image",
    approxDownloadMB: 3800,
    blurb: "In-browser image generation via custom WebGPU kernels (Phase 4 \u2014 not yet wired).",
    ready: false
  }
];
function getWebMLModel(id) {
  return WEBML_MODELS.find((m) => m.id === id);
}

// AitherOS/apps/packages/awkit/src/webml/worker-core.ts
function runWebMLWorker(scope, deps) {
  let runtimeHandler = null;
  async function handleFirstLoad(modelId) {
    const model = getWebMLModel(modelId);
    if (!model) {
      scope.postMessage({
        type: "error",
        message: `unknown model '${modelId}'`
      });
      return;
    }
    if (model.runtime === "transformers-js") {
      const handler = await initTransformersRuntime(scope, deps);
      runtimeHandler = handler;
      handler({ type: "load", modelId });
    } else if (model.runtime === "bonsai-kernels") {
      const handler = await initBonsaiRuntime2(scope);
      runtimeHandler = handler;
      handler({ type: "load", modelId });
    } else {
      scope.postMessage({
        type: "error",
        message: `model '${modelId}' uses the '${model.runtime}' runtime, not wired in this worker yet`
      });
    }
  }
  scope.addEventListener("message", (e) => {
    const req = e.data;
    if (!runtimeHandler) {
      if (req.type === "load") {
        void handleFirstLoad(req.modelId);
      }
    } else {
      runtimeHandler(req);
    }
  });
}
async function initTransformersRuntime(scope, deps) {
  let pipe = null;
  let stopped = false;
  const post = (msg) => scope.postMessage(msg);
  async function load(modelId) {
    const model = getWebMLModel(modelId);
    if (!model) return post({ type: "error", message: `unknown model '${modelId}'` });
    try {
      const { pipeline } = await deps.loadTransformers();
      pipe = await pipeline(model.task, model.repo, {
        device: "webgpu",
        dtype: model.dtype ?? "q4",
        progress_callback: (p) => {
          if (p && p.status === "progress") post({ ...p, type: "progress" });
        }
      });
      post({ type: "ready", modelId });
    } catch (e) {
      post({ type: "error", message: `load failed: ${e.message}` });
    }
  }
  async function generate(req) {
    if (!pipe) return post({ type: "error", message: "no model loaded \u2014 send {type:'load'} first" });
    stopped = false;
    try {
      const { TextStreamer } = await deps.loadTransformers();
      const generator = pipe;
      let count = 0;
      const start = performance.now();
      const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text2) => {
          if (stopped) return;
          count += 1;
          post({ type: "token", text: text2 });
        }
      });
      const out = await generator(req.messages, {
        max_new_tokens: req.maxTokens ?? 512,
        do_sample: (req.temperature ?? 0) > 0,
        temperature: req.temperature ?? 1,
        streamer
      });
      const seconds = (performance.now() - start) / 1e3;
      const last = out?.[0]?.generated_text;
      const text = Array.isArray(last) && last.length ? String(last[last.length - 1]?.content ?? "") : String(last ?? "");
      post({ type: "done", text, tokensPerSecond: seconds > 0 ? count / seconds : void 0 });
    } catch (e) {
      post({ type: "error", message: `generate failed: ${e.message}` });
    }
  }
  return (req) => {
    if (req.type === "load") void load(req.modelId);
    else if (req.type === "generate") void generate(req);
    else if (req.type === "interrupt") stopped = true;
  };
}
async function initBonsaiRuntime2(scope) {
  const { initBonsaiRuntime: createBonsaiHandler } = await Promise.resolve().then(() => (init_bonsai_worker_core(), bonsai_worker_core_exports));
  const handler = await createBonsaiHandler(scope);
  return (req) => {
    if (req.type === "load") void handler.load(req.modelId);
    else if (req.type === "generate") void handler.generate(req);
    else if (req.type === "interrupt") handler.interrupt();
  };
}

// AitherOS/apps/packages/awkit/src/webml/webml-text.entry.ts
init_bonsai_models();

// AitherOS/apps/packages/awkit/src/webml/tool-loop.ts
var MAX_TOOL_ROUNDS = 3;
function renderToolsSystemBlock(specs) {
  let out = "You may call functions to help answer the user.\n\n";
  out += "You are provided with function signatures within <tools></tools> XML tags:\n";
  out += "<tools>";
  for (const tool of specs) out += "\n" + JSON.stringify(tool);
  out += "\n</tools>\n\n";
  out += "For each function call, return a json object with function name and ";
  out += "arguments within <tool_call></tool_call> XML tags:\n";
  out += '<tool_call>\n{"name": <function-name>, "arguments": <args-json-object>}\n</tool_call>';
  return out;
}
function parseToolCalls(text) {
  const calls = [];
  let rest = text;
  const patterns = [
    /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g,
    /<tool_call>\s*(\{[\s\S]*\})\s*$/g
  ];
  for (const re of patterns) {
    rest = rest.replace(re, (whole, body) => {
      const parsed = tryParseCallBody(body);
      if (parsed) {
        calls.push({ ...parsed, raw: whole });
        return "";
      }
      return whole;
    });
    if (calls.length) break;
  }
  return { calls, rest: rest.trim() };
}
function tryParseCallBody(body) {
  const candidates = [
    body,
    // Small-model repairs: trailing commas, single→double quotes on keys.
    body.replace(/,\s*([}\]])/g, "$1"),
    body.replace(/'/g, '"').replace(/,\s*([}\]])/g, "$1")
  ];
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      const name = obj?.name;
      if (typeof name === "string" && name) {
        const args = obj.arguments ?? obj.parameters ?? {};
        return { name, arguments: typeof args === "object" && args ? args : {} };
      }
    } catch {
    }
  }
  return null;
}

// AitherOS/apps/packages/awkit/src/webml/webml-text.entry.ts
init_device_class();
var DEFAULT_ENTRY_URL = new URL("./bonsai-worker-entry.js?v=2", import.meta.url).href;
function createBonsaiChatWorker(opts) {
  const entry = opts?.entryUrl ?? DEFAULT_ENTRY_URL;
  const worker = new Worker(entry, { type: "module" });
  const listeners = /* @__PURE__ */ new Set();
  const fail = (message) => {
    for (const l of listeners) l({ type: "error", message });
  };
  worker.addEventListener("message", (e) => {
    const msg = e.data;
    for (const l of listeners) l(msg);
  });
  worker.addEventListener("error", (e) => {
    fail("on-device worker failed to start: " + (e && e.message || "module load error"));
  });
  worker.addEventListener("messageerror", () => {
    fail("on-device worker rejected a message (protocol mismatch)");
  });
  return {
    post: (msg) => worker.postMessage(msg),
    on: (listener) => {
      listeners.add(listener);
    },
    interrupt: () => worker.postMessage({ type: "interrupt" }),
    dispose: () => worker.terminate()
  };
}
export {
  BONSAI_MODELS_INFO,
  DEFAULT_BONSAI_MODEL_ID,
  FIRST_TOKEN_FAIL_MS,
  LOAD_FAIL_MS,
  MAX_TOOL_ROUNDS,
  autoBootAllowed,
  classifyAdapter2 as classifyAdapter,
  createBonsaiChatWorker,
  getBonsaiModel,
  gpuLaneAllowed,
  isMobileDevice,
  parseToolCalls,
  pickBonsaiContext,
  renderToolsSystemBlock,
  resolveBonsaiUrl,
  runWebMLWorker,
  suggestBonsaiModelId
};
