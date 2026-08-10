const UK = 'Europe/London';

export const fmtKickoff = (iso: string | Date) =>
  new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', timeZone: UK
  });

export const fmtTime = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: UK });

export const fmtDayHeading = (iso: string | Date) =>
  new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: UK
  });

export function countdown(target: Date, now = new Date()): string {
  let ms = target.getTime() - now.getTime();
  if (ms <= 0) return 'LOCKED';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor(ms / 3600000) % 24;
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
