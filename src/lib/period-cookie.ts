import "server-only";
import { cookies } from "next/headers";
import { PERIOD_COOKIE, withPeriod } from "./core/period-memory";

type SP = Record<string, string | string[] | undefined>;

/** searchParams da tela + período lembrado (cookie) quando a URL não escolheu período. */
export async function withSavedPeriod(sp: SP): Promise<SP> {
  return withPeriod(sp, (await cookies()).get(PERIOD_COOKIE)?.value);
}
