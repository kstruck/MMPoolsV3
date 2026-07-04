// March Melee Pools — Design Tokens (v3)
// Single source of truth for colors, typography, spacing, radii, shadows.
// Import into your app or mirror into tailwind.config.

export const colors = {
  navy: {
    950: '#0B1526', // app base (dark theme background)
    900: '#0E1C34',
    800: '#142A4C', // PRIMARY brand navy
    700: '#1A3B62',
    600: '#24507F', // lines / borders on dark
  },
  gold: {
    700: '#8C6D33',
    600: '#B78F4A',
    500: '#C9A867', // base gold
    400: '#D9BC80',
    300: '#E6CE96',
  },
  red: {
    // Use sparingly: live badges, primary CTAs, alerts, eliminations. Never as a background field.
    700: '#9E241F',
    600: '#C4342E',
    500: '#DA463F',
  },
  // Light theme neutrals
  light: {
    page: '#F7F4EE',   // cream page background
    paper: '#FFFFFF',  // cards / elevated surfaces
    ink: '#131B2B',    // primary text
    muted: '#5C6678',  // secondary text
    faint: '#8B93A3',  // tertiary text
    line: '#E7E3D9',   // borders / dividers
  },
  // Dark theme surfaces
  dark: {
    page: '#0B1526',
    surface: '#0E1C34',
    card: '#152747',
    ink: '#EDF1F8',
    muted: '#9FB0CC',
    faint: '#7C8BA6',
    line: 'rgba(230,206,150,0.16)',
  },
  // Semantic status colors
  status: {
    liveBg: '#C4342E', liveFg: '#FFFFFF',
    paidBg: '#E4F5EC', paidFg: '#0F7B4A', paidBorder: '#BEE7D0',
    unpaidBg: '#FBEEDD', unpaidFg: '#B4530A', unpaidBorder: '#F2D6B0',
    openBg: '#E5EDF6', openFg: '#142A4C', openBorder: '#CBDCEC',
    winnerBg: '#FBF3E0', winnerFg: '#8C6D33', winnerBorder: '#EAD9A8',
    everyScoreBg: '#5B2A86', everyScoreFg: '#FFFFFF', // Squares "every score" event
    success: '#0F7B4A',
  },
} as const;

// Signature gold "foil" gradient — trophy/premium CTAs, winner chips.
export const goldGradient = 'linear-gradient(180deg, #EBD49B 0%, #C9A867 45%, #A98038 100%)';

export const fonts = {
  // Headings, buttons, stat figures, labels, badges — ALWAYS uppercase, tight leading.
  display: "'Saira Condensed', system-ui, sans-serif",
  // Body, forms, tables.
  body: "'Barlow', system-ui, sans-serif",
} as const;

// Font weights in use: Saira Condensed 500/600/700/800 · Barlow 400/500/600/700
export const type = {
  hero:      { font: 'display', size: 74, weight: 800, lineHeight: 0.92, transform: 'uppercase', tracking: '0.005em' },
  h1:        { font: 'display', size: 46, weight: 800, lineHeight: 1.0,  transform: 'uppercase' },
  h2:        { font: 'display', size: 44, weight: 700, lineHeight: 1.0,  transform: 'uppercase' },
  h3:        { font: 'display', size: 24, weight: 700, lineHeight: 1.05, transform: 'uppercase' },
  label:     { font: 'display', size: 13, weight: 700, lineHeight: 1.2,  transform: 'uppercase', tracking: '0.16em' },
  button:    { font: 'display', size: 16, weight: 700, lineHeight: 1.0,  transform: 'uppercase', tracking: '0.05em' },
  stat:      { font: 'display', size: 40, weight: 700, lineHeight: 1.1,  numeric: 'tabular-nums' },
  body:      { font: 'body', size: 16, weight: 400, lineHeight: 1.6 },
  bodySm:    { font: 'body', size: 14, weight: 400, lineHeight: 1.55 },
  // Always apply font-variant-numeric: tabular-nums to scores, money, odds, ranks.
} as const;

export const radii = {
  sm: 6,   // tags
  md: 10,  // buttons, inputs
  lg: 12,  // large buttons
  xl: 16,  // panels
  '2xl': 18, // cards
  '3xl': 24, // hero/CTA banners
  pill: 999,
} as const;

export const shadows = {
  card: '0 2px 4px rgba(19,27,43,0.04)',
  cardHover: '0 14px 34px rgba(19,27,43,0.14)',
  cardHoverLg: '0 18px 40px rgba(19,27,43,0.12)',
  redCta: '0 10px 26px rgba(196,52,46,0.40)',
  goldCta: '0 8px 20px rgba(140,109,51,0.28)',
  panel: '0 18px 46px rgba(19,27,43,0.10)',
} as const;

// Spacing: 4px base scale. Section vertical rhythm ~80px; content max-width 1200px.
export const layout = {
  maxWidth: 1200,
  gutter: 32,
  sectionY: 80,
} as const;
