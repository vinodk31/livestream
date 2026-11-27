import "server-only";
import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended argon2id parameters (19 MiB, t=2, p=1).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch (err) {
    // A wrong password returns false; a throw means the stored hash is malformed (e.g. a row
    // inserted by hand) or the native module failed to load. Log it so it shows in Vercel logs.
    console.error("[password] verify failed", {
      hashPrefix: passwordHash.slice(0, 10),
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/** Run a verify against a throwaway hash so unknown emails take as long as wrong passwords. */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hash("timing-equalizer-password", OPTIONS);
  await verifyPassword(await dummyHash, password);
}
