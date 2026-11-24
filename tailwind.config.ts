import type { Config } from 'tailwindcss';
const v = (n: string) => `var(--${n})`;
const COURSE_COLORS = ['red', 'blue', 'green', 'purple', 'orange', 'teal', 'amber', 'pink'];
const ACADEMIC_COLORS = ['green', 'orange', 'yellow', 'red', 'gray', 'blue'];
// Every course colour has a soft fill (cc-x), dark ink (cc-x-ink) and a solid chip colour (cc-x-solid).
const course = Object.fromEntries(COURSE_COLORS.flatMap((c) => [[`cc-${c}`, v(`cc-${c}`)], [`cc-${c}-ink`, v(`cc-${c}-ink`)], [`cc-${c}-solid`, v(`cc-${c}-solid`)]]));
const academic = Object.fromEntries(ACADEMIC_COLORS.flatMap((c) => [[`ac-${c}`, v(`ac-${c}`)], [`ac-${c}-ink`, v(`ac-${c}-ink`)]]));
export default {
  content: ['./app/**/*.tsx'],
  theme: { extend: {
    colors: {
      bg: v('bg'), surface: v('surface'), ink: v('ink'), muted: v('muted'), line: v('line'), fill: v('fill'), accent: v('accent'), soft: v('soft'), onaccent: v('onaccent'),
      warnbg: v('warnbg'), warnink: v('warnink'), okbg: v('okbg'), okink: v('okink'), closedbg: v('closedbg'), closedink: v('closedink'),
      personalbg: v('personalbg'), personalink: v('personalink'), ...academic, ...course,
    },
    boxShadow: { card: v('shadow') },
    fontFamily: { display: ['var(--font-display)', 'Inter', 'sans-serif'] },
  } },
} satisfies Config;
