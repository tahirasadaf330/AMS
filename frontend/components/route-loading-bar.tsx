'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

export function RouteLoadingBar() {
  const pathname = usePathname();
  const [pct, setPct] = useState(0);
  const [visible, setVisible] = useState(false);
  const prevRef  = useRef(pathname);
  const tickRef  = useRef<ReturnType<typeof setInterval>>();
  const hideRef  = useRef<ReturnType<typeof setTimeout>>();

  // Start bar when an internal link is clicked
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const a = (e.target as Element).closest('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank') return;
      try {
        const url = new URL(a.href, location.href);
        if (url.origin !== location.origin) return;
        if (url.pathname === pathname) return;
      } catch { return; }

      clearInterval(tickRef.current);
      clearTimeout(hideRef.current);
      setVisible(true);
      setPct(8);

      tickRef.current = setInterval(() => {
        setPct((p) => {
          if (p >= 80) { clearInterval(tickRef.current); return 80; }
          return p + (80 - p) * 0.09;
        });
      }, 180);
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [pathname]);

  // Complete bar when pathname changes
  useEffect(() => {
    if (prevRef.current === pathname) return;
    prevRef.current = pathname;
    clearInterval(tickRef.current);
    setPct(100);
    clearTimeout(hideRef.current);
    hideRef.current = setTimeout(() => {
      setVisible(false);
      setPct(0);
    }, 380);
  }, [pathname]);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 9999,
        height: '2px',
        width: `${pct}%`,
        background: 'linear-gradient(90deg, #3b82f6 0%, #6366f1 100%)',
        transition: pct === 100 ? 'width 0.12s ease-out' : 'width 0.18s ease-in-out',
        pointerEvents: 'none',
        borderRadius: '0 2px 2px 0',
        boxShadow: '0 0 6px 1px rgba(99,102,241,0.5)',
      }}
    />
  );
}
