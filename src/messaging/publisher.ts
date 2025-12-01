import type { Channel } from "amqplib";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { Logger } from "tslog";
import { ApicurioClient } from "../apicurioClient";
import { type PublishOptions, type PublishResult, toBuffer } from "./rabbit";

export type PublisherOptions = {
  validate?: boolean;
  groupId?: string;
  name?: string;
};

export class Publisher {
  private readonly idCache = new Map<string, number>();
  private readonly validatorCache = new Map<number, ValidateFunction>();
  private readonly ajv: Ajv;
  private readonly name: string;
  private readonly logger: Logger<{ name: string }>;

  constructor(
    private readonly channel: Channel,
    private readonly registry: ApicurioClient,
    private readonly opts: PublisherOptions = {},
  ) {
    this.name = opts.name ?? "publisher";
    this.logger = new Logger({ name: this.name });
    this.ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(this.ajv);
  }

  private async getGlobalId(artifactId: string): Promise<number> {
    const cached = this.idCache.get(artifactId);
    if (cached) return cached;
    const id = await this.registry.getGlobalId(artifactId);
    this.idCache.set(artifactId, id);
    return id;
  }

  private async getValidator(globalId: number) {
    const cached = this.validatorCache.get(globalId);
    if (cached) return cached;
    const schema = await this.registry.getSchemaByGlobalId(globalId);
    const validator = this.ajv.compile(schema);
    this.validatorCache.set(globalId, validator);
    return validator;
  }

  invalidate(artifactId?: string) {
    if (artifactId) {
      this.idCache.delete(artifactId);
      return;
    }
    this.idCache.clear();
  }

  async publish<T extends object>(
    artifactId: string,
    payload: T,
    options: PublishOptions,
  ): Promise<PublishResult> {
    this.logger.debug("Publishing", { artifactId, exchange: options.exchange });
    const globalId = await this.getGlobalId(artifactId);

    if (this.opts.validate !== false) {
      const validator = await this.getValidator(globalId);
      const ok = validator(payload);
      if (!ok) {
        throw new Error(`Payload validation failed: ${this.ajv.errorsText(validator.errors)}`);
      }
    }

    const headers = { ...(options.headers ?? {}), "x-schema-id": globalId };
    const published = this.channel.publish(options.exchange, "", toBuffer(payload), {
      contentType: "application/json",
      persistent: true,
      headers,
    });

    return { ok: published, globalId };
  }
}
