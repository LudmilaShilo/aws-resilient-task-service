import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import {
  TasksRepository,
  ConditionalCheckFailedException,
  logger,
  TaskEvent,
  TaskStatus,
} from '../shared';
import { executeTaskWork } from './execute-task-work';

const repository = new TasksRepository();
const PROCESSING_TIME_MS = parseInt(
  process.env.PROCESSING_TIME_MS ?? '3000',
  10,
);

// Shape of the DynamoDB Stream record body forwarded by EventBridge Pipe
interface DynamoStreamBody {
  dynamodb: {
    NewImage: {
      taskId: { S: string };
      status: { S: string };
      retryCount: { N: string };
    };
  };
}

const processRecord = async (
  taskId: string,
  status: TaskStatus,
  retryCount: number,
): Promise<void> => {
  try {
    await repository.lockForProcessing(taskId);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      logger.warn({
        taskId,
        event: TaskEvent.TASK_ALREADY_HANDLED,
        status,
        retryCount,
      });
      return; // Not an error — message will be deleted from the queue
    }
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({
      taskId,
      event: TaskEvent.TASK_EXECUTION_FAILED,
      retryCount,
      reason: error.message,
      stack: error.stack,
    });
    throw err;
  }

  logger.info({
    taskId,
    event: TaskEvent.TASK_EXECUTION_STARTED,
    status,
    retryCount,
  });

  try {
    await executeTaskWork(PROCESSING_TIME_MS);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    logger.error({
      taskId,
      event: TaskEvent.TASK_EXECUTION_FAILED,
      retryCount,
      reason: error.message,
      stack: error.stack,
    });

    try {
      await repository.retryTask(taskId, retryCount, error.message);
    } catch (retryErr) {
      const retryError =
        retryErr instanceof Error ? retryErr : new Error(String(retryErr));
      logger.error({
        taskId,
        event: TaskEvent.TASK_STATUS_UPDATE_FAILED,
        retryCount,
        reason: retryError.message,
        stack: retryError.stack,
      });
      // Not rethrowing — status is still PROCESSING, SQS retry would only
      // produce TASK_ALREADY_HANDLED; covered by Known Limitations
      return;
    }

    throw err; // SQS returns the message to the queue for retry
  }

  try {
    await repository.completeTask(taskId);
    logger.info({ taskId, event: TaskEvent.TASK_COMPLETED, retryCount });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({
      taskId,
      event: TaskEvent.TASK_STATUS_UPDATE_FAILED,
      retryCount,
      reason: error.message,
      stack: error.stack,
    });
    // Not rethrowing — task work succeeded; status stuck in PROCESSING
    // (covered by Known Limitations: watchdog scheduler out of scope)
  }
};

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  await Promise.all(
    event.Records.map(async (record) => {
      try {
        const body = JSON.parse(record.body) as DynamoStreamBody;
        const taskId = body.dynamodb.NewImage.taskId.S;
        const status = body.dynamodb.NewImage.status.S as TaskStatus;
        const retryCount = parseInt(body.dynamodb.NewImage.retryCount.N, 10);

        logger.debug({
          taskId,
          event: TaskEvent.TASK_GET_FROM_SQS,
          status,
          retryCount,
        });

        await processRecord(taskId, status, retryCount);
      } catch {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }),
  );

  return { batchItemFailures };
};
