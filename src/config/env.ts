export type AppEnv = {
  apicurioUrl: string;
  apicurioGroup: string;
  apicurioToken?: string;
  apicurioUsername?: string;
  apicurioPassword?: string;
  rabbitUrl: string;
  exchange: string;
  queue: string;
  dlx?: string;
};

export function loadEnv(): AppEnv {
  const missing: string[] = [];
  const env = (key: string) => process.env[key];

  const config: AppEnv = {
    apicurioUrl: env("APICURIO_URL") ?? "",
    apicurioGroup: env("APICURIO_GROUP") ?? "default",
    apicurioToken: env("APICURIO_TOKEN"),
    apicurioUsername: env("APICURIO_USERNAME"),
    apicurioPassword: env("APICURIO_PASSWORD"),
    rabbitUrl: env("RABBITMQ_URL") ?? "",
    exchange: env("RABBITMQ_EXCHANGE") ?? "event-exchange",
    queue: env("RABBITMQ_QUEUE") ?? "event-queue",
    dlx: env("RABBITMQ_DLX") ?? undefined,
  };

  if (!config.apicurioUrl) missing.push("APICURIO_URL");
  if (!config.rabbitUrl) missing.push("RABBITMQ_URL");

  if (missing.length) {
    const details = missing.join(", ");
    throw new Error(`Missing required environment variables: ${details}`);
  }

  return config;
}
