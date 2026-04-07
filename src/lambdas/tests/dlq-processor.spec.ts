import type { SQSEvent } from 'aws-lambda';
import { handler } from '../dlq-processor.handler';
import { TasksRepository, logger, TaskEvent } from '../../shared';

jest.mock('../../shared/db/tasks.repository');
jest.mock('../../shared/logger/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const TASK_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

const makeRecord = (taskId = TASK_ID, dlqAttempt = 1) => ({
  messageId: 'msg-111',
  body: JSON.stringify({
    dynamodb: {
      NewImage: {
        taskId: { S: taskId },
      },
    },
  }),
  attributes: {
    ApproximateReceiveCount: String(dlqAttempt),
  },
});

const makeEvent = (records: ReturnType<typeof makeRecord>[]): SQSEvent => ({
  Records: records as SQSEvent['Records'],
});

describe('dlq-processor handler', () => {
  let failTaskMock: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    failTaskMock = jest
      .spyOn(TasksRepository.prototype, 'failTask')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('successful processing', () => {
    it('calls failTask with taskId', async () => {
      await handler(makeEvent([makeRecord()]));

      expect(failTaskMock).toHaveBeenCalledWith(TASK_ID);
    });

    it('logs TASK_SET_FAILED_STATUS on success', async () => {
      await handler(makeEvent([makeRecord()]));

      expect(logger.info).toHaveBeenCalledWith({
        taskId: TASK_ID,
        event: TaskEvent.TASK_SET_FAILED_STATUS,
      });
    });
  });

  describe('failTask failures', () => {
    it('logs TASK_IN_DLQ_FAILED with dlqAttempt, reason and stack', async () => {
      failTaskMock.mockRejectedValue(new Error('DynamoDB unavailable'));

      await expect(
        handler(makeEvent([makeRecord(TASK_ID, 2)])),
      ).rejects.toThrow('DynamoDB unavailable');

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: TASK_ID,
          event: TaskEvent.TASK_IN_DLQ_FAILED,
          dlqAttempt: 2,
          reason: 'DynamoDB unavailable',
        }),
      );
    });

    it('rethrows error so SQS retries the message', async () => {
      failTaskMock.mockRejectedValue(new Error('DynamoDB unavailable'));

      await expect(handler(makeEvent([makeRecord()]))).rejects.toThrow(
        'DynamoDB unavailable',
      );
    });

    it('does not log TASK_SET_FAILED_STATUS on failure', async () => {
      failTaskMock.mockRejectedValue(new Error('DynamoDB unavailable'));

      await expect(handler(makeEvent([makeRecord()]))).rejects.toThrow();

      expect(logger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: TaskEvent.TASK_SET_FAILED_STATUS }),
      );
    });
  });

  describe('invalid record body', () => {
    it('throws when record body is invalid JSON', async () => {
      const badRecord = {
        messageId: 'msg-111',
        body: 'not-json',
        attributes: { ApproximateReceiveCount: '1' },
      };

      await expect(
        handler(makeEvent([badRecord as SQSEvent['Records'][0]])),
      ).rejects.toThrow();
    });
  });
});
