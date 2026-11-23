import type { Config } from 'tailwindcss';
const v = (n: string) => `var(--${n})`;
export default {
  content: ['./app/**/*.tsx'],
  theme: { extend: {
    colors: { bg: v('bg'), surface: v('surface'), ink: v('ink'), muted: v('muted'), line: v('line'), accent: v('accent'), soft: v('soft'), onaccent: v('onaccent'), warnbg: v('warnbg'), warnink: v('warnink'), okbg: v('okbg'), okink: v('okink'), closedbg: v('closedbg'), closedink: v('closedink'), "ac-green": v("ac-green"), "ac-green-ink": v("ac-green-ink"), "ac-orange": v("ac-orange"), "ac-orange-ink": v("ac-orange-ink"), "ac-yellow": v("ac-yellow"), "ac-yellow-ink": v("ac-yellow-ink"), "ac-red": v("ac-red"), "ac-red-ink": v("ac-red-ink"), "ac-gray": v("ac-gray"), "ac-gray-ink": v("ac-gray-ink"), "ac-blue": v("ac-blue"), "ac-blue-ink": v("ac-blue-ink"), personalbg: v("personalbg"), personalink: v("personalink"), "cc-red": v("cc-red"), "cc-red-ink": v("cc-red-ink"), "cc-blue": v("cc-blue"), "cc-blue-ink": v("cc-blue-ink"), "cc-green": v("cc-green"), "cc-green-ink": v("cc-green-ink"), "cc-purple": v("cc-purple"), "cc-purple-ink": v("cc-purple-ink"), "cc-orange": v("cc-orange"), "cc-orange-ink": v("cc-orange-ink"), "cc-teal": v("cc-teal"), "cc-teal-ink": v("cc-teal-ink"), "cc-amber": v("cc-amber"), "cc-amber-ink": v("cc-amber-ink"), "cc-pink": v("cc-pink"), "cc-pink-ink": v("cc-pink-ink") },
    fontFamily: { display: ['var(--font-display)', 'Inter', 'sans-serif'] },
  } },
} satisfies Config;
