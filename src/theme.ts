export const colors = {
  bg: '#0B0B0C',
  surface: '#17181B',
  surface2: '#212327',
  hairline: 'rgba(255,255,255,0.08)',
  text: '#F5F5F5',
  mute: '#9A9DA5',
  dim: '#5D6068',
  accent: '#C6FF3D', // electric lime
  accentDim: 'rgba(198,255,61,0.14)',
  onAccent: '#0B0B0C',
  danger: '#FF4D4F',
  amber: '#FFB020',
};

export const radius = { sm: 12, md: 20, lg: 28, xl: 36, pill: 999 };

export const font = {
  // display / numerals
  d600: 'BarlowCondensed_600SemiBold',
  d700: 'BarlowCondensed_700Bold',
  d800: 'BarlowCondensed_800ExtraBold',
  // ui text
  t500: 'Inter_500Medium',
  t600: 'Inter_600SemiBold',
  t700: 'Inter_700Bold',
};

/** Small uppercase label style used across both screens. */
export const label = {
  fontFamily: font.t600,
  fontSize: 11,
  letterSpacing: 1.4,
  color: colors.mute,
  textTransform: 'uppercase' as const,
};
