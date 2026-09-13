// A minimal deterministic zip writer.
//
// Only the Windows artifact needs zip, and only ever with a handful of stored
// entries, so this writes the classic three-part layout (local headers, central
// directory, end record) with deflate and no extras. Like the tar writer, every
// timestamp is a constant.

import { deflateRawSync, inflateRawSync } from "node:zlib";

// DOS time/date for 1980-01-01 00:00:00, the earliest a zip can express. Using
// the floor rather than "now" is what keeps rebuilds byte-identical.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const VERSION_MADE_BY = 0x031e; // upper byte 3 = Unix, so external attrs carry the mode
const VERSION_NEEDED = 20; // 2.0 — deflate
const METHOD_DEFLATE = 8;

let crcTable = null;

function crc32(buf) {
  if (crcTable === null) {
    crcTable = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c;
    }
  }
  let crc = -1;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

/**
 * Build a zip archive.
 *
 * @param {{name: string, mode: number, body: Buffer}[]} files in the order given
 * @returns {Buffer}
 */
export function writeZip(files) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const compressed = deflateRawSync(file.body, { level: 9 });
    const crc = crc32(file.body);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(VERSION_NEEDED, 4);
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(METHOD_DEFLATE, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(file.body.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28); // extra field length
    local.push(header, name, compressed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(VERSION_MADE_BY, 4);
    entry.writeUInt16LE(VERSION_NEEDED, 6);
    entry.writeUInt16LE(0, 8); // flags
    entry.writeUInt16LE(METHOD_DEFLATE, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(file.body.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(0, 30); // extra
    entry.writeUInt16LE(0, 32); // comment
    entry.writeUInt16LE(0, 34); // disk number
    entry.writeUInt16LE(0, 36); // internal attrs
    // External attrs: Unix mode in the high 16 bits, so `unzip` on a Unix host
    // restores the executable bit. Windows ignores this and uses its own rules.
    entry.writeUInt32LE(((0o100000 | file.mode) >>> 0) * 0x10000, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += header.length + name.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...local, centralBuf, end]);
}

/**
 * Read a zip written by writeZip. Enough of the format to let the verifier
 * inspect the Windows artifact the same way it inspects the tarballs — it
 * walks the central directory rather than scanning for local headers.
 *
 * @param {Buffer} buf
 * @returns {{name: string, mode: number, body: Buffer}[]}
 */
export function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end === -1) throw new Error("not a zip: no end-of-central-directory record");

  const count = buf.readUInt16LE(end + 10);
  let offset = buf.readUInt32LE(end + 16);
  const files = [];

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error("corrupt central directory");

    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const externalAttrs = buf.readUInt32LE(offset + 38);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buf.subarray(start, start + compressedSize);

    files.push({
      name,
      mode: (externalAttrs >>> 16) & 0o7777,
      body: method === 0 ? Buffer.from(raw) : inflateRawSync(raw),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}
