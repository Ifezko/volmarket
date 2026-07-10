import * as Flags from 'country-flag-icons/react/3x2'

// Country name -> ISO 3166 code used by country-flag-icons. These render as real bundled SVGs
// that look identical on every OS. The old FL emoji were regional-indicator flags, which
// Windows (and some Linux) can't render — they fell back to bare letters like "NL"/"PT"/"AR",
// which is the "flags not showing on desktop" bug. Draw / Over / Under have no country flag,
// so callers pass a `fallback` glyph (⚖️/⚽/🛡️) which are ordinary emoji that do render.
const CODE: Record<string, keyof typeof Flags> = {
  Brazil: 'BR',
  Argentina: 'AR',
  France: 'FR',
  England: 'GB_ENG',
  Spain: 'ES',
  Switzerland: 'CH',
  Norway: 'NO',
  Germany: 'DE',
  Portugal: 'PT',
  Netherlands: 'NL',
  USA: 'US',
  Mexico: 'MX',
  Croatia: 'HR',
  Belgium: 'BE',
  Italy: 'IT',
  Uruguay: 'UY',
  Japan: 'JP',
  Senegal: 'SN',
  Nigeria: 'NG',
  Ghana: 'GH',
  Morocco: 'MA',
  Colombia: 'CO',
}

// A flag glyph for a country, sized by the enclosing `.fl` font-size (see .fl svg in the CSS).
// `country` is the display name (a team, or an odd label like "Draw"); non-countries render
// the `fallback` emoji instead.
export function Flag({ country, className = 'fl', fallback }: { country: string; className?: string; fallback?: string }) {
  const code = CODE[country]
  const Svg = code ? Flags[code] : undefined
  return <span className={className}>{Svg ? <Svg title={country} /> : fallback}</span>
}
