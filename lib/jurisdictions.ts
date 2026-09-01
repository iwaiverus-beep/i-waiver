/**
 * US states, as the schema's `jurisdiction_code` domain means them: the state
 * where the ACTIVITY happens, never where anyone lives.
 *
 * No `server-only` here on purpose — the application form and the admin console
 * both render this list, and there is nothing secret about the states.
 *
 * DC is included. It is not a state, it is a jurisdiction, and jet skis go out on
 * the Potomac.
 */
export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;

export type StateCode = (typeof US_STATES)[number];

export function isStateCode(value: string): value is StateCode {
  return (US_STATES as readonly string[]).includes(value);
}

/**
 * What a sandbox key is allowed to quote in: everywhere.
 *
 * A partner has to be able to build their integration before we are admitted in
 * their states — otherwise the order of events is sign, wait for a filing, then
 * start writing code. Sandbox quotes are labelled as sandbox in the response and
 * in every summary string, and bind to a mock carrier, so the only thing a broad
 * list costs is nothing.
 *
 * A LIVE key gets the states somebody checked against the carrier's filings, and
 * nothing else. The two lists are built in different places for that reason.
 */
export const SANDBOX_JURISDICTIONS: string[] = [...US_STATES];
