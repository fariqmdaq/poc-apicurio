import type { Channel, ConsumeMessage } from "amqplib";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { Logger } from "tslog";
import { ApicurioClient } from "../apicurioClient";
import { contentFromMessage } from "./rabbit";

export type SubscriberOptions = {
  queue: string;
  prefetch?: number;
  validate?: boolean;
  name?: string;
};

export type ConsumeHandler<T = unknown> = (payload: T, raw: ConsumeMessage) => Promise<void> | void;

export class Subscriber {
  private readonly schemaCache = new Map<number, object>();
  private readonly validatorCache = new Map<number, ValidateFunction>();
  private readonly ajv: Ajv;
  private consumerTag?: string;
  private readonly logger: Logger<{ name: string }>;
  private readonly name: string;

  constructor(
    private readonly channel: Channel,
    private readonly registry: ApicurioClient,
    private readonly opts: SubscriberOptions,
  ) {
    this.name = opts.name ?? "subscriber";
    this.logger = new Logger({ name: this.name });
    this.ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(this.ajv);
  }

  private async getValidator(globalId: number) {
    const cached = this.validatorCache.get(globalId);
    if (cached) return cached;
    const schema = this.schemaCache.get(globalId) ?? (await this.registry.getSchemaByGlobalId(globalId));
    this.schemaCache.set(globalId, schema);
    const validator = this.ajv.compile(schema);
    this.validatorCache.set(globalId, validator);
    return validator;
  }

  private async discard(msg: ConsumeMessage) {
    this.channel.nack(msg, false, false);
  }

  async start<T = unknown>(handler: ConsumeHandler<T>): Promise<void> {
    if (this.opts.prefetch) await this.channel.prefetch(this.opts.prefetch);

    const { consumerTag } = await this.channel.consume(
      this.opts.queue,
      async (msg) => {
        if (!msg) return;
        const globalId = msg.properties.headers?.["x-schema-id"] as number | undefined;
        if (!globalId) {
          this.logger.warn("Message missing x-schema-id header; discarding");
          await this.discard(msg);
          return;
        }

        try {
          const payload = contentFromMessage(msg) as T;

          if (this.opts.validate !== false) {
            const validator = await this.getValidator(globalId);
            const ok = validator(payload);
            if (!ok) {
              this.logger.warn(`Schema validation failed; discarding: ${this.ajv.errorsText(validator.errors)}`);
              await this.discard(msg);
              return;
            }
          }

          await handler(payload, msg);
          this.channel.ack(msg);
        } catch (err) {
          this.logger.error(`Consumer error; discarding: ${(err as Error).message}`);
          await this.discard(msg);
        }
      },
      { noAck: false },
    );

    this.consumerTag = consumerTag;
  }

  async stop(): Promise<void> {
    if (this.consumerTag) {
      await this.channel.cancel(this.consumerTag);
      this.consumerTag = undefined;
    }
  }
}
