import { ControlsForm } from './ControlsForm';

/**
 * 「参数」tab 内容：只放控件表单。运行/取消 + 进度已上移到顶部常驻的 RunControl。
 */
export function RunBar(): JSX.Element {
  return (
    <section className="mb-cfy-run mb-card">
      <span className="mb-cfy-section-title">参数</span>
      <ControlsForm />
    </section>
  );
}
