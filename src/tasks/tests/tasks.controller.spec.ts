import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import * as express from 'express';
import type { Request } from 'express';
import { TasksModule } from '../tasks.module';
import { TasksService } from '../tasks.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { SQS_LIMITS } from '../../shared';
import type { Server } from 'http';

const VALID_UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const VALID_BODY = { taskId: VALID_UUID, payload: { key: 'value' } };
const REQUIRED_GROUP = 'task-users';

type AuthedRequest = Request & { user: { sub: string } };

// Simulates API Gateway injecting Cognito claims and running group check
const withAuth = (groups = [REQUIRED_GROUP]) => {
  jest
    .spyOn(JwtAuthGuard.prototype, 'canActivate')
    .mockImplementation((ctx) => {
      const req = ctx.switchToHttp().getRequest<AuthedRequest>();
      if (!groups.includes(REQUIRED_GROUP)) {
        throw new ForbiddenException();
      }
      req.user = { sub: 'user-sub-123' };
      return true;
    });
};

describe('TasksController (integration)', () => {
  let app: INestApplication<Server>;
  let tasksService: TasksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TasksModule],
    })
      .overrideProvider(TasksService)
      .useValue({
        createTask: jest.fn().mockResolvedValue({ taskId: VALID_UUID }),
      })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.use(express.json({ limit: SQS_LIMITS.MAX_PAYLOAD_BYTES }));
    await app.init();

    tasksService = module.get(TasksService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  describe('POST /tasks', () => {
    it('returns 201 for a valid request', async () => {
      withAuth();

      await request(app.getHttpServer())
        .post('/tasks')
        .send(VALID_BODY)
        .expect(201);
    });

    it('calls service with taskId and userId', async () => {
      withAuth();

      await request(app.getHttpServer()).post('/tasks').send(VALID_BODY);

      expect(tasksService.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: VALID_UUID }),
        'user-sub-123',
      );
    });

    it('returns 400 when taskId is not a valid UUID v4', async () => {
      withAuth();

      await request(app.getHttpServer())
        .post('/tasks')
        .send({ ...VALID_BODY, taskId: 'not-a-uuid' })
        .expect(400);
    });

    it('returns 400 when payload is missing', async () => {
      withAuth();

      await request(app.getHttpServer())
        .post('/tasks')
        .send({ taskId: VALID_UUID })
        .expect(400);
    });

    it('returns 400 when payload is not an object', async () => {
      withAuth();

      await request(app.getHttpServer())
        .post('/tasks')
        .send({ taskId: VALID_UUID, payload: 'string-not-object' })
        .expect(400);
    });

    it('strips extra fields from body (whitelist: true)', async () => {
      withAuth();

      await request(app.getHttpServer())
        .post('/tasks')
        .send({ ...VALID_BODY, adminFlag: true });

      expect(tasksService.createTask).toHaveBeenCalledWith(
        expect.not.objectContaining({ adminFlag: true }),
        expect.any(String),
      );
    });

    it('returns 413 when body exceeds 256 KB', async () => {
      withAuth();
      const largePayload = { data: 'x'.repeat(SQS_LIMITS.MAX_PAYLOAD_BYTES) };

      await request(app.getHttpServer())
        .post('/tasks')
        .send({ taskId: VALID_UUID, payload: largePayload })
        .expect(413);
    });

    it('returns 403 when user is not in task-users group', async () => {
      withAuth(['other-group']);

      await request(app.getHttpServer())
        .post('/tasks')
        .send(VALID_BODY)
        .expect(403);
    });

    it('returns 403 when Authorization header is missing', async () => {
      await request(app.getHttpServer())
        .post('/tasks')
        .send(VALID_BODY)
        .expect(403);
    });
  });
});
