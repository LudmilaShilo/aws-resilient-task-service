import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TasksService } from '../tasks.service';
import {
  TasksRepository,
  ConditionalCheckFailedException,
  logger,
  TaskEvent,
  Task,
  TaskStatus,
} from '../../shared';
import { CreateTaskDto } from '../dto/create-task.dto';

jest.mock('../../shared/db/tasks.repository');
jest.mock('../../shared/logger/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const VALID_UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const USER_ID = 'user-sub-123';

const makeDto = (overrides: Partial<CreateTaskDto> = {}): CreateTaskDto => ({
  taskId: VALID_UUID,
  payload: { key: 'value' },
  ...overrides,
});

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  taskId: VALID_UUID,
  userId: USER_ID,
  status: TaskStatus.PENDING,
  retryCount: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  errorMessage: [],
  payload: { key: 'value' },
  ...overrides,
});

describe('TasksService', () => {
  let service: TasksService;
  let createTaskMock: jest.Mock;
  let getTaskMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    createTaskMock = jest.fn().mockResolvedValue(undefined);
    getTaskMock = jest.fn().mockResolvedValue(makeTask());
    (TasksRepository as jest.Mock).mockImplementation(() => ({
      createTask: createTaskMock,
      getTask: getTaskMock,
    }));
    service = new TasksService();
  });

  describe('createTask', () => {
    it('logs TASK_RECEIVED and TASK_SAVED on success', async () => {
      await service.createTask(makeDto(), USER_ID);

      expect(logger.info).toHaveBeenCalledWith({
        taskId: VALID_UUID,
        event: TaskEvent.TASK_RECEIVED,
      });
      expect(logger.debug).toHaveBeenCalledWith({
        taskId: VALID_UUID,
        event: TaskEvent.TASK_SAVED,
      });
    });

    it('calls repository with correct arguments', async () => {
      const dto = makeDto();
      await service.createTask(dto, USER_ID);

      expect(createTaskMock).toHaveBeenCalledWith(
        dto.taskId,
        USER_ID,
        dto.payload,
      );
    });

    it('returns { taskId } on success', async () => {
      const result = await service.createTask(makeDto(), USER_ID);
      expect(result).toEqual({ taskId: VALID_UUID });
    });

    it('returns { taskId, duplicate: true } on ConditionalCheckFailedException', async () => {
      createTaskMock.mockRejectedValue(
        new ConditionalCheckFailedException({
          message: 'duplicate',
          $metadata: {},
        }),
      );

      const result = await service.createTask(makeDto(), USER_ID);

      expect(result).toEqual({ taskId: VALID_UUID, duplicate: true });
    });

    it('logs TASK_DUPLICATED on ConditionalCheckFailedException', async () => {
      createTaskMock.mockRejectedValue(
        new ConditionalCheckFailedException({
          message: 'duplicate',
          $metadata: {},
        }),
      );

      await service.createTask(makeDto(), USER_ID);

      expect(logger.error).toHaveBeenCalledWith({
        taskId: VALID_UUID,
        event: TaskEvent.TASK_DUPLICATED,
      });
    });

    it('rethrows unexpected errors', async () => {
      const error = new Error('DynamoDB unavailable');
      createTaskMock.mockRejectedValue(error);

      await expect(service.createTask(makeDto(), USER_ID)).rejects.toThrow(
        'DynamoDB unavailable',
      );
    });
  });

  describe('getTaskStatus', () => {
    it('calls repository with taskId', async () => {
      await service.getTaskStatus(VALID_UUID, USER_ID);

      expect(getTaskMock).toHaveBeenCalledWith(VALID_UUID);
    });

    it('logs TASK_NOT_FOUND and throws NotFoundException when task does not exist', async () => {
      getTaskMock.mockResolvedValue(null);

      await expect(service.getTaskStatus(VALID_UUID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(logger.warn).toHaveBeenCalledWith({
        taskId: VALID_UUID,
        event: TaskEvent.TASK_NOT_FOUND,
      });
    });

    it('logs TASK_MALICIOUS_ASK with userIdIndex and throws ForbiddenException when userId mismatches', async () => {
      getTaskMock.mockResolvedValue(makeTask({ userId: 'other-user' }));

      await expect(service.getTaskStatus(VALID_UUID, USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(logger.warn).toHaveBeenCalledWith({
        taskId: VALID_UUID,
        event: TaskEvent.TASK_MALICIOUS_ASK,
        userIdIndex: expect.any(String),
      });
    });

    it('returns task status fields on success', async () => {
      const task = makeTask({ status: TaskStatus.PROCESSING, retryCount: 1 });
      getTaskMock.mockResolvedValue(task);

      const result = await service.getTaskStatus(VALID_UUID, USER_ID);

      expect(result).toEqual({
        taskId: task.taskId,
        status: task.status,
      });
    });

    it('does not expose userId, payload or internal fields in the response', async () => {
      const result = await service.getTaskStatus(VALID_UUID, USER_ID);

      expect(result).not.toHaveProperty('userId');
      expect(result).not.toHaveProperty('payload');
      expect(result).not.toHaveProperty('retryCount');
      expect(result).not.toHaveProperty('createdAt');
      expect(result).not.toHaveProperty('updatedAt');
    });
  });
});
