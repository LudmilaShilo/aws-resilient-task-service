import type { SQSEvent } from 'aws-lambda';
import { handler } from '../task-processor.handler';
import {
  TasksRepository,
  ConditionalCheckFailedException,
  logger,
  TaskEvent,
  TaskStatus,
} from '../../shared';

jest.mock('../../shared/db/tasks.repository');
jest.mock('../../shared/logger/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock('../execute-task-work');

import { executeTaskWork } from '../execute-task-work';

const TASK_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const MESSAGE_ID = 'msg-111';

const makeRecord = (
  taskId = TASK_ID,
  status = TaskStatus.PENDING,
  retryCount = 0,
  messageId = MESSAGE_ID,
) => ({
  messageId,
  body: JSON.stringify({
    dynamodb: {
      NewImage: {
        taskId: { S: taskId },
        status: { S: status },
        retryCount: { N: String(retryCount) },
      },
    },
  }),
});

const makeEvent = (records: ReturnType<typeof makeRecord>[]): SQSEvent => ({
  Records: records as SQSEvent['Records'],
});

describe('task-processor handler', () => {
  let lockForProcessingMock: jest.SpyInstance;
  let completeTaskMock: jest.SpyInstance;
  let retryTaskMock: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // repository is module-level singleton — spy on prototype so mocks apply to the existing instance
    lockForProcessingMock = jest
      .spyOn(TasksRepository.prototype, 'lockForProcessing')
      .mockResolvedValue(undefined);
    completeTaskMock = jest
      .spyOn(TasksRepository.prototype, 'completeTask')
      .mockResolvedValue(undefined);
    retryTaskMock = jest
      .spyOn(TasksRepository.prototype, 'retryTask')
      .mockResolvedValue(undefined);

    (executeTaskWork as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('successful processing', () => {
    it('returns empty batchItemFailures on success', async () => {
      const result = await handler(makeEvent([makeRecord()]));

      expect(result).toEqual({ batchItemFailures: [] });
    });

    it('calls lockForProcessing with taskId', async () => {
      await handler(makeEvent([makeRecord()]));

      expect(lockForProcessingMock).toHaveBeenCalledWith(TASK_ID);
    });

    it('calls completeTask after successful executeTaskWork', async () => {
      await handler(makeEvent([makeRecord()]));

      expect(completeTaskMock).toHaveBeenCalledWith(TASK_ID);
    });

    it('logs TASK_GET_FROM_SQS (debug), TASK_EXECUTION_STARTED (info) and TASK_COMPLETED (info)', async () => {
      await handler(makeEvent([makeRecord(TASK_ID, TaskStatus.PENDING, 0)]));

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: TASK_ID,
          event: TaskEvent.TASK_GET_FROM_SQS,
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: TASK_ID,
          event: TaskEvent.TASK_EXECUTION_STARTED,
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: TASK_ID,
          event: TaskEvent.TASK_COMPLETED,
        }),
      );
    });
  });

  describe('lockForProcessing failures', () => {
    it('logs TASK_ALREADY_HANDLED and skips record on ConditionalCheckFailedException', async () => {
      lockForProcessingMock.mockRejectedValue(
        new ConditionalCheckFailedException({
          message: 'conflict',
          $metadata: {},
        }),
      );

      const result = await handler(makeEvent([makeRecord()]));

      expect(result).toEqual({ batchItemFailures: [] });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: TASK_ID,
          event: TaskEvent.TASK_ALREADY_HANDLED,
        }),
      );
      expect(executeTaskWork).not.toHaveBeenCalled();
    });

    it('logs TASK_EXECUTION_FAILED and adds to batchItemFailures on unexpected lockForProcessing error', async () => {
      lockForProcessingMock.mockRejectedValue(
        new Error('DynamoDB unavailable'),
      );

      const result = await handler(makeEvent([makeRecord()]));

      expect(result).toEqual({
        batchItemFailures: [{ itemIdentifier: MESSAGE_ID }],
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: TASK_ID,
          event: TaskEvent.TASK_EXECUTION_FAILED,
          reason: 'DynamoDB unavailable',
        }),
      );
      expect(executeTaskWork).not.toHaveBeenCalled();
    });
  });

  describe('executeTaskWork failures', () => {
    it('logs TASK_EXECUTION_FAILED and calls retryTask on executeTaskWork failure', async () => {
      (executeTaskWork as jest.Mock).mockRejectedValue(
        new Error('Simulated random failure'),
      );

      await handler(makeEvent([makeRecord(TASK_ID, TaskStatus.PROCESSING, 1)]));

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: TASK_ID,
          event: TaskEvent.TASK_EXECUTION_FAILED,
          reason: 'Simulated random failure',
          retryCount: 1,
        }),
      );
      expect(retryTaskMock).toHaveBeenCalledWith(
        TASK_ID,
        1,
        'Simulated random failure',
      );
    });

    it('adds to batchItemFailures after executeTaskWork failure', async () => {
      (executeTaskWork as jest.Mock).mockRejectedValue(
        new Error('Simulated random failure'),
      );

      const result = await handler(makeEvent([makeRecord()]));

      expect(result).toEqual({
        batchItemFailures: [{ itemIdentifier: MESSAGE_ID }],
      });
    });

    it('logs TASK_STATUS_UPDATE_FAILED and does not add to batchItemFailures when retryTask also fails', async () => {
      (executeTaskWork as jest.Mock).mockRejectedValue(
        new Error('Simulated random failure'),
      );
      retryTaskMock.mockRejectedValue(new Error('DynamoDB unavailable'));

      const result = await handler(makeEvent([makeRecord()]));

      expect(result).toEqual({ batchItemFailures: [] });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: TASK_ID,
          event: TaskEvent.TASK_STATUS_UPDATE_FAILED,
          reason: 'DynamoDB unavailable',
        }),
      );
    });
  });

  describe('completeTask failures', () => {
    it('logs TASK_STATUS_UPDATE_FAILED and does not add to batchItemFailures when completeTask fails', async () => {
      completeTaskMock.mockRejectedValue(new Error('DynamoDB unavailable'));

      const result = await handler(makeEvent([makeRecord()]));

      expect(result).toEqual({ batchItemFailures: [] });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: TASK_ID,
          event: TaskEvent.TASK_STATUS_UPDATE_FAILED,
          reason: 'DynamoDB unavailable',
        }),
      );
    });

    it('does not call retryTask when completeTask fails', async () => {
      completeTaskMock.mockRejectedValue(new Error('DynamoDB unavailable'));

      await handler(makeEvent([makeRecord()]));

      expect(retryTaskMock).not.toHaveBeenCalled();
    });
  });

  describe('invalid record body', () => {
    it('adds to batchItemFailures when record body is invalid JSON', async () => {
      const badRecord = { messageId: MESSAGE_ID, body: 'not-json' };
      const result = await handler(
        makeEvent([badRecord as SQSEvent['Records'][0]]),
      );

      expect(result).toEqual({
        batchItemFailures: [{ itemIdentifier: MESSAGE_ID }],
      });
    });
  });

  describe('batch processing', () => {
    it('processes all records independently and returns only failed messageIds', async () => {
      (executeTaskWork as jest.Mock)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('failure'))
        .mockResolvedValueOnce(undefined);

      const result = await handler(
        makeEvent([
          makeRecord(TASK_ID, TaskStatus.PENDING, 0, 'msg-1'),
          makeRecord(TASK_ID, TaskStatus.PENDING, 0, 'msg-2'),
          makeRecord(TASK_ID, TaskStatus.PENDING, 0, 'msg-3'),
        ]),
      );

      expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-2' }]);
    });
  });
});
