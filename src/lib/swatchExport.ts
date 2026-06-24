/**
 * 色板文件导出（纯函数构造字节，vitest 覆盖）：
 * - .ase（Adobe Swatch Exchange）：Photoshop / Illustrator / InDesign / 新版 CorelDRAW 都能直接导入
 * - .aco（Photoshop 色板）：PS「色板面板 → 载入色板」直接用
 * 落盘走既有 api:storage:save-as（dataUri base64 → Buffer 写盘），零新 IPC。
 */
import { hexToRgb } from './paletteColor';

export interface SwatchEntry {
  hex: string;
  /** 色板里显示的名字（建议含 HEX 便于对照） */
  name: string;
}

class ByteWriter {
  private bytes: number[] = [];

  u16(v: number): void {
    this.bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  u32(v: number): void {
    this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }
  f32(v: number): void {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, v, false); // big-endian
    const u8 = new Uint8Array(buf);
    this.bytes.push(u8[0], u8[1], u8[2], u8[3]);
  }
  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.bytes.push(s.charCodeAt(i) & 0xff);
  }
  /** UTF-16BE 字符串 + 终止 0x0000 */
  utf16z(s: string): void {
    for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i));
    this.u16(0);
  }
  concat(other: ByteWriter): void {
    this.bytes.push(...other.bytes);
  }
  get length(): number {
    return this.bytes.length;
  }
  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** 构造 .ase（Adobe Swatch Exchange）字节。非法 HEX 条目自动跳过。 */
export function buildAse(entries: SwatchEntry[]): Uint8Array {
  const valid = entries.filter((e) => hexToRgb(e.hex));
  const w = new ByteWriter();
  w.ascii('ASEF');
  w.u16(1); // 版本 1.0
  w.u16(0);
  w.u32(valid.length); // block 数
  for (const e of valid) {
    const rgb = hexToRgb(e.hex)!;
    const name = e.name || e.hex.toUpperCase();
    const body = new ByteWriter();
    body.u16(name.length + 1); // 名字长度（字符数，含终止符）
    body.utf16z(name);
    body.ascii('RGB '); // 色彩模型（4 字节，注意尾随空格）
    body.f32(rgb.r / 255);
    body.f32(rgb.g / 255);
    body.f32(rgb.b / 255);
    body.u16(2); // 颜色类型：2 = normal
    w.u16(0x0001); // block 类型：颜色条目
    w.u32(body.length);
    w.concat(body);
  }
  return w.toUint8Array();
}

/** 构造 .aco（Photoshop 色板）字节：v1 段（兼容）+ v2 段（带名字）。 */
export function buildAco(entries: SwatchEntry[]): Uint8Array {
  const valid = entries.filter((e) => hexToRgb(e.hex));
  const w = new ByteWriter();
  // ── v1 段 ──
  w.u16(1);
  w.u16(valid.length);
  for (const e of valid) {
    const rgb = hexToRgb(e.hex)!;
    w.u16(0); // 色彩空间 0 = RGB
    w.u16(rgb.r * 257); // 0-255 → 0-65535
    w.u16(rgb.g * 257);
    w.u16(rgb.b * 257);
    w.u16(0);
  }
  // ── v2 段（带 UTF-16 名字）──
  w.u16(2);
  w.u16(valid.length);
  for (const e of valid) {
    const rgb = hexToRgb(e.hex)!;
    const name = e.name || e.hex.toUpperCase();
    w.u16(0);
    w.u16(rgb.r * 257);
    w.u16(rgb.g * 257);
    w.u16(rgb.b * 257);
    w.u16(0);
    w.u32(name.length + 1); // 名字字符数（含终止符）
    w.utf16z(name);
  }
  return w.toUint8Array();
}

/** 字节 → base64 dataUri（喂 api:storage:save-as）。色板文件都很小（<10KB），直接转。 */
export function bytesToDataUri(bytes: Uint8Array, mime = 'application/octet-stream'): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:${mime};base64,${btoa(bin)}`;
}
