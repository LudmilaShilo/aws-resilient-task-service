import { Task } from '../../shared';

export type TaskStatusResponse = Pick<Task, 'taskId' | 'status'>;
