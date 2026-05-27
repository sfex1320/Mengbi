/**
 * QualityScoreBadge —— 0-100 评分圆环 + 档位颜色。
 *
 * 用在批量任务行 / 结果预览大徽章。score < 20 红;< 40 橙;< 60 黄;< 80 绿;>= 80 翠绿。
 * score 为 null 时显示「—」。
 */

interface Props {
  score: number | null;
  size?: 'xs' | 'sm' | 'md';
}

function tierFor(score: number): { label: string; tier: string } {
  if (score >= 80) return { label: 'A', tier: 'excellent' };
  if (score >= 60) return { label: 'B', tier: 'good' };
  if (score >= 40) return { label: 'C', tier: 'fair' };
  if (score >= 20) return { label: 'D', tier: 'poor' };
  return { label: 'F', tier: 'invalid' };
}

export function QualityScoreBadge({ score, size = 'sm' }: Props): JSX.Element {
  if (score === null) {
    return <span className={`mb-vec-quality-badge is-empty is-${size}`}>—</span>;
  }
  const t = tierFor(score);
  return (
    <span
      className={`mb-vec-quality-badge is-${t.tier} is-${size}`}
      title={`SVG 质量评分: ${score}/100 (${t.tier})`}
    >
      <span className="mb-vec-quality-score">{score}</span>
      <span className="mb-vec-quality-tier">{t.label}</span>
    </span>
  );
}
