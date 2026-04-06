import { TasksService } from '../tasks.service';
import { TasksRepository, ConditionalCheckFailedException } from '../../shared';
import { logger } from '../../shared';
import { TaskEvent } from '../../shared';
import { CreateTaskDto } from '../dto/create-task.dto';

jest.mock('../../shared/db/tasks.repository');
jest.mock('../../shared/logger/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const VALID_UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const USER_ID = 'user-sub-123';

const makeDto = (overrides: Partial<CreateTaskDto> = {}): CreateTaskDto => ({
  taskId: VALID_UUID,
  payload: { key: 'value' },
  ...overrides,
});

describe('TasksService', () => {
  let service: TasksService;
  let createTaskMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    createTaskMock = jest.fn().mockResolvedValue(undefined);
    (TasksRepository as jest.Mock).mockImplementation(() => ({
      createTask: createTaskMock,
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
      expect(logger.info).toHaveBeenCalledWith({
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
});
