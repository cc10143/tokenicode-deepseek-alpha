import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';

const win = getCurrentWindow();

/* Match tauri.conf.json minWidth/minHeight */
const MIN_W = 900;
const MIN_H = 600;

type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

function cursorFor(dir: Dir): string {
  switch (dir) {
    case 'n': return 'n-resize';
    case 's': return 's-resize';
    case 'e': return 'e-resize';
    case 'w': return 'w-resize';
    case 'ne': return 'ne-resize';
    case 'nw': return 'nw-resize';
    case 'se': return 'se-resize';
    case 'sw': return 'sw-resize';
  }
}

/**
 * Custom window resize handles for the frameless window.
 * The system thickframe (which normally provides edge-resize) is removed by
 * strip_system_frame in lib.rs, so resizing is re-implemented here as 8 hit
 * areas (N/S/E/W + 4 corners) that drive Tauri setSize/setPosition directly.
 *
 * Coordinates: pointer deltas are computed against the starting
 * outerPosition/outerSize, so left/top edges must also setPosition to keep the
 * opposite edge anchored. Updates are batched to one IPC call per animation
 * frame to avoid flooding the async setSize/setPosition.
 *
 * Pointer capture (setPointerCapture) keeps the drag alive even after the
 * cursor leaves the webview during a fast drag — Chromium honors it across the
 * window boundary while the button is held.
 */
export function ResizeHandles() {
  const [maximized, setMaximized] = useState(false);
  const drag = useRef<null | {
    dir: Dir;
    startMouseX: number;
    startMouseY: number;
    startWinX: number;
    startWinY: number;
    startW: number;
    startH: number;
  }>(null);
  const rafRef = useRef<number | null>(null);
  const pending = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

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

  const flush = () => {
    rafRef.current = null;
    const p = pending.current;
    pending.current = null;
    const d = drag.current;
    if (!p || !d) return;
    const needsPos = d.dir.includes('w') || d.dir.includes('n');
    win.setSize(new PhysicalSize(p.w, p.h));
    if (needsPos) win.setPosition(new PhysicalPosition(p.x, p.y));
  };

  const startDrag = (dir: Dir) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (maximized) return;
    e.preventDefault();
    e.stopPropagation();
    // Keep receiving moves after the cursor leaves the webview mid-drag.
    try {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture can fail if the pointer was already released; the drag
      // simply degrades to in-webview-only resizing.
    }
    // Capture the window's current outer position/size once at drag start.
    Promise.all([win.outerPosition(), win.outerSize()]).then(([pos, size]) => {
      drag.current = {
        dir,
        startMouseX: e.screenX,
        startMouseY: e.screenY,
        startWinX: pos.x,
        startWinY: pos.y,
        startW: size.width,
        startH: size.height,
      };
      document.body.style.cursor = cursorFor(dir);
      document.body.style.userSelect = 'none';
    });
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.screenX - d.startMouseX;
    const dy = e.screenY - d.startMouseY;

    let x = d.startWinX;
    let y = d.startWinY;
    let w = d.startW;
    let h = d.startH;

    if (d.dir.includes('w')) w = d.startW - dx;
    if (d.dir.includes('e')) w = d.startW + dx;
    if (d.dir.includes('n')) h = d.startH - dy;
    if (d.dir.includes('s')) h = d.startH + dy;

    w = Math.max(MIN_W, w);
    h = Math.max(MIN_H, h);
    // Keep the opposite edge anchored when resizing from the west/north.
    if (d.dir.includes('w')) x = d.startWinX + (d.startW - w);
    if (d.dir.includes('n')) y = d.startWinY + (d.startH - h);

    pending.current = { x, y, w, h };
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(flush);
    }
  };

  const endDrag = () => {
    drag.current = null;
    pending.current = null;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, []);

  if (maximized) return null;

  return (
    /* -inset-[2px] extends the hit areas over the 2px gradient-bg border so
       dragging at the very window edge (on the border) still resizes. */
    <div className="absolute -inset-[2px] z-[100] pointer-events-none">
      {/* Edges */}
      <div
        className="absolute top-0 left-0 right-0 h-[8px] cursor-n-resize pointer-events-auto"
        onPointerDown={startDrag('n')}
      />
      <div
        className="absolute bottom-0 left-0 right-0 h-[8px] cursor-s-resize pointer-events-auto"
        onPointerDown={startDrag('s')}
      />
      <div
        className="absolute left-0 top-0 bottom-0 w-[8px] cursor-w-resize pointer-events-auto"
        onPointerDown={startDrag('w')}
      />
      <div
        className="absolute right-0 top-0 bottom-0 w-[8px] cursor-e-resize pointer-events-auto"
        onPointerDown={startDrag('e')}
      />
      {/* Corners */}
      <div
        className="absolute top-0 left-0 w-[14px] h-[14px] cursor-nw-resize pointer-events-auto"
        onPointerDown={startDrag('nw')}
      />
      <div
        className="absolute top-0 right-0 w-[14px] h-[14px] cursor-ne-resize pointer-events-auto"
        onPointerDown={startDrag('ne')}
      />
      <div
        className="absolute bottom-0 left-0 w-[14px] h-[14px] cursor-sw-resize pointer-events-auto"
        onPointerDown={startDrag('sw')}
      />
      <div
        className="absolute bottom-0 right-0 w-[14px] h-[14px] cursor-se-resize pointer-events-auto"
        onPointerDown={startDrag('se')}
      />
    </div>
  );
}
