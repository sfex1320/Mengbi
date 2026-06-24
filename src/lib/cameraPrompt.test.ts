import { describe, it, expect } from 'vitest';
import { buildCameraPrompt } from './cameraPrompt';

const base = {
  camMode: 'photo' as const,
  horizontalAngle: 0,
  verticalAngle: 0,
  distance: 4,
  cameraType: 'none' as const,
  aperture: 'none' as const,
  movement: 'none' as const,
  focal: 'none' as const,
  composition: 'none' as const,
  appendConsistencyInstruction: false
};

describe('buildCameraPrompt', () => {
  it('拍照模式：全默认 + 无角度 → 保持原始拍摄方式', () => {
    expect(buildCameraPrompt(base)).toBe('保持原始拍摄方式');
  });

  it('视频模式：全默认 → 固定镜头', () => {
    expect(buildCameraPrompt({ ...base, camMode: 'video' })).toBe('固定镜头，无特殊运镜');
  });

  it('拍照：相机 + 光圈 + 构图 + 角度 全部体现', () => {
    const p = buildCameraPrompt({
      ...base,
      cameraType: 'dslr',
      aperture: 'f1.4',
      composition: 'thirds',
      horizontalAngle: 20,
      verticalAngle: 15
    });
    expect(p).toContain('单反');
    expect(p).toContain('f/1.4');
    expect(p).toContain('三分法');
    expect(p).toContain('向右旋转20度');
    expect(p).toContain('俯视15度');
  });

  it('拍照：不发视频专属字段（运镜/焦距）', () => {
    const p = buildCameraPrompt({ ...base, cameraType: 'dslr', movement: 'push', focal: 'tele' });
    expect(p).not.toContain('推近');
    expect(p).not.toContain('长焦');
  });

  it('视频：运镜 + 焦距 + 构图 体现，不发拍照专属（相机/光圈）', () => {
    const p = buildCameraPrompt({
      ...base,
      camMode: 'video',
      movement: 'push',
      focal: 'tele',
      composition: 'centered',
      cameraType: 'dslr',
      aperture: 'f1.4'
    });
    expect(p).toContain('推近');
    expect(p).toContain('长焦');
    expect(p).toContain('中心');
    expect(p).not.toContain('单反');
    expect(p).not.toContain('f/1.4');
  });

  it('角度：左转 / 仰视 / 特写 措辞正确', () => {
    const p = buildCameraPrompt({ ...base, horizontalAngle: -30, verticalAngle: -10, distance: 2 });
    expect(p).toContain('向左旋转30度');
    expect(p).toContain('仰视10度');
    expect(p).toContain('特写');
  });

  it('一致性约束：拍照 / 视频 各自追加对应句', () => {
    expect(buildCameraPrompt({ ...base, appendConsistencyInstruction: true })).toContain('只改变拍摄方式');
    expect(buildCameraPrompt({ ...base, camMode: 'video', appendConsistencyInstruction: true })).toContain('只改变运镜与镜头语言');
  });

  it('缺省 camMode 视为拍照', () => {
    const { camMode: _omit, ...noMode } = base;
    void _omit;
    expect(buildCameraPrompt(noMode)).toBe('保持原始拍摄方式');
  });
});
