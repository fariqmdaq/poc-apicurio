import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compile,
  type Options as JsttOptions,
} from "json-schema-to-typescript";
import { Logger } from "tslog";
import { ApicurioClient } from "../src/apicurioClient";
import { loadEnv } from "../src/config/env";

type Artifact = { id: string; globalId?: number };

const defaultArtifacts = ["user-created"];

async function fetchSchemas(client: ApicurioClient, artifacts: Artifact[]) {
  const schemas: Record<
    string,
    { schema: Record<string, unknown>; globalId: number }
  > = {};
  for (const artifact of artifacts) {
    const globalId =
      artifact.globalId ?? (await client.getGlobalId(artifact.id));
    const schema = await client.getSchemaByGlobalId(globalId);
    schemas[artifact.id] = { schema, globalId };
  }
  return schemas;
}

async function main() {
  const logger = new Logger({ name: "generate-types" });
  const env = loadEnv();
  const client = new ApicurioClient({
    baseUrl: env.apicurioUrl,
    groupId: env.apicurioGroup,
    token: env.apicurioToken,
    username: env.apicurioUsername,
    password: env.apicurioPassword,
  });

  const artifacts = defaultArtifacts.map((id) => ({ id }));
  const schemas = await fetchSchemas(client, artifacts);

  const outDir = join(process.cwd(), "types", "generated");
  await mkdir(outDir, { recursive: true });

  const options: Partial<JsttOptions> = {
    bannerComment:
      "/** Generated from Apicurio schemas. Do not edit by hand. */",
    additionalProperties: false,
    style: { singleQuote: true },
  };

  for (const [artifactId, { schema, globalId }] of Object.entries(schemas)) {
    const ts = await compile(schema as any, artifactId, options);
    const filePath = join(outDir, `${artifactId}.d.ts`);
    await writeFile(filePath, ts, "utf-8");
    logger.info(`Generated ${filePath} (globalId=${globalId})`);
  }
}

main().catch((err) => {
  const logger = new Logger({ name: "generate-types" });
  logger.error(err);
  process.exit(1);
});
