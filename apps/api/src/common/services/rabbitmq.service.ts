import { Injectable, OnModuleDestroy } from '@nestjs/common';
import amqplib from 'amqplib';
import type { ChannelModel, Channel } from 'amqplib';

@Injectable()
export class RabbitMQService implements OnModuleDestroy {
  private channelModel: ChannelModel | null = null;
  private channel: Channel | null = null;

  async connect(): Promise<void> {
    if (this.channel) return;
    const url = process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672';
    this.channelModel = await amqplib.connect(url);
    this.channel = await this.channelModel.createChannel();
  }

  async publish(queue: string, message: object): Promise<void> {
    if (!this.channel) await this.connect();
    const content = Buffer.from(JSON.stringify(message));
    this.channel!.sendToQueue(queue, content, { persistent: true });
  }

  async consume(queue: string, handler: (message: object) => Promise<void>): Promise<void> {
    if (!this.channel) await this.connect();
    await this.channel!.assertQueue(queue, { durable: true });
    this.channel!.consume(queue, async (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString()) as object;
          await handler(content);
          this.channel!.ack(msg);
        } catch {
          this.channel!.nack(msg, false, true);
        }
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.channel) await this.channel.close();
    if (this.channelModel) await this.channelModel.close();
  }
}
