// T4: Dispatch agents feed (read-only). Stub until T4 lands.
/** @param {{ projectDir: string, dispatch: string | null, hub: { broadcast(event: string, data: unknown): void }, modules: object }} ctx */
export async function setup(ctx) {
  return { routes: [], close() {} };
}
