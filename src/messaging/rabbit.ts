import amqp from "amqplib";
import type { Channel, Options, ChannelModel } from "amqplib";

export type RabbitTopology = {
  exchange: string;
  queue: string;
  deadLetterExchange?: string;
};

export type RabbitConnection = {
  channel: Channel;
  connection: ChannelModel;
};

export async function connectRabbit(url: string): Promise<RabbitConnection> {
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();
  return { channel, connection };
}

export async function setupTopology(
  channel: Channel,
  topology: RabbitTopology,
) {
  const { exchange, queue, deadLetterExchange } = topology;
  await channel.assertExchange(exchange, "topic", { durable: true });
  await channel.assertQueue(queue, { durable: true, deadLetterExchange });
  await channel.bindQueue(queue, exchange, "#");
}

export function toBuffer(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload));
}

export function contentFromMessage(msg: amqp.ConsumeMessage): unknown {
  const content = msg.content.toString("utf-8");
  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse JSON payload: ${(err as Error).message}`);
  }
}

export type PublishOptions = {
  exchange: string;
  headers?: Options.Publish["headers"];
};

export type PublishResult = {
  ok: boolean;
  globalId: number;
};
