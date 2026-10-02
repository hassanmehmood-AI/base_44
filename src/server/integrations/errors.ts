/** Thrown by an integration wrapper (Zadarma, email, Meta, ...) when the
 * required env vars for that provider aren't set yet. Callers should catch
 * this and surface a clear "not configured" message instead of a raw crash —
 * these integrations are scaffolded ahead of the product owner adding real
 * credentials (see guide §16). */
export class ProviderNotConfiguredError extends Error {
  constructor(provider: string, missingEnvVars: string[]) {
    super(`${provider} is not configured. Missing env vars: ${missingEnvVars.join(", ")}`);
    this.name = "ProviderNotConfiguredError";
  }
}
