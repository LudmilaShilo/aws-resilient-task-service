import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConfiguredRetryStrategy } from '@aws-sdk/util-retry';

const MAX_ATTEMPTS = 3;

// Exponential Backoff: delay before each retry grows as 2^attempt * 100ms: 200ms → 400ms → 800ms
const retryStrategy = new ConfiguredRetryStrategy(
  MAX_ATTEMPTS,
  (attempt: number) => 2 ** attempt * 100,
);

const client = new DynamoDBClient({ retryStrategy });

export const docClient = DynamoDBDocumentClient.from(client);
