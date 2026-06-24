/** 把内部组合串（如 'alt+arrowleft' / 'ctrl+shift+z'）美化成 UI 显示（'Alt+←' / 'Ctrl+Shift+Z'）。
 *  全应用共用（CanvasDock 按钮 tooltip / KeybindingsDialog / ArrangePanel）。 */
export function prettyCombo(combo?: string): string {
  if (!combo) return '';
  return combo
    .split('+')
    .map((p) => {
      if (p === 'arrowleft') return '←';
      if (p === 'arrowright') return '→';
      if (p === 'arrowup') return '↑';
      if (p === 'arrowdown') return '↓';
      if (p === 'ctrl') return 'Ctrl';
      if (p === 'shift') return 'Shift';
      if (p === 'alt') return 'Alt';
      if (p === 'meta') return 'Cmd';
      if (p === 'space') return '␣';
      if (p === 'enter') return '⏎';
      if (p === 'escape') return 'Esc';
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join('+');
}
