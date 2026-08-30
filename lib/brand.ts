// Single source of truth for naming. CLAUDE.md records the public brand as
// undecided; internal identifiers stay `iwaiver` regardless. Change these two
// values to rename the site — nothing else hardcodes the name.
export const BRAND = {
  name: "I-Waiver",
  domain: "i-waiver.com",
  tagline: "The agreement and the cover, signed together.",
} as const;
