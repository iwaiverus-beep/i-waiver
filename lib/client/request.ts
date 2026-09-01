/**
 * The one fetch wrapper the console components share.
 *
 * No `server-only` — this is imported by client components on purpose. It exists
 * because every one of those components otherwise repeats the same fifteen lines
 * of try/catch/parse, and the version that gets copied wrong is always the one
 * that swallows the server's error message and shows "Something went wrong"
 * instead of "Type the slug to confirm".
 */
export type ActionResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function send<T = Record<string, unknown>>(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ActionResult<T>> {
  try {
    const response = await fetch(url, {
      method: init.method ?? "POST",
      headers: init.body ? { "content-type": "application/json" } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      const outstanding = Array.isArray(payload.outstanding)
        ? ` Still outstanding: ${(payload.outstanding as string[]).join(", ")}.`
        : "";
      return {
        ok: false,
        error: `${(payload.error as string) ?? `Request failed (${response.status}).`}${outstanding}`,
      };
    }

    return { ok: true, data: payload as T };
  } catch {
    return { ok: false, error: "Could not reach the server. Try again." };
  }
}
