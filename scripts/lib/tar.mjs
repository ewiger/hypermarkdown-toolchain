// A minimal POSIX ustar reader and writer.
//
// Shelling out to `tar` would be shorter, but the flags that make an archive
// byte-reproducible (--sort, --owner, --mtime) are GNU-only, and this repo is
// built on Linux CI and inspected on macOS. Doing it here means one behaviour
// everywhere, and it lets the writer state plainly that every field except the
// name, size and mode is a constant.

import { gzipSync, gunzipSync } from "node:zlib";

const BLOCK = 512;

const TYPE_FILE = "0";
const TYPE_DIR = "5";
const TYPE_GNU_LONGNAME = "L";
const TYPE_PAX_NEXT = "x";
const TYPE_PAX_GLOBAL = "g";

function octal(value, width) {
  // ustar numeric fields are NUL-terminated octal, zero-padded to width - 1.
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

function readString(block, offset, length) {
  const raw = block.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8");
}

function readOctal(block, offset, length) {
  const text = readString(block, offset, length).trim();
  return text === "" ? 0 : parseInt(text, 8);
}

/**
 * Parse a gzipped tar into entries. Only what upstream release tarballs
 * actually contain is supported: files, directories, and the long-name and pax
 * records that some archivers emit ahead of them.
 *
 * @param {Buffer} gzipped
 * @returns {{name: string, mode: number, type: string, body: Buffer}[]}
 */
export function readTarGz(gzipped) {
  const buf = gunzipSync(gzipped);
  const entries = [];
  let offset = 0;
  let pendingName = null;

  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK);
    offset += BLOCK;

    // Two consecutive zero blocks end the archive; one is enough to stop here.
    if (header.every((byte) => byte === 0)) break;

    const size = readOctal(header, 124, 12);
    const type = readString(header, 156, 1) || TYPE_FILE;
    const body = buf.subarray(offset, offset + size);
    offset += Math.ceil(size / BLOCK) * BLOCK;

    if (type === TYPE_GNU_LONGNAME) {
      pendingName = body.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    if (type === TYPE_PAX_NEXT || type === TYPE_PAX_GLOBAL) {
      // pax records can override the name; that is the only field we care about.
      const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString("utf8"));
      if (match && type === TYPE_PAX_NEXT) pendingName = match[1];
      continue;
    }

    const prefix = readString(header, 345, 155);
    const name = pendingName ?? (prefix ? `${prefix}/${readString(header, 0, 100)}` : readString(header, 0, 100));
    pendingName = null;

    entries.push({
      name,
      mode: readOctal(header, 100, 8),
      type: type === TYPE_DIR || name.endsWith("/") ? TYPE_DIR : type,
      body: Buffer.from(body),
    });
  }

  return entries;
}

function ustarHeader(name, mode, size, type) {
  const header = Buffer.alloc(BLOCK);

  // Names in this repo's archives are short by construction (`bin/d2`,
  // `manifest.json`, `licenses/d2/LICENSE`), so the 100-byte field always fits
  // and the prefix field stays empty. Refuse rather than silently truncate.
  const nameBytes = Buffer.from(name, "utf8");
  if (nameBytes.length > 100) throw new Error(`archive entry name too long for ustar: ${name}`);

  nameBytes.copy(header, 0);
  header.write(octal(mode, 8), 100, "ascii");
  header.write(octal(0, 8), 108, "ascii"); // uid
  header.write(octal(0, 8), 116, "ascii"); // gid
  header.write(octal(size, 12), 124, "ascii");
  header.write(octal(0, 12), 136, "ascii"); // mtime — fixed, see writeTarGz
  header.write("        ", 148, "ascii"); // checksum placeholder: eight spaces
  header.write(type, 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  // uname/gname left empty so the archive carries no build-machine identity.
  header.write(octal(0, 8), 329, "ascii"); // devmajor
  header.write(octal(0, 8), 337, "ascii"); // devminor

  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(octal(checksum, 7), 148, "ascii");
  header.write("\0 ", 154, "ascii");

  return header;
}

/**
 * Build a gzipped tar. Every entry gets mtime 0, uid/gid 0 and empty
 * uname/gname, and gzip is given no filename or timestamp, so the same inputs
 * always produce the same bytes.
 *
 * @param {{name: string, mode: number, body: Buffer}[]} files in the order given
 * @returns {Buffer}
 */
export function writeTarGz(files) {
  const chunks = [];

  for (const file of files) {
    chunks.push(ustarHeader(file.name, file.mode, file.body.length, TYPE_FILE));
    chunks.push(file.body);
    const remainder = file.body.length % BLOCK;
    if (remainder !== 0) chunks.push(Buffer.alloc(BLOCK - remainder));
  }

  chunks.push(Buffer.alloc(BLOCK * 2)); // end-of-archive marker

  // level 9 for stability across zlib builds at the same level; mtime 0 keeps
  // the gzip header free of a build timestamp.
  const gz = gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });

  // Byte 9 of the gzip header is the OS the stream was produced on, and zlib
  // fills it in from the build it is running in: 0x03 on Linux, 0x13 on Darwin.
  // Nothing reads it, but it is a byte, and a byte is the difference between
  // "reproducible" and "reproducible if you build on the same kind of machine".
  // v0.1.0 shipped with the Linux value from CI and a macOS build of the same
  // `toolchain.json` produced five different digests; pinning it to 0xff,
  // "unknown", makes the output a function of the inputs alone.
  gz[9] = 0xff;
  return gz;
}
