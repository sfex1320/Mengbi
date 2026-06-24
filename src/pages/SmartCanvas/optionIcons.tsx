/**
 * 统一的镜头 / 光源选项线条图标集（替代原先风格不一的 emoji）。
 * 所有图标共用同一外层 <svg>（viewBox 0 0 24 24 · fill:none · stroke:currentColor · stroke-width:1.7 ·
 * round caps/joins），内部 markup 为极简描边图形 —— 整套风格统一（描边/线条，不填充）。
 *
 * markup 用 dangerouslySetInnerHTML 注入：在 SVG 元素上设 innerHTML，浏览器按 SVG 片段解析，
 * 故 rect/circle/path 等都会被创建为 SVG 元素。
 */

type IconMap = Record<string, string>;

const ICONS: Record<string, IconMap> = {
  cameraType: {
    dslr: '<rect x="3.5" y="8" width="17" height="10" rx="2" fill="none"/><path d="M8.5 8 L9.8 5.5 H14.2 L15.5 8" fill="none"/><circle cx="12" cy="13" r="3" fill="none"/>',
    mirrorless: '<rect x="3.5" y="9.5" width="17" height="7" rx="1.6" fill="none"/><circle cx="12" cy="13" r="2.6" fill="none"/><line x1="6" y1="9.5" x2="6" y2="7.8"/>',
    film35: '<rect x="4" y="7" width="16" height="10" rx="1" fill="none"/><line x1="4" y1="9.5" x2="20" y2="9.5"/><line x1="4" y1="14.5" x2="20" y2="14.5"/><path d="M6.5 12 H7 M9.5 12 H10 M12.5 12 H13 M15.5 12 H16" fill="none"/>',
    mediumformat: '<rect x="5" y="6" width="14" height="13" rx="1.6" fill="none"/><line x1="9" y1="6" x2="15" y2="6"/><circle cx="12" cy="13" r="3.6" fill="none"/>',
    polaroid: '<rect x="5" y="5" width="14" height="14" rx="1.4" fill="none"/><line x1="5" y1="15" x2="19" y2="15"/><circle cx="12" cy="10" r="2.6" fill="none"/>',
    phone: '<rect x="7.5" y="3.5" width="9" height="17" rx="2" fill="none"/><circle cx="12" cy="7" r="1.4" fill="none"/><line x1="10.5" y1="18" x2="13.5" y2="18"/>',
    cinema: '<circle cx="8.5" cy="6.5" r="2.5" fill="none"/><circle cx="14" cy="6.5" r="2.5" fill="none"/><rect x="5" y="11" width="12" height="8" rx="1.4" fill="none"/><path d="M17 13.5 L20.5 11.5 V18.5 L17 16.5" fill="none"/>',
    drone: '<rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="none"/><circle cx="5.5" cy="5.5" r="2.3" fill="none"/><circle cx="18.5" cy="5.5" r="2.3" fill="none"/><path d="M7.2 7.2 L9.8 9.8 M16.8 7.2 L14.2 9.8" fill="none"/>',
    action: '<rect x="6" y="6.5" width="12" height="11" rx="2" fill="none"/><circle cx="12" cy="12" r="3.2" fill="none"/><circle cx="12" cy="12" r="0.6" fill="currentColor"/>'
  },
  aperture: {
    'f1.4': '<circle cx="12" cy="12" r="8" fill="none"/><circle cx="12" cy="12" r="6" fill="none"/>',
    'f2.8': '<circle cx="12" cy="12" r="8" fill="none"/><circle cx="12" cy="12" r="4.6" fill="none"/>',
    f4: '<circle cx="12" cy="12" r="8" fill="none"/><circle cx="12" cy="12" r="3.4" fill="none"/>',
    f8: '<circle cx="12" cy="12" r="8" fill="none"/><circle cx="12" cy="12" r="2.1" fill="none"/>',
    f16: '<circle cx="12" cy="12" r="8" fill="none"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/>'
  },
  movement: {
    push: '<circle cx="11" cy="11" r="6"/><line x1="15.2" y1="15.2" x2="19" y2="19"/><line x1="11" y1="8.5" x2="11" y2="13.5"/><line x1="8.5" y1="11" x2="13.5" y2="11"/>',
    pull: '<circle cx="11" cy="11" r="6"/><line x1="15.2" y1="15.2" x2="19" y2="19"/><line x1="8.5" y1="11" x2="13.5" y2="11"/>',
    panleft: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="10,7 5,12 10,17"/>',
    panright: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="14,7 19,12 14,17"/>',
    tiltup: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="7,10 12,5 17,10"/>',
    tiltdown: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="7,14 12,19 17,14"/>',
    truck: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="9,8 5,12 9,16"/><polyline points="15,8 19,12 15,16"/>',
    orbit: '<path d="M18.5 9.2 A7 7 0 1 0 19 13"/><polyline points="15,8.5 18.8,8.8 18.5,12.6"/>',
    handheld: '<path d="M4 12 C6 8, 8 8, 10 12 S14 16, 16 12 S18 8, 20 12"/>',
    crane: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="8,9 12,5 16,9"/><polyline points="8,15 12,19 16,15"/>',
    dollyzoom: '<polyline points="9,5 5,5 5,9"/><polyline points="15,5 19,5 19,9"/><polyline points="9,19 5,19 5,15"/><polyline points="15,19 19,19 19,15"/>',
    tracking: '<line x1="4" y1="17" x2="20" y2="17"/><line x1="6" y1="11" x2="16" y2="11"/><polyline points="13,8 16,11 13,14"/>',
    static: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'
  },
  focal: {
    ultrawide: '<path d="M11 12 L4 6"/><path d="M11 12 L4 18"/><circle cx="11" cy="12" r="1" fill="currentColor"/><path d="M16 7 L20 7"/><path d="M16 17 L20 17"/>',
    wide: '<path d="M11 12 L6 8"/><path d="M11 12 L6 16"/><circle cx="11" cy="12" r="1" fill="currentColor"/><path d="M16 9 L19 9"/><path d="M16 15 L19 15"/>',
    standard: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="0.6" fill="currentColor"/>',
    tele: '<rect x="5" y="9" width="11" height="6" rx="1"/><path d="M16 10 L19 8.5 L19 15.5 L16 14 Z"/>',
    macro: '<circle cx="10" cy="10" r="5"/><path d="M13.8 13.8 L19 19"/><circle cx="10" cy="10" r="1" fill="currentColor"/>'
  },
  composition: {
    thirds: '<rect x="4" y="6" width="16" height="12" rx="1" fill="none"/><line x1="9.33" y1="6" x2="9.33" y2="18"/><line x1="14.67" y1="6" x2="14.67" y2="18"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="4" y1="14" x2="20" y2="14"/>',
    centered: '<rect x="4" y="6" width="16" height="12" rx="1" fill="none"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/>',
    symmetry: '<rect x="4" y="6" width="16" height="12" rx="1" fill="none"/><line x1="12" y1="6" x2="12" y2="18"/>',
    diagonal: '<rect x="4" y="6" width="16" height="12" rx="1" fill="none"/><line x1="4" y1="18" x2="20" y2="6"/>',
    leadinglines: '<line x1="4" y1="19" x2="15" y2="8"/><line x1="13" y1="19" x2="15" y2="8"/><circle cx="15" cy="8" r="1" fill="currentColor"/>',
    frameinframe: '<rect x="4" y="6" width="16" height="12" rx="1" fill="none"/><rect x="8" y="9" width="8" height="6" rx="1" fill="none"/>',
    golden: '<rect x="4" y="6" width="16" height="12" rx="1" fill="none"/><path d="M18 6 A12 12 0 0 1 6 18 A6 6 0 0 1 12 12 A3 3 0 0 1 15 15" fill="none"/>',
    fill: '<rect x="4" y="6" width="16" height="12" rx="1" fill="none"/><rect x="6" y="8" width="12" height="8" rx="1" fill="none"/>',
    negative: '<rect x="4" y="6" width="16" height="12" rx="1" fill="none"/><circle cx="15.5" cy="14" r="2.5" fill="none"/>'
  },
  lightSource: {
    sunlight: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="3" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21"/><line x1="3" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21" y2="12"/>',
    sunrise: '<line x1="3" y1="18" x2="21" y2="18"/><path d="M7 18a5 5 0 0 1 10 0"/><polyline points="9 8 12 5 15 8"/>',
    sunset: '<line x1="3" y1="18" x2="21" y2="18"/><path d="M7 18a5 5 0 0 1 10 0"/><polyline points="9 5 12 8 15 5"/>',
    goldenhour: '<line x1="4" y1="19" x2="20" y2="19"/><path d="M7 19a3.5 3.5 0 0 1 7 0"/><line x1="14" y1="15" x2="21" y2="7"/>',
    overcast: '<path d="M8 18h9a3.5 3.5 0 0 0 0-7 4.5 4.5 0 0 0-8.7-1.3A3.4 3.4 0 0 0 8 18z"/>',
    moonlight: '<path d="M19 14.5A8 8 0 0 1 9.5 5a6.5 6.5 0 1 0 9.5 9.5z"/>',
    candle: '<rect x="9" y="11" width="6" height="9" rx="1"/><path d="M12 8c1.5-1.5 1.5-3 0-4.5C10.5 5 10.5 6.5 12 8z"/>',
    lantern: '<line x1="12" y1="3" x2="12" y2="5"/><path d="M8 7h8l-1 11H9z"/><line x1="8" y1="7" x2="16" y2="7"/>',
    firelight: '<path d="M12 21c3.5 0 5.5-2.3 5.5-5.5 0-3-2-4.5-3-7-2 1.5-1 4-3 4-1 0-1.5-1-1.3-2.5C7.5 11 6.5 13 6.5 15.5 6.5 18.7 8.5 21 12 21z"/>',
    neon: '<path d="M9 14a5 5 0 1 1 6 0c-.8.6-1 1.2-1 2h-4c0-.8-.2-1.4-1-2z"/><line x1="10" y1="20" x2="14" y2="20"/>',
    studio: '<rect x="5" y="6" width="7" height="12" rx="1"/><polyline points="12 8 20 5 20 19 12 16"/>',
    daylight: '<rect x="5" y="4" width="14" height="16" rx="1"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="5" y1="12" x2="19" y2="12"/>',
    street: '<path d="M9 6a3 3 0 0 1 6 0z"/><line x1="12" y1="6" x2="12" y2="20"/><line x1="8" y1="20" x2="16" y2="20"/>',
    screen: '<rect x="4" y="5" width="16" height="11" rx="1"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/>'
  },
  occlusion: {
    leaves: '<path d="M6.5 9.5c2.5-1.5 4.5 0.5 3 3-2.5 1.5-4.5-0.5-3-3z" fill="none"/><path d="M14 14c2.5-1.5 4.5 0.5 3 3-2.5 1.5-4.5-0.5-3-3z" fill="none"/><circle cx="17" cy="7.5" r="1.4" fill="none"/>',
    window: '<rect x="5" y="5" width="14" height="14" rx="1" fill="none"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    blinds: '<line x1="5" y1="7" x2="19" y2="7"/><line x1="5" y1="10.5" x2="19" y2="10.5"/><line x1="5" y1="14" x2="19" y2="14"/><line x1="5" y1="17.5" x2="19" y2="17.5"/>',
    branches: '<path d="M6 19c3-1 5-4 6.5-7.5S16 5 18 5" fill="none"/><path d="M12.5 11.5c0.5-2 2-3 4-3" fill="none"/><path d="M9.5 15c-0.5-1.5-2-2.5-3.5-2.5" fill="none"/>',
    curtain: '<path d="M8 5c1.5 2-1.5 4 0 6s-1.5 4 0 6s-1.5 2 0 2" fill="none"/><path d="M12 5c1.5 2-1.5 4 0 6s-1.5 4 0 6s-1.5 2 0 2" fill="none"/><path d="M16 5c1.5 2-1.5 4 0 6s-1.5 4 0 6s-1.5 2 0 2" fill="none"/>',
    caustics: '<path d="M5 8c2-2 4-2 7 0s5 2 7 0" fill="none"/><path d="M5 13c2-2 4-2 7 0s5 2 7 0" fill="none"/><path d="M5 18c2-2 4-2 7 0s5 2 7 0" fill="none"/>',
    lace: '<circle cx="8" cy="8" r="1.2" fill="none"/><circle cx="16" cy="8" r="1.2" fill="none"/><circle cx="12" cy="12" r="1.2" fill="none"/><circle cx="8" cy="16" r="1.2" fill="none"/><circle cx="16" cy="16" r="1.2" fill="none"/>',
    foliage: '<path d="M5 16l2-3 2 3 2-4 2 4 2-3 2 3" fill="none"/><path d="M7 16l1.5-2.5L10 16l2-3 2 3 1.5-2.5L17 16" fill="none"/><line x1="5" y1="16" x2="19" y2="16"/>',
    grid: '<rect x="5" y="5" width="14" height="14" rx="1" fill="none"/><line x1="9.7" y1="5" x2="9.7" y2="19"/><line x1="14.3" y1="5" x2="14.3" y2="19"/><line x1="5" y1="9.7" x2="19" y2="9.7"/><line x1="5" y1="14.3" x2="19" y2="14.3"/>',
    smoke: '<line x1="8" y1="5" x2="5" y2="19"/><line x1="13" y1="5" x2="10" y2="19"/><line x1="18" y1="5" x2="15" y2="19"/>'
  },
  effect: {
    tyndall: '<rect x="4" y="4" width="16" height="16" rx="2"/><line x1="8" y1="5" x2="5" y2="11"/><line x1="12" y1="5" x2="7" y2="15"/><line x1="16" y1="5" x2="10" y2="18"/>',
    fog: '<line x1="5" y1="8" x2="19" y2="8"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="6" y1="16" x2="18" y2="16"/>',
    godrays: '<circle cx="12" cy="4" r="2"/><line x1="12" y1="6" x2="7" y2="20"/><line x1="12" y1="6" x2="12" y2="20"/><line x1="12" y1="6" x2="17" y2="20"/>',
    backlight: '<path d="M9 20 V12 a3 3 0 0 1 6 0 V20"/><path d="M6 9 a8 8 0 0 1 12 0"/>',
    flare: '<line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    bokeh: '<circle cx="9" cy="10" r="4"/><circle cx="15" cy="13" r="5"/><circle cx="15" cy="7" r="2.5"/>',
    bloom: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    hardshadow: '<circle cx="12" cy="12" r="7"/><line x1="12" y1="5" x2="12" y2="19"/>',
    dappled: '<path d="M7 8 a2.5 2 0 1 0 0.1 0 z"/><path d="M15 7 a2 2.5 0 1 0 0.1 0 z"/><path d="M10 15 a3 2.5 0 1 0 0.1 0 z"/><path d="M17 15 a1.8 1.8 0 1 0 0.1 0 z"/>',
    silhouette: '<circle cx="12" cy="8" r="3"/><path d="M6 20 a6 6 0 0 1 12 0 z"/>'
  },
  lightPosition: {
    front: '<circle cx="12" cy="13" r="4" fill="none"/><line x1="12" y1="3" x2="12" y2="7"/><line x1="9" y1="5" x2="10.5" y2="7.5"/><line x1="15" y1="5" x2="13.5" y2="7.5"/>',
    left: '<circle cx="14" cy="12" r="4" fill="none"/><line x1="3" y1="12" x2="7" y2="12"/><line x1="4.5" y1="9" x2="7.5" y2="10.5"/><line x1="4.5" y1="15" x2="7.5" y2="13.5"/>',
    right: '<circle cx="10" cy="12" r="4" fill="none"/><line x1="21" y1="12" x2="17" y2="12"/><line x1="19.5" y1="9" x2="16.5" y2="10.5"/><line x1="19.5" y1="15" x2="16.5" y2="13.5"/>',
    rembrandt: '<circle cx="13" cy="13" r="4" fill="none"/><line x1="4" y1="4" x2="8" y2="8"/><line x1="4" y1="8" x2="7.5" y2="8"/><line x1="8" y1="4" x2="8" y2="7.5"/>',
    top: '<circle cx="12" cy="14" r="4" fill="none"/><line x1="12" y1="3" x2="12" y2="8"/><line x1="8.5" y1="4" x2="10.5" y2="8"/><line x1="15.5" y1="4" x2="13.5" y2="8"/>',
    butterfly: '<circle cx="12" cy="14" r="4" fill="none"/><line x1="12" y1="3" x2="12" y2="7"/><path d="M9.5 17 Q12 15 14.5 17" fill="none"/>',
    back: '<circle cx="12" cy="13" r="4" fill="none"/><path d="M7 7 A7 7 0 0 1 17 7" fill="none"/><line x1="12" y1="2.5" x2="12" y2="5"/>',
    rim: '<circle cx="11" cy="13" r="4" fill="none"/><path d="M14 9.5 A4 4 0 0 1 14 16.5" fill="none"/><line x1="19" y1="6" x2="16" y2="9"/><line x1="20" y1="10" x2="17" y2="11.5"/>',
    bottom: '<circle cx="12" cy="10" r="4" fill="none"/><line x1="12" y1="21" x2="12" y2="16"/><line x1="8.5" y1="20" x2="10.5" y2="16"/><line x1="15.5" y1="20" x2="13.5" y2="16"/>'
  }
};

/** 没有专属图标 / value='none' 时的统一占位（小空心圆）。 */
const NONE_MARKUP = '<circle cx="12" cy="12" r="3.4" fill="none"/>';

export type OptionIconCategory = keyof typeof ICONS;

/** 渲染一个统一风格的选项线条图标。 */
export function OptionIcon({
  category,
  value,
  size = 18
}: {
  category: OptionIconCategory;
  value: string;
  size?: number;
}): JSX.Element {
  const markup = !value || value === 'none' ? NONE_MARKUP : ICONS[category]?.[value] ?? NONE_MARKUP;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

/** 便捷：在 IconChoiceGrid 的 options 里直接当 icon 用。 */
export function optionIcon(category: OptionIconCategory, value: string, size = 18): JSX.Element {
  return <OptionIcon category={category} value={value} size={size} />;
}
