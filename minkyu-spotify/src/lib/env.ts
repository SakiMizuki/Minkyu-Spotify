export function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getOptionalEnv(name: string, fallback?: string): string | undefined {
  const value = process.env[name];

  if (value) {
    return value;
  }

  return fallback;
}

export const isProduction = process.env.NODE_ENV === "production";
