import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { PanelLeft, PanelLeftDashed } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Sidebar } from '../../components/Sidebar';
import { useNavStore } from '../../state/nav-store';
import { useSidebarStore } from '../../state/sidebar-store';

export const Route = createFileRoute('/_app')({
  component: AppLayout,
});

function AppLayout(): React.JSX.Element {
  const location = useLocation();
  const setLastAppPath = useNavStore((s) => s.setLastAppPath);
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggle = useSidebarStore((s) => s.toggle);
  const width = useSidebarStore((s) => s.width);
  const setWidth = useSidebarStore((s) => s.setWidth);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setLastAppPath(location.pathname);
  }, [location.pathname, setLastAppPath]);

  // Drag the divider to resize. Listen on document so the drag survives the
  // cursor outrunning the thin handle; setWidth clamps to [min, max].
  const onResizeStart = useCallback(
    (e: React.MouseEvent): void => {
      e.preventDefault();
      setDragging(true);
      const startX = e.clientX;
      const startW = useSidebarStore.getState().width;
      document.documentElement.classList.add('resizing');
      const onMove = (ev: MouseEvent): void => setWidth(startW + ev.clientX - startX);
      const onUp = (): void => {
        setDragging(false);
        document.documentElement.classList.remove('resizing');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [setWidth],
  );

  return (
    <div
      className="grid h-screen"
      style={{
        gridTemplateColumns: `${collapsed ? 0 : width}px 1fr`,
        // Animate collapse/expand, but track the cursor 1:1 while dragging.
        transition: dragging ? 'none' : 'grid-template-columns 200ms ease-out',
      }}
    >
      <div className="relative min-w-0 overflow-hidden">
        <Sidebar />
        {!collapsed && (
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onMouseDown={onResizeStart}
            className="app-no-drag absolute inset-y-0 right-0 z-40 w-1 cursor-col-resize hover:bg-accent/40"
          />
        )}
      </div>
      <main className="min-w-0 overflow-y-auto">
        <Outlet />
      </main>
      {/* Window-anchored toggle, right of the traffic lights. Expanded → sidebar
          top-right (follows width); collapsed → main top-left. */}
      <button
        type="button"
        onClick={toggle}
        className="app-no-drag fixed top-[10px] z-50 rounded-md p-1.5 text-fg-tertiary transition-colors hover:bg-surface-strong hover:text-fg-primary"
        style={{ left: collapsed ? 84 : width - 44 }}
      >
        {collapsed ? (
          <PanelLeft className="size-[17px]" />
        ) : (
          <PanelLeftDashed className="size-[17px]" />
        )}
      </button>
    </div>
  );
}
