// The byte layer: reading and writing the game's little-endian layouts
// (the brief's section 4.1). Everything above it - the messages, the facts,
// the telemetry - is made of these.
//
// A u64 is read as a BigInt; num() reads one as a Number, refusing one at or
// above 2^53, which ids and credits never reach in practice. A reader must
// consume exactly the bytes it was given: end() says whether bytes are left
// over, and any shortfall or leftover is Malformed - the frame is dropped
// and the socket with it.

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const ENCODER = new TextEncoder();
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Bytes that do not make the layout they should: logged, the socket dropped, and the game rejoined. */
export class Malformed extends Error {}

export class Reader {
  constructor(bytes) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.at = 0;
  }

  get left() { return this.bytes.length - this.at; }

  _take(count, what) {
    if (count > this.left) throw new Malformed(`${what}: ${count} bytes wanted at ${this.at}, ${this.left} left`);
    const from = this.at;
    this.at += count;
    return from;
  }

  u8(what = "a u8") { return this.view.getUint8(this._take(1, what)); }
  u16(what = "a u16") { return this.view.getUint16(this._take(2, what), true); }
  u32(what = "a u32") { return this.view.getUint32(this._take(4, what), true); }
  u64(what = "a u64") { return this.view.getBigUint64(this._take(8, what), true); }
  i64(what = "an i64") { return this.view.getBigInt64(this._take(8, what), true); }
  f32(what = "an f32") { return this.view.getFloat32(this._take(4, what), true); }

  f64(what = "an f64") {
    const read = this.view.getFloat64(this._take(8, what), true);
    if (!Number.isFinite(read)) throw new Malformed(`${what} is not a finite number`);
    return read;
  }

  bool(what = "a bool") {
    const read = this.u8(what);
    if (read > 1) throw new Malformed(`${what} is ${read}, neither 0 nor 1`);
    return read === 1;
  }

  /** A u64 as a Number: an id, an amount of credits, a count. */
  num(what = "a number") {
    const read = this.u64(what);
    if (read > SAFE) throw new Malformed(`${what} is ${read}, too large to hold as a number`);
    return Number(read);
  }

  /** An i64 as a Number: milliseconds since 1970. */
  time(what = "a time") {
    const read = this.i64(what);
    if (read > SAFE || read < -SAFE) throw new Malformed(`${what} is ${read}, out of range`);
    return Number(read);
  }

  /** A u32 byte length, then that many bytes. */
  run(what = "a run") {
    const length = this.u32(what);
    const from = this._take(length, what);
    return this.bytes.subarray(from, from + length);
  }

  /** A run read by a reader of its own, which must use all of it. */
  inside(read, what = "a run") {
    const inner = new Reader(this.run(what));
    const made = read(inner);
    inner.end(what);
    return made;
  }

  text(what = "a text") {
    try { return UTF8.decode(this.run(what)); } catch (error) {
      if (error instanceof Malformed) throw error;
      throw new Malformed(`${what} is not UTF-8`);
    }
  }

  hash(what = "a hash") { const from = this._take(32, what); return this.bytes.subarray(from, from + 32); }

  skip(count, what = "skipped bytes") { this._take(count, what); }

  /** A u32 count, then that many of what read reads. */
  list(read, what = "a list") {
    const count = this.u32(what);
    const made = [];
    for (let i = 0; i < count; i++) made.push(read(this));
    return made;
  }

  /** Every byte used, or Malformed. */
  end(what = "the frame") {
    if (this.left !== 0) throw new Malformed(`${what}: ${this.left} bytes left over`);
  }
}

export class Writer {
  constructor() {
    this._buffer = new ArrayBuffer(64);
    this._view = new DataView(this._buffer);
    this.length = 0;
  }

  _room(count) {
    if (this.length + count <= this._buffer.byteLength) return this.length;
    let size = this._buffer.byteLength * 2;
    while (size < this.length + count) size *= 2;
    const grown = new ArrayBuffer(size);
    new Uint8Array(grown).set(new Uint8Array(this._buffer, 0, this.length));
    this._buffer = grown;
    this._view = new DataView(grown);
    return this.length;
  }

  _put(count, write) { const at = this._room(count); write(this._view, at); this.length += count; return this; }

  u8(value) { return this._put(1, (v, at) => v.setUint8(at, value)); }
  u16(value) { return this._put(2, (v, at) => v.setUint16(at, value, true)); }
  u32(value) { return this._put(4, (v, at) => v.setUint32(at, value, true)); }
  u64(value) { return this._put(8, (v, at) => v.setBigUint64(at, BigInt(value), true)); }
  i64(value) { return this._put(8, (v, at) => v.setBigInt64(at, BigInt(value), true)); }
  f32(value) { return this._put(4, (v, at) => v.setFloat32(at, value, true)); }
  f64(value) { return this._put(8, (v, at) => v.setFloat64(at, value, true)); }
  bool(value) { return this.u8(value ? 1 : 0); }

  raw(bytes) {
    const at = this._room(bytes.length);
    new Uint8Array(this._buffer, at, bytes.length).set(bytes);
    this.length += bytes.length;
    return this;
  }

  run(bytes) { return this.u32(bytes.length).raw(bytes); }
  text(words) { return this.run(ENCODER.encode(words)); }

  /** A run written by a writer of its own. */
  inside(write) { const inner = new Writer(); write(inner); return this.run(inner.bytes()); }

  list(items, write) { this.u32(items.length); for (const item of items) write(this, item); return this; }

  bytes() { return new Uint8Array(this._buffer.slice(0, this.length)); }
}
