import { Injectable } from '@nestjs/common';
import {
  TasksRepository,
  ConditionalCheckFailedException,
  logger,
  TaskEvent,
} from '../shared';
import { CreateTaskDto } from './dto/create-task.dto';

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
      logger.info({ taskId, event: TaskEvent.TASK_SAVED });
      return { taskId };
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        logger.error({ taskId, event: TaskEvent.TASK_DUPLICATED });
        return { taskId, duplicate: true };
      }
      throw err;
    }
  }
}
