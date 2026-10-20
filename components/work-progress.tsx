'use client';
import { progressPercent, type WorkProgress as Progress } from '@/lib/work-progress';

export function WorkProgress({ progress, className = '' }: { progress: Progress | null; className?: string }) {
  if (!progress) return null;
  const unknown = progress.indeterminate || !progress.total;
  return <div className={`work-progress ${className}`} role="status" aria-live="polite" data-done={progress.done} data-total={progress.total}>
    <strong>{progress.label}{unknown ? '…' : ` — ${progressPercent(progress.done, progress.total)}%`}</strong>
    <progress aria-label={progress.label} max={progress.total || 1} value={unknown ? undefined : progress.done}/>
    {progress.counter ? <span>{progress.counter}</span> : progress.total > 0 && <span>{Math.floor(progress.done)} / {Math.ceil(progress.total)} {progress.unit || 'görüntü'}</span>}
    {progress.phase && <small>{progress.phase}</small>}
  </div>;
}
