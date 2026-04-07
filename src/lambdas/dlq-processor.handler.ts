import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { TasksRepository, logger, TaskEvent } from '../shared';

const repository = new TasksRepository();

// Shape of the DynamoDB Stream record body forwarded through TaskQueue → TaskDLQ
interface DynamoStreamBody {
  dynamodb: {
    NewImage: {
      taskId: { S: string };
    };
  };
}

const processRecord = async (record: SQSRecord): Promise<void> => {
  const body = JSON.parse(record.body) as DynamoStreamBody;
  const taskId = body.dynamodb.NewImage.taskId.S;
  const dlqAttempt = Number(record.attributes.ApproximateReceiveCount);

  try {
    await repository.failTask(taskId);
    logger.info({ taskId, event: TaskEvent.TASK_SET_FAILED_STATUS });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({
      taskId,
      event: TaskEvent.TASK_IN_DLQ_FAILED,
      dlqAttempt,
      reason: error.message,
      stack: error.stack,
    });
    throw err; // after 3 attempts message moves to EmergencyDLQ
  }
};

export const handler = async (event: SQSEvent): Promise<void> => {
  // batchSize: 1 — always a single record, but we iterate for consistency
  for (const record of event.Records) {
    await processRecord(record);
  }
};
