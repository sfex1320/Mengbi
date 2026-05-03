import { AnimatePresence, motion } from 'framer-motion';
import { useToastStore } from '@/store/toastStore';

export function ToastViewport(): JSX.Element {
  const { toasts, dismiss } = useToastStore();

  return (
    <div className="mb-toast-container">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 20, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className={`mb-toast mb-toast-${t.kind}`}
            onClick={() => dismiss(t.id)}
          >
            <span className="mb-toast-icon" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{t.title}</div>
              {t.description && (
                <div
                  style={{
                    color: 'var(--mb-text-secondary)',
                    fontSize: 12,
                    marginTop: 2
                  }}
                >
                  {t.description}
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
