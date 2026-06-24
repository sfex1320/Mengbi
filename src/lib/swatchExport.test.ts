import { describe, it, expect } from 'vitest';
import { buildAse, buildAco, bytesToDataUri } from './swatchExport';

function u16(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1];
}
function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}
function f32(bytes: Uint8Array, at: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + at, 4).getFloat32(0, false);
}

describe('buildAse（Adobe Swatch Exchange）', () => {
  it('签名 ASEF + 版本 1.0 + block 数', () => {
    const b = buildAse([{ hex: '#FF0000', name: 'red' }, { hex: '#00FF00', name: 'green' }]);
    expect(String.fromCharCode(b[0], b[1], b[2], b[3])).toBe('ASEF');
    expect(u16(b, 4)).toBe(1);
    expect(u16(b, 6)).toBe(0);
    expect(u32(b, 8)).toBe(2);
  });
  it('颜色块：类型 0x0001 + UTF-16 名字 + RGB 浮点', () => {
    const b = buildAse([{ hex: '#FF0000', name: 'R' }]);
    let at = 12;
    expect(u16(b, at)).toBe(0x0001); // block 类型
    const blockLen = u32(b, at + 2);
    at += 6;
    expect(u16(b, at)).toBe(2); // 名字长度（'R' + 终止符）
    expect(u16(b, at + 2)).toBe('R'.charCodeAt(0));
    expect(u16(b, at + 4)).toBe(0); // 终止符
    const modelAt = at + 6;
    expect(String.fromCharCode(b[modelAt], b[modelAt + 1], b[modelAt + 2], b[modelAt + 3])).toBe('RGB ');
    expect(f32(b, modelAt + 4)).toBeCloseTo(1, 5); // r
    expect(f32(b, modelAt + 8)).toBeCloseTo(0, 5); // g
    expect(f32(b, modelAt + 12)).toBeCloseTo(0, 5); // b
    expect(u16(b, modelAt + 16)).toBe(2); // normal
    expect(blockLen).toBe(2 + 4 + 4 + 12 + 2); // 名长字段(2)+名字含终止符(4)+模型(4)+3float(12)+类型(2)
  });
  it('非法 HEX 条目被跳过（"bad" 是合法 3 位 HEX，用真非法串）', () => {
    const b = buildAse([{ hex: 'zzz', name: 'x' }]);
    expect(u32(b, 8)).toBe(0);
  });
});

describe('buildAco（Photoshop 色板）', () => {
  it('v1 段：版本 1 + 数量 + RGB 0-65535', () => {
    const b = buildAco([{ hex: '#FF0000', name: 'red' }]);
    expect(u16(b, 0)).toBe(1);
    expect(u16(b, 2)).toBe(1);
    expect(u16(b, 4)).toBe(0); // 色彩空间 RGB
    expect(u16(b, 6)).toBe(65535); // r = 255*257
    expect(u16(b, 8)).toBe(0);
    expect(u16(b, 10)).toBe(0);
  });
  it('v2 段跟在 v1 段后，带 UTF-16 名字', () => {
    const b = buildAco([{ hex: '#0000FF', name: 'B' }]);
    const v2 = 4 + 10; // v1 头 4 字节 + 1 色 10 字节
    expect(u16(b, v2)).toBe(2);
    expect(u16(b, v2 + 2)).toBe(1);
    expect(u16(b, v2 + 4)).toBe(0);
    expect(u16(b, v2 + 10)).toBe(65535); // b 通道
    expect(u32(b, v2 + 14)).toBe(2); // 名字字符数（'B' + 终止符）
    expect(u16(b, v2 + 18)).toBe('B'.charCodeAt(0));
    expect(u16(b, v2 + 20)).toBe(0);
  });
});

describe('bytesToDataUri', () => {
  it('base64 dataUri 可逆', () => {
    const uri = bytesToDataUri(Uint8Array.from([0, 1, 2, 255]), 'application/octet-stream');
    expect(uri.startsWith('data:application/octet-stream;base64,')).toBe(true);
    const decoded = atob(uri.split(',')[1]);
    expect([...decoded].map((c) => c.charCodeAt(0))).toEqual([0, 1, 2, 255]);
  });
});
