/**
 * 图片元数据清理核心 —— 纯函数、零第三方依赖。
 * 支持 JPEG（移除 EXIF/XMP/IPTC/注释段）与 PNG（移除 eXIf/tEXt/iTXt/zTXt/tIME 块）。
 */

export type ImageFormat = 'jpeg' | 'png' | 'unknown';

export interface CleanResult {
  data: Buffer;
  /** 移除的元数据段/块数量 */
  removed: number;
  format: ImageFormat;
}

export function detectImageFormat(buf: Buffer): ImageFormat {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'png';
  }
  return 'unknown';
}

/**
 * JPEG 中要移除的段标记：
 * 0xE1 APP1（EXIF / XMP）、0xED APP13（IPTC / Photoshop）、0xEC APP12、0xFE COM（注释）。
 * APP0(JFIF) 与 APP2(ICC 色彩配置) 保留，避免影响图片显示与颜色。
 */
const JPEG_REMOVE_MARKERS = new Set([0xe1, 0xed, 0xec, 0xfe]);

export function stripJpegMetadata(buf: Buffer): CleanResult {
  if (detectImageFormat(buf) !== 'jpeg') {
    throw new Error('不是 JPEG 文件');
  }

  const parts: Buffer[] = [buf.subarray(0, 2)]; // SOI
  let removed = 0;
  let i = 2;

  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) {
      // 结构异常，余下数据原样保留
      parts.push(buf.subarray(i));
      break;
    }

    const marker = buf[i + 1];

    // SOS：之后是熵编码图像数据，直到底部 EOI，整体保留
    if (marker === 0xda) {
      parts.push(buf.subarray(i));
      break;
    }

    // EOI
    if (marker === 0xd9) {
      parts.push(buf.subarray(i, i + 2));
      break;
    }

    // 无长度字段的独立标记
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }

    if (i + 4 > buf.length) {
      parts.push(buf.subarray(i));
      break;
    }

    const length = buf.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > buf.length) {
      parts.push(buf.subarray(i));
      break;
    }

    const segment = buf.subarray(i, i + 2 + length);
    if (JPEG_REMOVE_MARKERS.has(marker)) {
      removed++;
    } else {
      parts.push(segment);
    }
    i += 2 + length;
  }

  return { data: Buffer.concat(parts), removed, format: 'jpeg' };
}

/** PNG 中要移除的元数据块类型 */
const PNG_REMOVE_CHUNKS = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

export function stripPngMetadata(buf: Buffer): CleanResult {
  if (detectImageFormat(buf) !== 'png') {
    throw new Error('不是 PNG 文件');
  }

  const parts: Buffer[] = [buf.subarray(0, 8)]; // PNG 签名
  let removed = 0;
  let i = 8;

  while (i + 12 <= buf.length) {
    const length = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const end = i + 12 + length;
    if (end > buf.length) break;

    const chunk = buf.subarray(i, end);
    if (PNG_REMOVE_CHUNKS.has(type)) {
      removed++;
    } else {
      parts.push(chunk);
    }

    i = end;
    if (type === 'IEND') break;
  }

  // 尾部残留数据原样保留
  if (i < buf.length) parts.push(buf.subarray(i));

  return { data: Buffer.concat(parts), removed, format: 'png' };
}

/** 根据文件内容自动识别格式并清理元数据 */
export function cleanImage(buf: Buffer): CleanResult {
  const format = detectImageFormat(buf);
  if (format === 'jpeg') return stripJpegMetadata(buf);
  if (format === 'png') return stripPngMetadata(buf);
  return { data: buf, removed: 0, format };
}

/** 列出 JPEG 的段标记（用于测试和调试） */
export function listJpegMarkers(buf: Buffer): number[] {
  const markers: number[] = [];
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    markers.push(marker);
    if (marker === 0xda || marker === 0xd9) break;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) break;
    const length = buf.readUInt16BE(i + 2);
    if (length < 2) break;
    i += 2 + length;
  }
  return markers;
}

/** 列出 PNG 的块类型（用于测试和调试） */
export function listPngChunks(buf: Buffer): string[] {
  const types: string[] = [];
  let i = 8;
  while (i + 12 <= buf.length) {
    const length = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    types.push(type);
    i += 12 + length;
    if (type === 'IEND') break;
  }
  return types;
}
