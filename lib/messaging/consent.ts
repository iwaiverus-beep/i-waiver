/**
 * The words beside the tick box, in one place.
 *
 * No imports and no `server-only`, on the same reasoning as
 * lib/partners/vocabulary.ts: the borrower's form renders this in the browser
 * and the intake route stores it on the row, and the whole value of storing it
 * is that the two are provably the same string. Two copies that drift produce a
 * consent record describing a sentence nobody was ever shown.
 *
 * A carrier reviewing a messaging registration reads this wording and the
 * matching page at /legal/messaging side by side. Four things have to survive
 * any edit: what we send, that it is not recurring marketing, that rates may
 * apply, and how to stop. Changing it is not a copy tweak — old rows keep the
 * sentence they were given, which is the point, so the new one has to stand on
 * its own.
 */
export const SMS_CONSENT_TEXT =
  "Text me the link to sign. Only about this request — not marketing, and not recurring. " +
  "Message and data rates may apply. Reply STOP at any time to stop.";
