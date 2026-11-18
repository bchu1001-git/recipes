// Finds the pictures in a job file that carries them inside it.
//
// A Shortcut that shares pictures from another app (a note, the photo library) cannot make several
// files in one go, so it sends one, inbox/job-<number>.json. The Send Notes/Photos to Recipes Shortcut sends the
// base64 of each picture on a line of its own and nothing else. The tidier form, for anything else
// that sends pictures this way, is JSON:
//
//   { "job": "photos", "pictures": ["<base64 of a picture>", "<base64 of the next>"] }
//
// Both are read by the same code, and forgivingly, because the Shortcut is put together by hand. The
// pictures are found by what they are, not by where they sit: any run of base64 that begins the way
// a JPEG or a PNG begins is a picture. So it does not matter whether there is JSON around them, whether
// the base64 was written with line breaks in it, what the pictures were joined with, whether they
// came as PNG instead of JPEG, or what else is mixed in with them.

export const MAX_PICTURE = 8 * 1024 * 1024;   // bytes in one picture

const STARTS = /^(?:\/9j\/|iVBORw0KGgo)/;     // how the base64 of a JPEG and of a PNG begin
const NEXT = /\s+(?=\/9j\/|iVBORw0KGgo)/;     // a gap, and then what may be the beginning of another picture
const JPEG_END = Buffer.from([0xff, 0xd9]);
const PNG_END = Buffer.from('IEND');

/** 'image/jpeg', 'image/png', or '' for anything else. Told from the first bytes, never from a name. */
export function typeOf(bytes) {
  if (!bytes || bytes.length < 8) return '';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  return '';
}

/** Whether the bytes run to the end of their picture: a JPEG's closing marker, or a PNG's last chunk. */
function whole(bytes) {
  const type = typeOf(bytes);
  const tail = bytes.subarray(Math.max(0, bytes.length - 32));
  if (type === 'image/jpeg') return tail.includes(JPEG_END);
  if (type === 'image/png') return tail.includes(PNG_END);
  return false;
}

const decode = (base64) => Buffer.from(base64, 'base64');

/**
 * Every picture in the text of a job file, in the order they come:
 * { pictures: [{ data: Buffer, type, ext }], skipped }. `skipped` counts what began like a picture
 * but was not kept: not a JPEG or PNG after all, too large, or more than `most`. Never throws.
 */
export function picturesIn(text, { most = 10 } = {}) {
  const pictures = [];
  let skipped = 0;
  const take = (base64) => {
    let data = null;
    try { data = decode(base64); } catch (err) { /* counted below */ }
    const type = data ? typeOf(data) : '';
    if (!type || data.length > MAX_PICTURE || pictures.length >= most) { skipped++; return; }
    pictures.push({ data, type, ext: type === 'image/png' ? 'png' : 'jpg' });
  };

  // JSON may write a slash as \/ and a line break as \n. Both are put back before looking.
  const plain = String(text || '').replace(/\\\//g, '/').replace(/\\[rnt]/g, ' ');
  // Quotes, commas and brackets never occur inside base64, so they always part one picture from the next.
  for (const piece of plain.split(/[^A-Za-z0-9+/=\s]+/)) {
    const run = piece.trim();
    if (run.length < 16 || !STARTS.test(run)) continue;
    // White space may be a line break inside one picture, or all that parts two of them. A picture
    // that does not yet run to its end is carried on into the next stretch.
    let pending = '';
    for (const stretch of run.split(NEXT)) {
      pending += stretch.replace(/\s+/g, '');
      if (/=$/.test(pending) || whole(decode(pending))) { take(pending); pending = ''; }
    }
    if (pending) take(pending);   // cut short, perhaps, but worth a look
  }
  return { pictures, skipped };
}

/** The file as data, if it is JSON once any stray line breaks are out of the way. Otherwise null. */
export function dataIn(text) {
  for (const attempt of [text, String(text || '').replace(/[\r\n]+/g, '')]) {
    try {
      const data = JSON.parse(attempt);
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    } catch (err) { /* try the next form */ }
  }
  return null;
}

