'use client';

import {useRef} from 'react';
import {X} from 'lucide-react';

export function VrCloseButton({onClose, loading = false}: {onClose: () => void; loading?: boolean}) {
  const pressed = useRef<number | null>(null);
  return <button type="button" className={loading ? undefined : 'vr-close'}
    title="3D pəncərəni bağla" aria-label="3D pəncərəni bağla"
    onPointerDown={event => {
      if (event.pointerType === 'mouse' || !event.isPrimary || event.button !== 0) return;
      pressed.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { pressed.current = null; }}
    onLostPointerCapture={() => { pressed.current = null; }}
    onPointerUp={event => {
      if (pressed.current !== event.pointerId) return;
      pressed.current = null;
      const button = event.currentTarget;
      const target = button.ownerDocument.elementFromPoint(event.clientX, event.clientY);
      if (target && button.contains(target)) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }}
    onClick={onClose}>{loading ? 'Bağla' : <X/>}</button>;
}
