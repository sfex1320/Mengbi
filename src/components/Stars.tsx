import { useMemo } from 'react';
import { useThemeStore } from '@/store/themeStore';
import './Stars.css';

/**
 * 银河 / 微星 / 流星雨 背景层（纯 CSS 动画）。
 *
 * - 200 颗"微星"，~1-2px，慢速闪烁
 * - 一条斜向"银河带"，半透明渐变
 * - 一组定时流星雨（每 ~38s 一波，每波 ~14 条，同方向，错开 0~2s）
 * - 3 个大型 orb（暖橘 / 紫 / 蓝），与主题色融合
 *
 * 不用 canvas，避免占主线程；元素数量虽多，全部走 transform/opacity，浏览器走 GPU。
 */

interface MicroStar {
  top: string;
  left: string;
  size: number;
  delay: number;
  duration: number;
  opacity: number;
}

interface Meteor {
  /** 起点 — 屏幕的某个上 / 上半屏位置（px：vw / vh） */
  top: string;
  left: string;
  /** 整个动画 loop 时长（必须所有流星一致才能保持"一波"）*/
  cycle: number;
  /** 在 loop 内的起跳延迟（同一波的延迟集中在 0-2s 内） */
  delay: number;
  /** 单次划过的时长（多用 1.2-1.8s） */
  duration: number;
  /** 角度（同一波保持接近，制造"齐射"效果） */
  angle: number;
  /** 长度（轨迹长度） */
  trail: number;
  /** 色相 */
  hue: number;
}

function makeMicroStars(count: number): MicroStar[] {
  const arr: MicroStar[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      top: `${Math.random() * 100}%`,
      left: `${Math.random() * 100}%`,
      // 大多数 1px，少数 2px
      size: Math.random() < 0.82 ? 1 : Math.random() < 0.7 ? 1.5 : 2,
      delay: Math.random() * 6,
      duration: 3 + Math.random() * 5,
      opacity: 0.25 + Math.random() * 0.55
    });
  }
  return arr;
}

/**
 * 一波流星雨：N 条同方向流星，延迟集中在前 2.5 秒（齐射感）。
 *
 * 方向：右上 → 左下。
 *   CSS rotate() 是顺时针：0°=右、90°=下、180°=左、270°=上。
 *   要 "右上→左下"（向下偏左）就得 ~130°–145°（下与左之间）。
 *   起点撒在屏幕右上：top 0–40%、left 50–110%（少量出屏外，让流星"从屏外飞来"）。
 */
function makeMeteorShower(count: number, cycle: number, delayBase: number): Meteor[] {
  const baseAngle = 135 + Math.random() * 8; // 一波内角度统一
  const arr: Meteor[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      top: `${Math.random() * 40 - 5}%`,
      left: `${50 + Math.random() * 60}%`,
      cycle,
      delay: delayBase + Math.random() * 2.6,
      duration: 1.0 + Math.random() * 0.6,
      // 微小角度抖动，让队形像真流星雨而不是机械整齐
      angle: baseAngle + (Math.random() - 0.5) * 6,
      trail: 110 + Math.random() * 120,
      hue: Math.random() < 0.5 ? 50 : 200
    });
  }
  return arr;
}

/**
 * 暖白玉（浅色主题）专用背景：「光影变换」。
 *
 * 白色星点 / 流星 / screen 混合的 orb 在浅底上几乎不可见，所以浅色主题不复用星空，
 * 改成几团缓慢漂移的暖色软光晕（multiply = 柔和阴影池 + 一团暖高光），
 * 在象牙白底上读作"光与影的缓慢流转"。z-index 0，在所有内容之下，不影响可读性。
 */
function LightShadowField(): JSX.Element {
  return (
    <div className="mb-stars mb-lightshadow" aria-hidden="true">
      <div className="mb-ls-blob mb-ls-blob-1" />
      <div className="mb-ls-blob mb-ls-blob-2" />
      <div className="mb-ls-blob mb-ls-blob-3" />
      <div className="mb-ls-blob mb-ls-blob-4" />
    </div>
  );
}

export function Stars(): JSX.Element {
  const atmosphere = useThemeStore((s) => s.atmosphere);
  const microStars = useMemo(() => makeMicroStars(260), []);
  // 三波流星雨——错开周期 + 错开延迟基线，让屏幕几乎一直能看到流星
  // 周期短 = 来得勤；count 大 = 单波更密集
  const showerA = useMemo(() => makeMeteorShower(28, 32, 0), []);
  const showerB = useMemo(() => makeMeteorShower(24, 44, 12), []);
  const showerC = useMemo(() => makeMeteorShower(20, 56, 24), []);

  // 浅色主题不用星空/流星（白点在浅底不可见），改走"光影变换"软光晕场
  if (atmosphere === 'warm-jade') return <LightShadowField />;

  return (
    <div className="mb-stars" aria-hidden="true">
      {/* 银河带：旋转的渐变条，与微星叠加 */}
      <div className="mb-galaxy-band" />
      <div className="mb-galaxy-band mb-galaxy-band-2" />

      {/* 微星层 */}
      {microStars.map((s, i) => (
        <span
          key={`m-${i}`}
          className="mb-microstar"
          style={{
            top: s.top,
            left: s.left,
            width: s.size,
            height: s.size,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.duration}s`,
            opacity: s.opacity
          }}
        />
      ))}

      {/* 流星雨 A */}
      {showerA.map((m, i) => (
        <span
          key={`a-${i}`}
          className="mb-meteor"
          style={
            {
              top: m.top,
              left: m.left,
              animationDelay: `${m.delay}s`,
              animationDuration: `${m.cycle}s`,
              ['--mb-meteor-angle' as string]: `${m.angle}deg`,
              ['--mb-meteor-trail' as string]: `${m.trail}px`,
              ['--mb-meteor-hue' as string]: String(m.hue)
            } as React.CSSProperties
          }
        />
      ))}

      {/* 流星雨 B */}
      {showerB.map((m, i) => (
        <span
          key={`b-${i}`}
          className="mb-meteor"
          style={
            {
              top: m.top,
              left: m.left,
              animationDelay: `${m.delay}s`,
              animationDuration: `${m.cycle}s`,
              ['--mb-meteor-angle' as string]: `${m.angle}deg`,
              ['--mb-meteor-trail' as string]: `${m.trail}px`,
              ['--mb-meteor-hue' as string]: String(m.hue)
            } as React.CSSProperties
          }
        />
      ))}

      {/* 流星雨 C */}
      {showerC.map((m, i) => (
        <span
          key={`c-${i}`}
          className="mb-meteor"
          style={
            {
              top: m.top,
              left: m.left,
              animationDelay: `${m.delay}s`,
              animationDuration: `${m.cycle}s`,
              ['--mb-meteor-angle' as string]: `${m.angle}deg`,
              ['--mb-meteor-trail' as string]: `${m.trail}px`,
              ['--mb-meteor-hue' as string]: String(m.hue)
            } as React.CSSProperties
          }
        />
      ))}

      {/* 大型 orb 仍保留：与主题色融合的氛围光 */}
      <div className="mb-orbs">
        <div className="mb-orb mb-orb-1" />
        <div className="mb-orb mb-orb-2" />
        <div className="mb-orb mb-orb-3" />
      </div>
    </div>
  );
}
