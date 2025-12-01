import { readFile } from "node:fs/promises";
import { Logger } from "tslog";
import { ApicurioClient, type CompatibilityLevel } from "../src/apicurioClient";
import { loadEnv } from "../src/config/env";

type Args = {
  file: string;
  artifactId: string;
  compatibility?: CompatibilityLevel;
  dryRun?: boolean;
};

function parseArgs(): Args {
  const kv: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const [rawKey, value] = arg.split("=");
    const key = rawKey?.replace(/^--?/, "");
    if (!key) continue;
    if (value) kv[key] = value;
    else if (key === "dry-run") kv["dry-run"] = "true";
  }

  if (!kv.file) throw new Error("Missing --file");
  if (!kv.artifactId) throw new Error("Missing --artifactId");

  return {
    file: kv.file,
    artifactId: kv.artifactId,
    compatibility: (kv.compatibility as CompatibilityLevel) ?? "FORWARD",
    dryRun: kv["dry-run"] === "true",
  };
}

async function main() {
  const logger = new Logger({ name: "register-schema" });
  const args = parseArgs();
  const env = loadEnv();
  const client = new ApicurioClient({
    baseUrl: env.apicurioUrl,
    groupId: env.apicurioGroup,
    token: env.apicurioToken,
    username: env.apicurioUsername,
    password: env.apicurioPassword,
  });

  const content = await readFile(args.file, "utf-8");

  if (args.dryRun) {
    await client.testCompatibility(args.artifactId, content);
    logger.info(`Compatibility check passed for ${args.artifactId}`);
    return;
  }

  const globalId = await client.registerOrUpdateArtifact(args.artifactId, content);
  await client.ensureCompatibility(args.artifactId, args.compatibility);
  logger.info(`Registered ${args.artifactId} with globalId=${globalId} (compatibility=${args.compatibility})`);
}

main().catch((err) => {
  const logger = new Logger({ name: "register-schema" });
  logger.error(err);
  process.exit(1);
});
