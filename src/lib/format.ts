import type { Run } from './storage';

const DAY = 86400000;

export const titleOf = (r: Run) => {
  const h = new Date(r.startedAt).getHours();
  const part = h < 5 ? 'Night' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night';
  return `${part} ${r.sport === 'walk' ? 'Walk' : 'Run'}`;
};

export const whenOf = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - new Date(ts).setHours(0, 0, 0, 0)) / DAY);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} · ${time}`;
};
