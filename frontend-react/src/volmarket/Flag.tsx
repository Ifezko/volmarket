import * as Flags from 'country-flag-icons/react/3x2'

// Country name -> ISO 3166 code used by country-flag-icons. These render as real bundled SVGs
// that look identical on every OS. The old FL emoji were regional-indicator flags, which
// Windows (and some Linux) can't render - they fell back to bare letters like "NL"/"PT"/"AR",
// which is the "flags not showing on desktop" bug. Draw / Over / Under have no country flag,
// so callers pass a `fallback` glyph (⚖️/⚽/🛡️) which are ordinary emoji that do render.
const CODE: Record<string, keyof typeof Flags> = {
  // UEFA
  England: 'GB_ENG', Scotland: 'GB_SCT', Wales: 'GB_WLS', 'Northern Ireland': 'GB_NIR',
  France: 'FR', Spain: 'ES', Germany: 'DE', Portugal: 'PT', Netherlands: 'NL', Belgium: 'BE',
  Italy: 'IT', Croatia: 'HR', Switzerland: 'CH', Norway: 'NO', Denmark: 'DK', Sweden: 'SE',
  Poland: 'PL', Serbia: 'RS', Austria: 'AT', Ukraine: 'UA', Turkey: 'TR', Greece: 'GR',
  Ireland: 'IE', 'Republic of Ireland': 'IE', Czechia: 'CZ', 'Czech Republic': 'CZ',
  Slovakia: 'SK', Slovenia: 'SI', Hungary: 'HU', Romania: 'RO', Bulgaria: 'BG', Finland: 'FI',
  Iceland: 'IS', Albania: 'AL', 'North Macedonia': 'MK', 'Bosnia and Herzegovina': 'BA',
  Montenegro: 'ME', Russia: 'RU', Belarus: 'BY', Georgia: 'GE', Armenia: 'AM', Azerbaijan: 'AZ',
  Israel: 'IL', Cyprus: 'CY', Estonia: 'EE', Latvia: 'LV', Lithuania: 'LT', Luxembourg: 'LU',
  Malta: 'MT', Moldova: 'MD', Kosovo: 'XK', Liechtenstein: 'LI', Gibraltar: 'GI',
  'Faroe Islands': 'FO', Andorra: 'AD', 'San Marino': 'SM', Kazakhstan: 'KZ',
  // CONMEBOL
  Brazil: 'BR', Argentina: 'AR', Uruguay: 'UY', Colombia: 'CO', Chile: 'CL', Peru: 'PE',
  Ecuador: 'EC', Paraguay: 'PY', Bolivia: 'BO', Venezuela: 'VE',
  // CONCACAF
  USA: 'US', 'United States': 'US', Mexico: 'MX', Canada: 'CA', 'Costa Rica': 'CR',
  Panama: 'PA', Honduras: 'HN', Jamaica: 'JM', 'El Salvador': 'SV', Guatemala: 'GT',
  Haiti: 'HT', 'Trinidad and Tobago': 'TT', Curacao: 'CW',
  // CAF
  Senegal: 'SN', Nigeria: 'NG', Ghana: 'GH', Morocco: 'MA', Tunisia: 'TN', Algeria: 'DZ',
  Egypt: 'EG', Cameroon: 'CM', 'Ivory Coast': 'CI', "Cote d'Ivoire": 'CI', 'South Africa': 'ZA',
  Mali: 'ML', 'Burkina Faso': 'BF', Guinea: 'GN', 'Cape Verde': 'CV', Gabon: 'GA', Zambia: 'ZM',
  Angola: 'AO', Mozambique: 'MZ', Kenya: 'KE', Uganda: 'UG', Tanzania: 'TZ', Zimbabwe: 'ZW',
  Ethiopia: 'ET', Sudan: 'SD', Libya: 'LY', Benin: 'BJ', Togo: 'TG', Niger: 'NE', Chad: 'TD',
  Gambia: 'GM', 'Sierra Leone': 'SL', Liberia: 'LR', Mauritania: 'MR', Namibia: 'NA',
  Botswana: 'BW', Madagascar: 'MG', Comoros: 'KM', 'DR Congo': 'CD', Congo: 'CG',
  'Equatorial Guinea': 'GQ', 'Guinea-Bissau': 'GW', Rwanda: 'RW', Burundi: 'BI', Somalia: 'SO',
  // AFC
  Japan: 'JP', 'South Korea': 'KR', Korea: 'KR', Australia: 'AU', Iran: 'IR', 'Saudi Arabia': 'SA',
  Qatar: 'QA', Iraq: 'IQ', 'United Arab Emirates': 'AE', UAE: 'AE', Uzbekistan: 'UZ',
  China: 'CN', India: 'IN', Vietnam: 'VN', Thailand: 'TH', Indonesia: 'ID', Malaysia: 'MY',
  Singapore: 'SG', Philippines: 'PH', Myanmar: 'MM', Cambodia: 'KH', Laos: 'LA',
  Jordan: 'JO', Oman: 'OM', Bahrain: 'BH', Kuwait: 'KW', Syria: 'SY', Lebanon: 'LB',
  Palestine: 'PS', Yemen: 'YE', Bangladesh: 'BD', Pakistan: 'PK', 'Sri Lanka': 'LK',
  Nepal: 'NP', Afghanistan: 'AF', Tajikistan: 'TJ', Turkmenistan: 'TM', Kyrgyzstan: 'KG',
  'Hong Kong': 'HK', Taiwan: 'TW', 'North Korea': 'KP',
  // OFC
  'New Zealand': 'NZ', Fiji: 'FJ', 'Papua New Guinea': 'PG', 'Solomon Islands': 'SB',
  Vanuatu: 'VU', Samoa: 'WS', Tonga: 'TO', Tahiti: 'PF',
}

// Shown when a name has no country flag and the caller supplied no glyph of its own. Deliberately a
// neutral marker, never the raw ISO letters - bare "ES"/"AR" text is the exact bug this file exists
// to prevent.
const NEUTRAL = '⚑'

// A flag glyph for a country, sized by the enclosing `.fl` font-size (see .fl svg in the CSS).
// `country` is the display name (a team, or an odd label like "Draw"); non-countries render
// the `fallback` emoji instead.
export function Flag({ country, className = 'fl', fallback }: { country: string; className?: string; fallback?: string }) {
  const code = CODE[country]
  const Svg = code ? Flags[code] : undefined
  return <span className={className}>{Svg ? <Svg title={country} /> : (fallback ?? NEUTRAL)}</span>
}
