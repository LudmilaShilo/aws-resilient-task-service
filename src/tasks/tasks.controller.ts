import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/current-user.decorator';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskStatusResponse } from './dto/task-status-response.dto';

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  async createTask(
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ taskId: string; duplicate?: true }> {
    return this.tasksService.createTask(dto, user.sub);
  }

  @Get('status/:taskId')
  async getTaskStatus(
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<TaskStatusResponse> {
    return this.tasksService.getTaskStatus(taskId, user.sub);
  }
}
