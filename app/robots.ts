import type { MetadataRoute } from "next";

/**
 * Keeps the preview out of search results.
 *
 * This is the belt to the `noindex` braces in app/layout.tsx, and the braces are
 * the part that does the work: robots.txt only asks a crawler not to *fetch* a
 * page. A URL that is linked from somewhere else can still end up indexed
 * without ever being crawled, and a Disallow rule cannot remove it — only a
 * `noindex` the crawler is allowed to read can do that.
 *
 * Both are here because well-behaved bots honour this file and it costs nothing.
 * Neither is a security measure: anyone with the URL can still open the site.
 *
 * At launch, delete this file and set `robots: { index: true, follow: true }` in
 * the root layout.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
