'use client';

import {useLayoutEffect, useRef, type ReactNode} from 'react';

// Keep the volume in its own top-layer workspace, but in the same Android WebView.
// Closing it never destroys a WebView or transfers Android focus to another renderer.
export function TabletVolumeDialog({children, onClose}: {children:ReactNode; onClose:()=>void}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const token = crypto.randomUUID();
    const back = (event:Event) => {
      if ((event as CustomEvent).detail !== token) return;
      event.preventDefault();
      onClose();
    };
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    window.addEventListener('radaz:volume-back', back);
    window.prompt('radaz-tablet/volume-opened', token);
    return () => {
      window.removeEventListener('radaz:volume-back', back);
      window.prompt('radaz-tablet/volume-closed', token);
      if (dialog.open) dialog.close();
      if (previous?.isConnected) previous.focus({preventScroll:true});
    };
  }, [onClose]);
  return <dialog ref={ref} className="tablet-volume-dialog" aria-label="3D həcm görüntüləmə"
    onCancel={event=>{event.preventDefault();onClose();}}>{children}</dialog>;
}
