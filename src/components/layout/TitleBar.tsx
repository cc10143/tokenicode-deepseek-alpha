import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const win = getCurrentWindow();

/**
 * Custom title bar for the frameless (decorations: false) window.
 * Provides the drag region (native drag + double-click-to-maximize) and
 * window controls. Close routes through App.tsx's onCloseRequested flow.
 */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      win.isMaximized().then((m) => {
        if (mounted) setMaximized(m);
      });
    };
    refresh();
    const unlisten = win.onResized(refresh);
    return () => {
      mounted = false;
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="flex items-stretch h-[36px] flex-shrink-0 select-none
      bg-bg-chat border-b border-border-subtle">
      {/* Drag region — data-tauri-drag-region handles drag + double-click-to-maximize natively */}
      <div
        data-tauri-drag-region
        className="flex-1 min-w-0 flex items-center px-3 h-full cursor-default"
      >
        <span
          data-tauri-drag-region
          className="text-[11px] font-semibold tracking-wide text-text-tertiary truncate"
        >
          TOKENICODE
        </span>
      </div>

      {/* Window controls */}
      <div className="flex items-stretch h-full text-text-secondary">
        <button
          onClick={() => win.minimize()}
          className="w-[46px] flex items-center justify-center hover:bg-bg-tertiary transition-colors"
          title="最小化"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M0 5h10" />
          </svg>
        </button>
        <button
          onClick={() => win.toggleMaximize()}
          className="w-[46px] flex items-center justify-center hover:bg-bg-tertiary transition-colors"
          title={maximized ? '还原' : '最大化'}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="2.5" width="7" height="7" />
              <path d="M2.5 0.5h7v7" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          )}
        </button>
        <button
          onClick={() => win.close()}
          className="w-[46px] flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
          title="关闭"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M0 0l10 10M10 0L0 10" />
          </svg>
        </button>
      </div>
    </div>
  );
}
