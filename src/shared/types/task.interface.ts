import { TaskStatus } from './status.enum';

export interface Task {
  taskId: string;
  userId: string;
  status: TaskStatus;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  errorMessage: string[];
  payload: Record<string, unknown>;
}
