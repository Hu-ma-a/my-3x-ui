export const DAY_MS = 24 * 60 * 60 * 1000;

export function nowMs() {
  return Date.now();
}

export function addDaysMs(baseMs, days) {
  return baseMs + Number(days) * DAY_MS;
}

export function dayStartMs(ms = Date.now()) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function monthStartMs(ms = Date.now()) {
  const date = new Date(ms);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function formatDateTime(ms) {
  if (!ms) return '-';
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
