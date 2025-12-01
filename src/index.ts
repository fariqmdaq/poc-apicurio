import { Logger } from "tslog";
import { loadEnv } from "./config/env";
import { Subscriber } from "./messaging/subscriber";
import { Publisher } from "./messaging/publisher";
import { connectRabbit, setupTopology } from "./messaging/rabbit";
import { ApicurioClient } from "./apicurioClient";

const arg = process.argv.find((a) => a.startsWith("role="));
const role = arg ? arg.split("=")[1] : process.env.ROLE;
const logger = new Logger();

const artifactId = process.env.ARTIFACT_ID ?? "user-created";
const publisherName = "publisher";
const subscriberName = "subscriber";
const publisherPort = Number(process.env.PUBLISHER_PORT ?? "3000");

async function main() {
  if (role === "publisher") {
    await runPublisher();
    return;
  }

  if (role === "subscriber") {
    await runSubscriber();
    return;
  }

  logger.info('Specify role via "bun run index.ts -- role=publisher" or role=subscriber');
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});

export async function runPublisher() {
  const logger = new Logger({ name: publisherName });
  const env = loadEnv();
  const registry = new ApicurioClient({
    baseUrl: env.apicurioUrl,
    groupId: env.apicurioGroup,
    token: env.apicurioToken,
    username: env.apicurioUsername,
    password: env.apicurioPassword,
  });

  const { channel, connection } = await connectRabbit(env.rabbitUrl);
  await setupTopology(channel, {
    exchange: env.exchange,
    queue: env.queue,
    deadLetterExchange: env.dlx,
  });

  const publisher = new Publisher(channel, registry, { validate: true, name: publisherName });

  const server = Bun.serve({
    port: publisherPort,
    hostname: "0.0.0.0",
    routes: {
      "/publish/:version": {
        POST: async (req) => {
          const version = req.params.version;
          const payload =
            version === "v2"
              ? {
                id: crypto.randomUUID(),
                name: "Demo User",
                email: "demo@example.com",
              }
              : {
                id: crypto.randomUUID(),
                name: "Demo User",
              };

          try {
            logger.info(`Publishing ${version}`, payload);
            const result = await publisher.publish(artifactId, payload, {
              exchange: env.exchange,
            });
            logger.info(`Published ${version} message`, { globalId: result.globalId });
            return new Response(JSON.stringify({ ok: true, version, globalId: result.globalId }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          } catch (err) {
            logger.error(`Publish failed: ${(err as Error).message}`);
            return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

        },
      }
    },
  });


  logger.info(`Publisher HTTP server listening on :${publisherPort}`);

  const shutdown = async () => {
    server.stop();
    try {
      await connection.close();
    } catch (err) {
      logger.warn("Connection close ignored", { error: (err as Error).message });
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function runSubscriber() {
  const logger = new Logger({ name: subscriberName });
  const env = loadEnv();
  const registry = new ApicurioClient({
    baseUrl: env.apicurioUrl,
    groupId: env.apicurioGroup,
    token: env.apicurioToken,
    username: env.apicurioUsername,
    password: env.apicurioPassword,
  });

  const { channel, connection } = await connectRabbit(env.rabbitUrl);
  await setupTopology(channel, {
    exchange: env.exchange,
    queue: env.queue,
    deadLetterExchange: env.dlx,
  });

  const subscriber = new Subscriber(channel, registry, {
    queue: env.queue,
    prefetch: 10,
    validate: true,
    name: subscriberName,
  });

  await subscriber.start(async (payload, rawMessage) => {
    logger.info("Received payload", payload);
    logger.info("Message headers", rawMessage.properties?.headers);
    logger.info("Message fields", rawMessage.fields);
  });

  const shutdown = async () => {
    await subscriber.stop();
    try {
      await connection.close();
    } catch (err) {
      logger.warn("Connection close ignored", { error: (err as Error).message });
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
