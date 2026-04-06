import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import * as express from 'express';
import type { Request } from 'express';
import { TasksModule } from '../tasks.module';
import { TasksService } from '../tasks.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { SQS_LIMITS, TaskStatus } from '../../shared';
import { TaskStatusResponse } from '../dto/task-status-response.dto';
import type { Server } from 'http';

const VALID_UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const VALID_BODY = { taskId: VALID_UUID, payload: { key: 'value' } };

const TASK_STATUS_RESPONSE: TaskStatusResponse = {
  taskId: VALID_UUID,
  status: TaskStatus.PENDING,
};

type AuthedRequest = Request & { user: { sub: string } };

const mockAuth = () => {
  jest
    .spyOn(JwtAuthGuard.prototype, 'canActivate')
    .mockImplementation((ctx) => {
      const req = ctx.switchToHttp().getRequest<AuthedRequest>();
      req.user = { sub: 'user-sub-123' };
      return true;
    });
};

describe('Contract tests', () => {
  let app: INestApplication<Server>;
  let tasksService: TasksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TasksModule],
    })
      .overrideProvider(TasksService)
      .useValue({
        createTask: jest.fn().mockResolvedValue({ taskId: VALID_UUID }),
        getTaskStatus: jest.fn().mockResolvedValue(TASK_STATUS_RESPONSE),
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

  describe('POST /tasks (contract)', () => {
    describe('Request contract', () => {
      it('requires Content-Type: application/json', async () => {
        mockAuth();

        await request(app.getHttpServer())
          .post('/tasks')
          .set('Content-Type', 'text/plain')
          .send(JSON.stringify(VALID_BODY))
          .expect(400);
      });

      it('requires taskId to be a UUID v4', async () => {
        mockAuth();

        await request(app.getHttpServer())
          .post('/tasks')
          .send({ ...VALID_BODY, taskId: 'not-a-uuid' })
          .expect(400);
      });

      it('requires taskId to be present', async () => {
        mockAuth();

        const bodyWithoutTaskId = { payload: VALID_BODY.payload };
        await request(app.getHttpServer())
          .post('/tasks')
          .send(bodyWithoutTaskId)
          .expect(400);
      });

      it('requires payload to be an object', async () => {
        mockAuth();

        await request(app.getHttpServer())
          .post('/tasks')
          .send({ ...VALID_BODY, payload: 'not-an-object' })
          .expect(400);
      });

      it('requires payload to be present', async () => {
        mockAuth();

        const bodyWithoutPayload = { taskId: VALID_BODY.taskId };
        await request(app.getHttpServer())
          .post('/tasks')
          .send(bodyWithoutPayload)
          .expect(400);
      });

      it('rejects body larger than 256 KB', async () => {
        mockAuth();

        await request(app.getHttpServer())
          .post('/tasks')
          .send({
            taskId: VALID_UUID,
            payload: { data: 'x'.repeat(SQS_LIMITS.MAX_PAYLOAD_BYTES) },
          })
          .expect(413);
      });
    });

    describe('Response contract', () => {
      it('success response has shape { taskId: string }', async () => {
        mockAuth();

        const { body } = await request(app.getHttpServer())
          .post('/tasks')
          .send(VALID_BODY)
          .expect(201);

        expect(body).toMatchObject({ taskId: expect.any(String) });
        expect(Object.keys(body)).toEqual(['taskId']);
      });

      it('duplicate response has shape { taskId: string, duplicate: true }', async () => {
        mockAuth();
        jest
          .spyOn(tasksService, 'createTask')
          .mockResolvedValue({ taskId: VALID_UUID, duplicate: true });

        const { body } = await request(app.getHttpServer())
          .post('/tasks')
          .send(VALID_BODY)
          .expect(201);

        expect(body).toMatchObject({
          taskId: expect.any(String),
          duplicate: true,
        });
        expect(Object.keys(body).sort()).toEqual(['duplicate', 'taskId']);
      });

      it('validation error response has shape { statusCode, message[], error }', async () => {
        mockAuth();

        const { body } = await request(app.getHttpServer())
          .post('/tasks')
          .send({ taskId: 'not-a-uuid', payload: {} })
          .expect(400);

        expect(body).toMatchObject({
          statusCode: 400,
          message: expect.arrayContaining([expect.any(String)]),
          error: 'Bad Request',
        });
      });
    });
  });

  describe('GET /tasks/status/:taskId (contract)', () => {
    describe('Request contract', () => {
      it('requires taskId to be a UUID v4 in path', async () => {
        mockAuth();

        await request(app.getHttpServer())
          .get('/tasks/status/not-a-uuid')
          .expect(400);
      });

      it('requires Authorization header', async () => {
        await request(app.getHttpServer())
          .get(`/tasks/status/${VALID_UUID}`)
          .expect(403);
      });
    });

    describe('Response contract', () => {
      it('success response has shape { taskId, status }', async () => {
        mockAuth();

        const { body } = await request(app.getHttpServer())
          .get(`/tasks/status/${VALID_UUID}`)
          .expect(200);

        expect(body).toMatchObject({
          taskId: expect.any(String),
          status: expect.any(String),
        });
        expect(Object.keys(body).sort()).toEqual(['status', 'taskId']);
      });

      it('not found response has shape { statusCode: 404, message: "Not Found" }', async () => {
        mockAuth();
        jest
          .spyOn(tasksService, 'getTaskStatus')
          .mockRejectedValue(new NotFoundException());

        const { body } = await request(app.getHttpServer())
          .get(`/tasks/status/${VALID_UUID}`)
          .expect(404);

        expect(body).toMatchObject({
          statusCode: 404,
          message: 'Not Found',
        });
      });

      it('invalid UUID response has shape { statusCode: 400, message, error }', async () => {
        mockAuth();

        const { body } = await request(app.getHttpServer())
          .get('/tasks/status/not-a-uuid')
          .expect(400);

        expect(body).toMatchObject({
          statusCode: 400,
          message: expect.any(String),
          error: 'Bad Request',
        });
      });
    });
  });
});
