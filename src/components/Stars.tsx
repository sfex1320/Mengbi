import { useMemo } from 'react';
import './Stars.css';

/**
 * 背景星空粒子层（纯 CSS 动画 + 随机分布点）。
 * - 80 颗静态闪烁星
 * - 20 颗大颗粒"漂浮"（半透明、缓慢漂移、有 glow）
 * - 5 条流星轨迹（极慢交替触发）
 * - 3 个底部 orb（保留原效果）
 * 不使用 canvas，避免占用渲染主线程。
 */

interface Star {
  top: string;
  left: string;
  size: number;
  delay: number;
  duration: number;
  opacity: number;
}

interface Particle {
  top: string;
  left: string;
  size: number;
  delay: number;
  duration: number;
  hue: number;
  driftX: string;
  driftY: string;
}

interface Shooting {
  top: string;
  left: string;
  delay: number;
  duration: number;
  angle: number;
}

function makeStars(count: number): Star[] {
  const arr: Star[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      top: `${Math.random() * 100}%`,
      left: `${Math.random() * 100}%`,
      size: Math.random() < 0.85 ? 1 : Math.random() < 0.6 ? 2 : 3,
      delay: Math.random() * 8,
      duration: 4 + Math.random() * 8,
      opacity: 0.3 + Math.random() * 0.55
    });
  }
  return arr;
}

function makeParticles(count: number): Particle[] {
  const arr: Particle[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      top: `${Math.random() * 100}%`,
      left: `${Math.random() * 100}%`,
      size: 4 + Math.random() * 6,
      delay: Math.random() * 12,
      duration: 18 + Math.random() * 22,
      hue: Math.random() < 0.5 ? 28 : Math.random() < 0.5 ? 270 : 210,
      driftX: `${(Math.random() - 0.5) * 30}vw`,
      driftY: `${(Math.random() - 0.5) * 30}vh`
    });
  }
  return arr;
}

function makeShootings(count: number): Shooting[] {
  const arr: Shooting[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      top: `${Math.random() * 50}%`,
      left: `${Math.random() * 80}%`,
      delay: 4 + Math.random() * 18 + i * 6,
      duration: 1.2 + Math.random() * 0.8,
      angle: 200 + Math.random() * 30
    });
  }
  return arr;
}

export function Stars(): JSX.Element {
  const stars = useMemo(() => makeStars(80), []);
  const particles = useMemo(() => makeParticles(20), []);
  const shootings = useMemo(() => makeShootings(5), []);

  return (
    <div className="mb-stars" aria-hidden="true">
      {stars.map((s, i) => (
        <span
          key={`s-${i}`}
          className="mb-star"
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

      {particles.map((p, i) => (
        <span
          key={`p-${i}`}
          className="mb-particle"
          style={
            {
              top: p.top,
              left: p.left,
              width: p.size,
              height: p.size,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              ['--mb-particle-hue' as string]: String(p.hue),
              ['--mb-particle-dx' as string]: p.driftX,
              ['--mb-particle-dy' as string]: p.driftY
            } as React.CSSProperties
          }
        />
      ))}

      {shootings.map((s, i) => (
        <span
          key={`m-${i}`}
          className="mb-shooting"
          style={
            {
              top: s.top,
              left: s.left,
              animationDelay: `${s.delay}s`,
              animationDuration: `${s.duration}s`,
              ['--mb-shoot-angle' as string]: `${s.angle}deg`
            } as React.CSSProperties
          }
        />
      ))}

      <div className="mb-orbs">
        <div className="mb-orb mb-orb-1" />
        <div className="mb-orb mb-orb-2" />
        <div className="mb-orb mb-orb-3" />
      </div>
    </div>
  );
}
