import type { Config } from 'tailwindcss';

/**
 * Terminal palette.
 *
 * Green and red are reserved for semantics — direction, profit and loss,
 * pass and fail. Everything structural is neutral, so a red number always
 * means something rather than being decoration.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#07090c',
          900: '#0b0e13',
          850: '#0f131a',
          800: '#141922',
          700: '#1b2230',
          600: '#26303f',
          500: '#36435a',
          400: '#5a6a86',
          300: '#8695ad',
          200: '#b6c2d4',
          100: '#dde4ee',
        },
        bull: { DEFAULT: '#22c55e', dim: '#14532d', soft: 'rgba(34,197,94,0.14)' },
        bear: { DEFAULT: '#ef4444', dim: '#7f1d1d', soft: 'rgba(239,68,68,0.14)' },
        warn: { DEFAULT: '#f59e0b', dim: '#78350f', soft: 'rgba(245,158,11,0.14)' },
        info: { DEFAULT: '#38bdf8', dim: '#075985', soft: 'rgba(56,189,248,0.14)' },
        accent: { DEFAULT: '#a78bfa', dim: '#4c1d95', soft: 'rgba(167,139,250,0.14)' },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'Inter', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'JetBrains Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: { card: '0.375rem' },
    },
  },
  plugins: [],
};

export default config;
