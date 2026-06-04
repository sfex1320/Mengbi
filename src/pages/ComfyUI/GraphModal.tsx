import { Modal } from '@/components/Modal';
import { GraphCanvas } from './GraphCanvas';
import { NodeInspector } from './NodeInspector';

/** 节点流程图弹窗：左侧流程图，右侧节点详情/绑定。由右下角悬浮按钮打开。 */
export function GraphModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  return (
    <Modal open={open} onClose={onClose} title="节点流程图（点节点可绑定字段）" width={1180} dismissOnEsc>
      <div className="mb-cfy-graphmodal">
        <div className="mb-cfy-graphmodal-canvas">
          <GraphCanvas />
        </div>
        <div className="mb-cfy-graphmodal-side">
          <NodeInspector />
        </div>
      </div>
    </Modal>
  );
}
