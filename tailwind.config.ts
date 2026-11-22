import type { Config } from 'tailwindcss';
const v = (n: string) => `var(--${n})`;
export default {
  content: ['./app/**/*.tsx'],
  theme: { extend: {
    colors: { bg: v('bg'), surface: v('surface'), ink: v('ink'), muted: v('muted'), line: v('line'), accent: v('accent'), soft: v('soft'), onaccent: v('onaccent'), warnbg: v('warnbg'), warnink: v('warnink'), okbg: v('okbg'), okink: v('okink') },
    fontFamily: { display: ['var(--font-display)', 'Inter', 'sans-serif'] },
  } },
} satisfies Config;
