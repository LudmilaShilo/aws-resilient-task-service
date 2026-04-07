import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { docClient } from './dynamo.client';
import { Task, TaskStatus } from '../types';

const TABLE = process.env.TASKS_TABLE!;

export class TasksRepository {
  // Creates a new task with default initial state.
  // Throws ConditionalCheckFailedException if taskId already exists.
  async createTask(
    taskId: string,
    userId: string,
    payload: Task['payload'],
  ): Promise<void> {
    const now = new Date().toISOString();
    const item: Task = {
      taskId,
      userId,
      payload,
      status: TaskStatus.PENDING,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
      errorMessage: [],
    };
    await docClient.send(
      new PutCommand({
        TableName: TABLE,
        Item: item,
        ConditionExpression: 'attribute_not_exists(taskId)',
      }),
    );
  }

  async getTask(taskId: string): Promise<Task | null> {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: { taskId },
      }),
    );
    return (result.Item as Task) ?? null;
  }

  // Atomically transitions status from PENDING|RETRYING → PROCESSING.
  // Throws ConditionalCheckFailedException (with ALL_OLD values) if status is already PROCESSING|COMPLETED|FAILED.
  async lockForProcessing(taskId: string): Promise<void> {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { taskId },
        ConditionExpression: '#s IN (:pending, :retrying)',
        UpdateExpression: 'SET #s = :processing, updatedAt = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':pending': TaskStatus.PENDING,
          ':retrying': TaskStatus.RETRYING,
          ':processing': TaskStatus.PROCESSING,
          ':now': new Date().toISOString(),
        },
      }),
    );
  }

  async completeTask(taskId: string): Promise<void> {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { taskId },
        UpdateExpression: 'SET #s = :completed, updatedAt = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':completed': TaskStatus.COMPLETED,
          ':now': new Date().toISOString(),
        },
      }),
    );
  }

  async retryTask(
    taskId: string,
    retryCount: number,
    errorMsg: string,
  ): Promise<void> {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { taskId },
        UpdateExpression:
          'SET #s = :retrying, retryCount = :count, updatedAt = :now, errorMessage = list_append(errorMessage, :err)',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':retrying': TaskStatus.RETRYING,
          ':count': retryCount + 1,
          ':now': new Date().toISOString(),
          ':err': [errorMsg],
        },
      }),
    );
  }

  async failTask(taskId: string): Promise<void> {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { taskId },
        UpdateExpression: 'SET #s = :failed, updatedAt = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':failed': TaskStatus.FAILED,
          ':now': new Date().toISOString(),
        },
      }),
    );
  }
}

export { ConditionalCheckFailedException };
