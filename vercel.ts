import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  fluid: true,
  functions: {
    "src/app/api/inngest/route.ts": {
      maxDuration: 300,
      maxConcurrency: 10,
      supportsCancellation: true,
    },
    "src/app/api/v1/gates/**": {
      maxDuration: 30,
      maxConcurrency: 50,
    },
  },
};
