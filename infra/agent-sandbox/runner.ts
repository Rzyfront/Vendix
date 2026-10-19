/**
 * Trusted, import-free initial module. NEVER run this on the API host or on macOS.
 * Permissions are a second layer; the Linux supervisor/gVisor/cgroups are mandatory.
 * The entire guest (including this SDK and its stdout) is untrusted to the host.
 */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface Limits {
  wall_ms: number;
  cpu_ms: number;
  memory_mb: number;
  calls: number;
  concurrency: number;
  pages: number;
  rows: number;
  input_bytes: number;
  output_bytes: number;
  source_bytes: number;
}
interface StartFrame {
  type: "start";
  execution_id: string;
  nonce: string;
  source: string;
  language: "javascript" | "typescript";
  tools: string[];
  limits: Limits;
  policy_digest: string;
  runtime_digest: string;
}
interface ReplyFrame {
  type: "reply";
  execution_id: string;
  nonce: string;
  seq: number;
  result?: Json;
  error?: "SANDBOX_DENIED";
}

// Capture transport before exposing any generated code. This is hardening, not an
// authorization mechanism: the host validates even perfectly forged guest frames.
const read = Deno.stdin.read.bind(Deno.stdin);
const write = Deno.stdout.write.bind(Deno.stdout);
const exit = Deno.exit.bind(Deno);
const parse = JSON.parse.bind(JSON);
const stringify = JSON.stringify.bind(JSON);
const keys = Object.keys.bind(Object);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const encode = encoder.encode.bind(encoder);
const decode = decoder.decode.bind(decoder);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;
const MAX_FRAME_BYTES = 2 * 1024 * 1024 + 4096;
let buffer = new Uint8Array(0);
let sentBytes = 0;
let replyBytes = 0;
let outputLimit = 65536;
let ended = false;
let writeQueue: Promise<void> = Promise.resolve();

function denied(): never {
  // No source, args, result, error.stack or exception.message in stderr.
  ended = true;
  exit(1);
}

async function nextFrame(maxBytes: number): Promise<{ frame: unknown; bytes: number }> {
  while (true) {
    const newline = buffer.indexOf(10);
    if (newline >= 0) {
      if (newline > maxBytes) denied();
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      return { frame: parse(decode(line)), bytes: newline + 1 };
    }
    if (buffer.length > maxBytes) denied();
    const chunk = new Uint8Array(8192);
    const count = await read(chunk);
    if (count === null) denied();
    const merged = new Uint8Array(buffer.length + count);
    merged.set(buffer);
    merged.set(chunk.subarray(0, count), buffer.length);
    buffer = merged;
  }
}

function emit(frame: unknown): Promise<void> {
  const data = encode(stringify(frame) + "\n");
  sentBytes += data.byteLength;
  if (sentBytes > outputLimit || ended) denied();
  writeQueue = writeQueue.then(async () => {
    let offset = 0;
    while (offset < data.length) {
      offset += await write(data.subarray(offset));
    }
  });
  return writeQueue;
}

async function main(): Promise<void> {
  const initial = await nextFrame(131072);
  const start = initial.frame as StartFrame;
  if (
    !start || start.type !== "start" || typeof start.source !== "string" ||
    !["javascript", "typescript"].includes(start.language) || !Array.isArray(start.tools) ||
    !start.limits || start.limits.output_bytes > 65536 ||
    encode(start.source).byteLength > start.limits.source_bytes ||
    start.limits.source_bytes > 32768
  ) denied();
  outputLimit = start.limits.output_bytes;
  const pending = new Map<number, {
    resolve: (value: Json) => void;
    reject: (reason: Error) => void;
  }>();
  let sequence = 0;
  const tools: Record<string, (args: Record<string, Json>) => Promise<Json>> = Object.create(null);
  for (const tool of start.tools) {
    tools[tool] = (args) => {
      if (
        ended || sequence >= start.limits.calls || pending.size >= start.limits.concurrency ||
        !args || typeof args !== "object" || Array.isArray(args)
      ) return Promise.reject(new Error("SANDBOX_DENIED"));
      const seq = ++sequence;
      return new Promise<Json>((resolve, reject) => {
        pending.set(seq, { resolve, reject });
        void emit({
          type: "call", execution_id: start.execution_id, nonce: start.nonce, seq, tool, args,
        }).catch(denied);
      });
    };
  }
  Object.freeze(tools);

  // Only one reader owns stdio. Source receives no context, credentials or initial
  // module specifier. A local/remote/npm/JSR dynamic import still needs permissions
  // denied by CLI; static import is invalid in an AsyncFunction body.
  const pump = async () => {
    while (!ended) {
      const received = await nextFrame(MAX_FRAME_BYTES);
      replyBytes += received.bytes;
      if (replyBytes > start.limits.input_bytes) denied();
      const reply = received.frame as ReplyFrame;
      if (
        !reply || reply.type !== "reply" || reply.execution_id !== start.execution_id ||
        reply.nonce !== start.nonce || !Number.isSafeInteger(reply.seq) ||
        !pending.has(reply.seq) ||
        keys(reply).some((key) => !["type", "execution_id", "nonce", "seq", "result", "error"].includes(key)) ||
        (Object.hasOwn(reply, "result") === Object.hasOwn(reply, "error")) ||
        (Object.hasOwn(reply, "error") && reply.error !== "SANDBOX_DENIED")
      ) denied();
      const callback = pending.get(reply.seq)!;
      pending.delete(reply.seq);
      if (Object.hasOwn(reply, "error")) callback.reject(new Error("SANDBOX_DENIED"));
      else callback.resolve(reply.result as Json);
    }
  };
  void pump().catch(denied);

  // Defense in depth / narrow ergonomic surface, NOT a JS security boundary.
  // Deno permission flags, no host mounts and the external capsule remain required.
  for (const name of [
    "Deno", "Worker", "SharedWorker", "fetch", "WebSocket", "EventSource", "process",
    "WebAssembly",
  ]) {
    Object.defineProperty(globalThis, name, {
      value: undefined, writable: false, configurable: false,
    });
  }
  Object.defineProperty(globalThis, "console", {
    value: Object.freeze({
      log: denied, info: denied, warn: denied, error: denied, debug: denied, trace: denied,
    }), writable: false, configurable: false,
  });

  // TS is deliberately the JS-valid subset + JSDoc; no regex erasure, compiler,
  // module Worker, user initial graph or dependency installation is involved.
  const execute = new AsyncFunction("tools", '"use strict";\n' + start.source);
  const result = await execute(tools);
  if (pending.size !== 0 || result === undefined) denied();
  const encoded = stringify(result); // BigInt/cycles/functions/undefined fail closed.
  if (encoded === undefined) denied();
  await emit({
    type: "result", execution_id: start.execution_id, nonce: start.nonce,
    value: parse(encoded),
  });
  ended = true;
  // Keep the stdin read alive until the supervisor kills the WHOLE capsule.
  // Exiting here races cgroup removal vs the supervisor's final metrics sample.
  // A result is a candidate value, never proof of a successful domain operation.
  await new Promise<void>(() => {});
}

main().catch(denied);
