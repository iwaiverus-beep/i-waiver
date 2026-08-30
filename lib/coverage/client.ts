import "server-only";

import { coverageInternalKey, siteOrigin } from "@/lib/env";
import type {
  BindRequest,
  BindResponse,
  QuoteRequest,
  QuoteResponse,
} from "@/lib/coverage/contract";

/**
 * How the agreements app talks to coverage.
 *
 * Over HTTP, to the same endpoints a partner uses, with a credential of its own.
 * It would be faster to import `createQuote` directly — and that is exactly the
 * shortcut CLAUDE.md constraint 9 rules out. An interface only one caller has ever
 * gone through is an interface nobody has tested.
 *
 * The cost is one loopback request per quote. The benefit is that the day a
 * partner integrates, the path they take is the path that has been in production
 * from the beginning.
 */

export class CoverageUnavailable extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, body: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${siteOrigin()}/api/coverage/v1${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${coverageInternalKey()}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (cause) {
    throw new CoverageUnavailable(
      `Coverage service unreachable: ${(cause as Error).message}`,
      503,
    );
  }

  const payload = (await response.json().catch(() => ({}))) as
    | T
    | { error?: string; detail?: string };

  if (!response.ok) {
    const message =
      (payload as { error?: string }).error ?? `Coverage service returned ${response.status}`;
    throw new CoverageUnavailable(message, response.status);
  }

  return payload as T;
}

export function requestQuote(request: QuoteRequest): Promise<QuoteResponse> {
  return call<QuoteResponse>("/quote", request);
}

export function bindCoverage(request: BindRequest): Promise<BindResponse> {
  return call<BindResponse>("/bind", request);
}
