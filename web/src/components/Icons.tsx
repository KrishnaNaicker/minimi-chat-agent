import type { SVGProps } from 'react';

// A handful of 16px line icons, drawn inline so there's no icon dependency.
const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
});

export const IconCompose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9.5 2.5h-6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-6" /><path d="M12.2 1.8a1.1 1.1 0 0 1 1.6 1.6L8.5 8.7 6.5 9.5l.8-2z" /></svg>
);
export const IconArrowUp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></svg>
);
export const IconStop = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ ...p, fill: 'currentColor', stroke: 'none' })}><rect x="4" y="4" width="8" height="8" rx="1.5" /></svg>
);
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3.3 3.3" /></svg>
);
export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="8" cy="8" r="5.75" /><path d="M8 4.75V8l2 1.5" /></svg>
);
export const IconReceipt = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 1.75h8v12.5l-1.6-1-1.2 1-1.2-1-1.2 1-1.2-1-1.6 1z" /><path d="M6 5.5h4M6 8h4" /></svg>
);
export const IconRefresh = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71" /><path d="M13.25 2.5v3h-3" /></svg>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m3.5 8.5 3 3 6-7" /></svg>
);
export const IconCopy = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="5.25" y="5.25" width="8" height="8" rx="1.5" /><path d="M10.75 5.25v-1.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1.5" /></svg>
);
export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4.25 4.25l.6 8.5a1 1 0 0 0 1 .95h4.3a1 1 0 0 0 1-.95l.6-8.5" /></svg>
);
export const IconSidebar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" /><path d="M6 2.75v10.5" /></svg>
);
export const IconKey = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="5.5" cy="10.5" r="3" /><path d="m7.6 8.4 5.65-5.65M11 5l1.75 1.75M9.5 6.5l1.25 1.25" /></svg>
);
export const IconAlert = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 2 1.75 13h12.5z" /><path d="M8 6.5v3M8 11.4v.1" /></svg>
);
