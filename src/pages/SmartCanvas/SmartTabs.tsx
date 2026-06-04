import { useSmartDocsStore, type SmartDocMeta } from '@/store/smartDocsStore';
import { switchDoc, closeDocTab, backToLauncher } from '@/lib/smartDocStorage';
import { PlusIcon } from './icons';

/** 多画布标签栏：并行打开的画布以标签呈现，点击切换、× 关闭、+ 回启动页开更多。 */
export function SmartTabs(): JSX.Element | null {
  const openIds = useSmartDocsStore((s) => s.openIds);
  const activeDocId = useSmartDocsStore((s) => s.activeDocId);
  const docs = useSmartDocsStore((s) => s.docs);

  const tabs = openIds
    .map((id) => docs.find((d) => d.id === id))
    .filter((d): d is SmartDocMeta => !!d);
  if (tabs.length === 0) return null;

  return (
    <div className="mb-sc-doctabs">
      {tabs.map((d) => (
        <div
          key={d.id}
          className={`mb-sc-doctab ${d.id === activeDocId ? 'is-active' : ''}`}
          role="button"
          tabIndex={0}
          title={d.title}
          onClick={() => switchDoc(d.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              switchDoc(d.id);
            }
          }}
        >
          <span className="mb-sc-doctab-title">{d.title}</span>
          <span
            className="mb-sc-doctab-x"
            role="button"
            tabIndex={-1}
            title="关闭标签（不删除画布）"
            onClick={(e) => {
              e.stopPropagation();
              closeDocTab(d.id);
            }}
          >
            ×
          </span>
        </div>
      ))}
      <button className="mb-sc-doctab-add" title="打开 / 新建画布" onClick={backToLauncher}>
        <PlusIcon size={14} />
      </button>
    </div>
  );
}
