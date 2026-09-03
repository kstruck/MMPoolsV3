/** @type {import('tailwindcss').Config} */
export default {
  // Wrap every `hover:` variant in `@media (hover: hover)` so touch devices
  // (which fire :hover on tap and leave it stuck) never see hover-only
  // scale/colour states.
  future: { hoverOnlyWhenSupported: true },
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#0B1526', 900: '#0E1C34', 800: '#142A4C', 700: '#1A3B62', 600: '#24507F' },
        gold: { 700: '#8C6D33', 600: '#B78F4A', 500: '#C9A867', 400: '#D9BC80', 300: '#E6CE96' },
        brandred: { 700: '#9E241F', 600: '#C4342E', 500: '#DA463F' },
        cream: '#F7F4EE',
        ink: '#131B2B',
        // Themed surfaces driven by CSS vars (see index.css / tokens)
        page: 'var(--page)',
        surface: 'var(--surface)',
        card: 'var(--card)',
        line: 'var(--line)',
        muted: 'var(--text-muted)',
        faint: 'var(--faint)',
      },
      fontFamily: {
        display: ["'Saira Condensed'", 'system-ui', 'sans-serif'],
        body: ["'Barlow'", 'system-ui', 'sans-serif'],
      },
      borderRadius: { sm: '6px', md: '10px', lg: '12px', xl: '16px', '2xl': '18px', '3xl': '24px' },
      boxShadow: {
        card: '0 2px 4px rgba(19,27,43,0.04)',
        'card-hover': '0 14px 34px rgba(19,27,43,0.14)',
        'red-cta': '0 10px 26px rgba(196,52,46,0.40)',
        panel: '0 18px 46px rgba(19,27,43,0.10)',
      },
      backgroundImage: {
        'gold-foil': 'linear-gradient(180deg, #EBD49B 0%, #C9A867 45%, #A98038 100%)',
      },
      animation: {
        'ticker-slow': 'ticker 60s linear infinite',
        ticker: 'ticker 32s linear infinite',
        'live-pulse': 'live-pulse 1.5s ease-in-out infinite',
      },
      keyframes: {
        ticker: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-100%)' },
        },
        'live-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        }
      }
    },
  },
  plugins: [],
}
