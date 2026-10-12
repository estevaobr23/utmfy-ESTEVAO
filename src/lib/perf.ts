import "server-only";

type PerfContext = Record<string, string | number | boolean | null | undefined>;

const enabled = () => process.env.PERF_DIAGNOSTICS === "1" || process.env.NODE_ENV === "development";

/** Log estruturado e opt-in para localizar gargalos sem expor payloads ou credenciais. */
export async function timed<T>(operation: string, context: PerfContext, work: () => PromiseLike<T>): Promise<T> {
  if (!enabled()) return await work();
  const started = performance.now();
  try {
    const result = await work();
    console.info(JSON.stringify({ type: "performance", operation, durationMs: Math.round(performance.now() - started), status: "ok", ...context }));
    return result;
  } catch (error) {
    console.info(JSON.stringify({
      type: "performance",
      operation,
      durationMs: Math.round(performance.now() - started),
      status: "error",
      error: error instanceof Error ? error.name : "unknown",
      ...context,
    }));
    throw error;
  }
}
