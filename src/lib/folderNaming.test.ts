import { describe, it, expect } from 'vitest';
import { buildOutputName, srcBaseName } from './folderNaming';

describe('srcBaseName', () => {
  it('从路径取文件名', () => {
    expect(srcBaseName('C:\\out\\a\\img-01.png')).toBe('img-01.png');
    expect(srcBaseName('/data/x/photo.jpg')).toBe('photo.jpg');
  });
  it('dataUri 回退按 mime 取扩展名', () => {
    expect(srcBaseName('data:image/png;base64,AAA')).toBe('image.png');
    expect(srcBaseName('data:image/jpeg;base64,AAA')).toBe('image.jpg');
  });
  it('无扩展名补 .png', () => {
    expect(srcBaseName('C:\\out\\noext')).toBe('noext.png');
  });
});

describe('buildOutputName', () => {
  it('original：沿用原名，批内重名自动 -2/-3', () => {
    const taken = new Set<string>();
    expect(buildOutputName('original', '', 0, 'a.png', taken)).toBe('a.png');
    expect(buildOutputName('original', '', 0, 'a.png', taken)).toBe('a-2.png');
    expect(buildOutputName('original', '', 0, 'a.png', taken)).toBe('a-3.png');
  });
  it('prefix-seq：前缀 + 四位序号 + 源扩展名', () => {
    const taken = new Set<string>();
    expect(buildOutputName('prefix-seq', 'out', 7, 'src.jpg', taken)).toBe('out-0007.jpg');
    expect(buildOutputName('prefix-seq', 'out', 8, 'src.png', taken)).toBe('out-0008.png');
  });
  it('非法字符消毒', () => {
    const taken = new Set<string>();
    expect(buildOutputName('original', '', 0, 'a:b?.png', taken)).toBe('a_b_.png');
  });
});
