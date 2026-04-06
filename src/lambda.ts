import { configure as serverlessExpress } from '@vendia/serverless-express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { AppModule } from './app.module';
import { SQS_LIMITS } from './shared';
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';

// Narrower handler type: we know API Gateway always receives/returns these specific shapes
type ApiGatewayHandler = (
  event: APIGatewayProxyEvent,
  context: Context,
  callback: () => void,
) => Promise<APIGatewayProxyResult>;

let cachedHandler: ApiGatewayHandler;

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  if (!cachedHandler) {
    const app = await NestFactory.create(AppModule);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    // Reject requests with body exceeding SQS message size limit before they reach controllers
    app.use(express.json({ limit: SQS_LIMITS.MAX_PAYLOAD_BYTES }));
    await app.init();
    cachedHandler = serverlessExpress({
      app: app.getHttpAdapter().getInstance(),
    }) as ApiGatewayHandler;
  }
  return cachedHandler(event, context, () => undefined);
};
