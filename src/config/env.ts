export const envSchema = {
  type: "object",
  required: ["PORT", "CORS_ORIGIN", "WORKDIR"],
  properties: {
    PORT: { type: "number", default: 3001 },
    CORS_ORIGIN: { type: "string", default: "http://localhost:3000" },
    WORKDIR: { type: "string", default: "./.data" },
    DATABASE_URL: { type: "string", default: "" },
    REDIS_URL: { type: "string", default: "" },
    GITHUB_TOKEN: { type: "string", default: "" },
    ANALYSIS_MAX_COMMITS: { type: "number", default: 5000 },
    ANALYSIS_RECENT_DAYS: { type: "number", default: 90 },
    COMPLEXITY_SNAPSHOT_INTERVAL: { type: "number", default: 50 },
    COMPLEXITY_MAX_SNAPSHOTS: { type: "number", default: 20 },
    COMPLEXITY_MAX_FILES: { type: "number", default: 200 },
    COMPLEXITY_MAX_FILE_BYTES: { type: "number", default: 200000 },
    HOTSPOT_THRESHOLD: { type: "number", default: 0.6 },
    FRAGILITY_THRESHOLD: { type: "number", default: 0.6 },
    INSIGHTS_MAX_PER_CATEGORY: { type: "number", default: 5 },
    BUS_FACTOR_TOUCH_THRESHOLD: { type: "number", default: 10 },
    BUS_FACTOR_SHARE_THRESHOLD: { type: "number", default: 0.7 },
  },
} as const;

export type EnvConfig = {
  PORT: number;
  CORS_ORIGIN: string;
  WORKDIR: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  GITHUB_TOKEN: string;
  ANALYSIS_MAX_COMMITS: number;
  ANALYSIS_RECENT_DAYS: number;
  COMPLEXITY_SNAPSHOT_INTERVAL: number;
  COMPLEXITY_MAX_SNAPSHOTS: number;
  COMPLEXITY_MAX_FILES: number;
  COMPLEXITY_MAX_FILE_BYTES: number;
  HOTSPOT_THRESHOLD: number;
  FRAGILITY_THRESHOLD: number;
  INSIGHTS_MAX_PER_CATEGORY: number;
  BUS_FACTOR_TOUCH_THRESHOLD: number;
  BUS_FACTOR_SHARE_THRESHOLD: number;
};

export function parseCorsOrigins(value: string): string[] {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
