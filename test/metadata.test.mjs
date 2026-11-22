import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectImageFormat,
  stripJpegMetadata,
  stripPngMetadata,
  cleanImage,
  listJpegMarkers,
  listPngChunks,
} from '../dist/core/metadata.mjs';

/* ---------- 测试用文件构造 ---------- */

function jpegSegment(marker, payload) {
  const len = payload.length + 2;
  return Buffer.concat([
    Buffer.from([0xff, marker, (len >> 8) & 0xff, len & 0xff]),
    payload,
  ]);
}

function makeJpeg(withMetadata) {
  const parts = [Buffer.from([0xff, 0xd8])]; // SOI
  parts.push(jpegSegment(0xe0, Buffer.from('JFIF\0fake-app0', 'binary'))); // APP0 保留
  if (withMetadata) {
    parts.push(jpegSegment(0xe1, Buffer.from('Exif\0\0fake-exif-data', 'binary'))); // APP1 应删除
    parts.push(jpegSegment(0xfe, Buffer.from('photo comment', 'binary'))); // COM 应删除
  }
  parts.push(Buffer.from([0xff, 0xd9])); // EOI
  return Buffer.concat(parts);
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  return Buffer.concat([
    len,
    Buffer.from(type, 'ascii'),
    data,
    Buffer.alloc(4), // 测试用假 CRC
  ]);
}

function makePng(withMetadata) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig];
  parts.push(pngChunk('IHDR', Buffer.alloc(13)));
  if (withMetadata) {
    parts.push(pngChunk('tEXt', Buffer.from('Author\0someone', 'latin1')));
    parts.push(pngChunk('eXIf', Buffer.from('fake-exif', 'latin1')));
  }
  parts.push(pngChunk('IDAT', Buffer.from([1, 2, 3, 4, 5])));
  parts.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/* ---------- 格式识别 ---------- */

test('detectImageFormat：识别 JPEG / PNG / 未知格式', () => {
  assert.equal(detectImageFormat(makeJpeg(false)), 'jpeg');
  assert.equal(detectImageFormat(makePng(false)), 'png');
  assert.equal(detectImageFormat(Buffer.from('hello world')), 'unknown');
  assert.equal(detectImageFormat(Buffer.alloc(0)), 'unknown');
});

/* ---------- JPEG ---------- */

test('JPEG：移除 APP1 与 COM，保留 APP0', () => {
  const input = makeJpeg(true);
  const result = stripJpegMetadata(input);

  assert.equal(result.format, 'jpeg');
  assert.equal(result.removed, 2);

  const markers = listJpegMarkers(result.data);
  assert.ok(!markers.includes(0xe1), 'APP1 应被移除');
  assert.ok(!markers.includes(0xfe), 'COM 应被移除');
  assert.ok(markers.includes(0xe0), 'APP0 应保留');
  assert.equal(markers[markers.length - 1], 0xd9, '应以 EOI 结尾');

  assert.equal(result.data[0], 0xff);
  assert.equal(result.data[1], 0xd8);
  assert.ok(!result.data.includes('Exif'), '输出中不应再出现 EXIF 字样');
});

test('JPEG：无元数据时输出与输入完全一致', () => {
  const input = makeJpeg(false);
  const result = stripJpegMetadata(input);
  assert.equal(result.removed, 0);
  assert.deepEqual(result.data, input);
});

test('JPEG：非 JPEG 输入抛错', () => {
  assert.throws(() => stripJpegMetadata(Buffer.from('not a jpeg')));
});

/* ---------- PNG ---------- */

test('PNG：移除 tEXt 与 eXIf，保留 IHDR/IDAT/IEND', () => {
  const input = makePng(true);
  const result = stripPngMetadata(input);

  assert.equal(result.format, 'png');
  assert.equal(result.removed, 2);

  const chunks = listPngChunks(result.data);
  assert.deepEqual(chunks, ['IHDR', 'IDAT', 'IEND']);
  assert.equal(result.data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('PNG：无元数据时输出与输入完全一致', () => {
  const input = makePng(false);
  const result = stripPngMetadata(input);
  assert.equal(result.removed, 0);
  assert.deepEqual(result.data, input);
});

/* ---------- cleanImage 自动分派 ---------- */

test('cleanImage：按文件内容自动选择解析器', () => {
  const jpeg = cleanImage(makeJpeg(true));
  assert.equal(jpeg.format, 'jpeg');
  assert.equal(jpeg.removed, 2);

  const png = cleanImage(makePng(true));
  assert.equal(png.format, 'png');
  assert.equal(png.removed, 2);
});

test('cleanImage：未知格式原样返回', () => {
  const input = Buffer.from('plain text, not an image');
  const result = cleanImage(input);
  assert.equal(result.format, 'unknown');
  assert.equal(result.removed, 0);
  assert.deepEqual(result.data, input);
});

test('JPEG：输出仍可被再次识别（幂等性）', () => {
  const once = cleanImage(makeJpeg(true));
  assert.equal(detectImageFormat(once.data), 'jpeg');
  const twice = cleanImage(once.data);
  assert.equal(twice.removed, 0, '清理过的文件再次清理应无可移除内容');
  assert.deepEqual(twice.data, once.data);
});
