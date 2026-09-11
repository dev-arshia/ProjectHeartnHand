// backend/matching/photo.js
//
// Photo similarity as an actual scoring signal — not just a side-by-side
// display. Uses perceptual hashing (blockhash), a well-established,
// pre-deep-learning image fingerprinting technique: it downsamples an
// image and encodes relative brightness patterns into a bit string, so
// two similar-looking photos end up with similar hashes even if resized
// or slightly recompressed. This is NOT face recognition and doesn't
// know anything about identity — it's comparing overall visual
// similarity (framing, lighting, clothing colors), which is a real but
// modest signal. Labeled "experimental" everywhere it's shown, per our
// own rule against overclaiming accuracy we haven't validated.
//
// Deliberately pure-JS (blockhash-core + jpeg-js + pngjs) — no native
// compiler needed, learned that lesson with better-sqlite3 earlier in
// this project. Fails soft: any decode error just means no photo score
// for that pair, never a crash.

const fs = require('node:fs');
const path = require('node:path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const { bmvbhash } = require('blockhash-core');

const HASH_BITS = 16; // 16x16 -> 256-bit hash; blockhash's typical setting

function decodeImage(filePath) {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.png') {
    const png = PNG.sync.read(buffer);
    return { data: png.data, width: png.width, height: png.height };
  }
  // jpeg-js also happens to decode most .jpg/.jpeg/.webp-mislabeled files
  // people upload; if it can't, computePhotoHash's try/catch handles it.
  const jpg = jpeg.decode(buffer, { useTArray: true });
  return { data: jpg.data, width: jpg.width, height: jpg.height };
}

/**
 * Computes a perceptual hash for an uploaded photo, given its web path
 * (e.g. "/uploads/abc123.jpg" as stored on the report). Returns a hex
 * hash string, or null if the file can't be read/decoded.
 */
function computePhotoHash(webPath) {
  if (!webPath) return null;
  try {
    const diskPath = path.join(__dirname, '..', webPath.replace(/^\/uploads\//, 'uploads/'));
    const image = decodeImage(diskPath);
    return bmvbhash(image, HASH_BITS);
  } catch (err) {
    console.error(`[photo] could not hash ${webPath}: ${err.message}`);
    return null;
  }
}

/**
 * Compares two perceptual hashes and returns a 0-100 similarity score,
 * or null if either hash is missing. Uses Hamming distance (how many
 * bit positions differ) normalized to the hash length.
 */
function scorePhotoHashes(hashA, hashB) {
  if (!hashA || !hashB || hashA.length !== hashB.length) return null;

  let differing = 0;
  for (let i = 0; i < hashA.length; i++) {
    if (hashA[i] !== hashB[i]) differing++;
  }

  const similarity = 1 - differing / hashA.length;
  return Math.round(similarity * 100);
}

module.exports = { computePhotoHash, scorePhotoHashes };
