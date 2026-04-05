import { configure as serverlessExpress } from '@vendia/serverless-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { Handler } from 'aws-lambda';

let cachedHandler: Handler;

export const handler: Handler = async (event, context) => {
  if (!cachedHandler) {
    const app = await NestFactory.create(AppModule);
    await app.init();
    cachedHandler = serverlessExpress({
      app: app.getHttpAdapter().getInstance(),
    });
  }
  return cachedHandler(event, context, () => undefined);
};
