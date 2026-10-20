export type WorkProgress = { label: string; done: number; total: number; phase?: string; unit?: string; counter?: string; indeterminate?: boolean };
export const progressPercent = (done: number, total: number) => total > 0 ? Math.floor(Math.max(0, Math.min(done, total)) * 100 / total) : 0;
/** Yield after actual work, never advance progress from elapsed time. */
export const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));
