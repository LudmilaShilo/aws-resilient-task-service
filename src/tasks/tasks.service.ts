import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  TasksRepository,
  ConditionalCheckFailedException,
  logger,
  TaskEvent,
  createUserIdIndex,
} from '../shared';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskStatusResponse } from './dto/task-status-response.dto';

@Injectable()
export class TasksService {
  private readonly repository = new TasksRepository();

  async createTask(
    dto: CreateTaskDto,
    userId: string,
  ): Promise<{ taskId: string; duplicate?: true }> {
    const { taskId, payload } = dto;

    logger.info({ taskId, event: TaskEvent.TASK_RECEIVED });

    try {
      await this.repository.createTask(taskId, userId, payload);
      logger.debug({ taskId, event: TaskEvent.TASK_SAVED });
      return { taskId };
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        logger.error({ taskId, event: TaskEvent.TASK_DUPLICATED });
        return { taskId, duplicate: true };
      }
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({
        taskId,
        event: TaskEvent.TASK_CREATE_ERROR,
        reason: error.message,
        stack: error.stack,
      });
      throw err;
    }
  }

  async getTaskStatus(
    taskId: string,
    userId: string,
  ): Promise<TaskStatusResponse> {
    const task = await this.repository.getTask(taskId);

    if (!task) {
      logger.warn({ taskId, event: TaskEvent.TASK_NOT_FOUND });
      throw new NotFoundException();
    }

    if (task.userId !== userId) {
      logger.warn({
        taskId,
        event: TaskEvent.TASK_MALICIOUS_ASK,
        userIdIndex: createUserIdIndex(userId),
      });
      throw new ForbiddenException();
    }

    return {
      taskId: task.taskId,
      status: task.status,
    };
  }
}
