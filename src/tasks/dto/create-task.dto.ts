import { IsObject, IsUUID } from 'class-validator';

export class CreateTaskDto {
  @IsUUID(4)
  taskId: string;

  @IsObject()
  payload: Record<string, unknown>;
}
