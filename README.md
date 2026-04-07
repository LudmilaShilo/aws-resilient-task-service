# AWS Resilient Task Service

A resilient asynchronous task processing service built on AWS Lambda, SQS, and DynamoDB. Accepts tasks via HTTP API, processes them asynchronously with automatic retries, and allows clients to poll task status.

Only authenticated users (Cognito JWT) can submit tasks and query their status. A user can only retrieve the status of tasks they created.

For architectural decisions and design rationale, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Prerequisites

- Node.js 20+
- AWS CLI configured (`aws configure`)
- Serverless Framework (`npm install -g serverless`)

---

## Quick Start

```bash
npm install
npm run build
npx serverless offline
```

---

## Tech Stack

- **Runtime:** Node.js 20 + NestJS
- **Infrastructure:** AWS Lambda, SQS, DynamoDB, EventBridge Pipes, Cognito, API Gateway, CloudWatch
- **IaC:** Serverless Framework

---

## Environment Variables

**`TASKS_TABLE`** — DynamoDB table name. Default: `tasks`

**`TASK_QUEUE_URL`** — SQS Task Queue URL. Set automatically via CloudFormation `!Ref`.

**`PROCESSING_TIME_MS`** — Simulated processing duration in milliseconds. Default: `3000`

**`LAMBDA_TIMEOUT`** — Lambda timeout in seconds. Default: `30`

**`MAX_RETRIES`** — Maximum retry attempts before marking a task as FAILED. Default: `2`

**`HMAC_SECRET`** — Secret key used for HMAC blind index of `userId` in logs. Stored in AWS SSM Parameter Store.

**`LOG_LEVEL`** — Log verbosity level: `debug` / `info` / `warn` / `error`. Default: `info`

---

## API Documentation

### POST /tasks

Submit a new task for asynchronous processing.

**Request:**
```json
{
  "taskId": "<uuid-v4>",
  "payload": { "any": "json" }
}
```

**Response `200`:**
```json
{ "taskId": "string" }
```

**Response `200` (duplicate):**
```json
{ "taskId": "string", "duplicate": true }
```

---

### GET /tasks/status/:taskId

Poll the status of a previously submitted task.

**Response `200`:**
```json
{
  "taskId": "string",
  "status": "PENDING | PROCESSING | RETRYING | COMPLETED | FAILED"
}
```

---

## Testing

```bash
npm test
```

---

## Deploy to AWS

```bash
npx serverless deploy --stage dev
```

### Create a test Cognito user (after deploy)

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId> \
  --username testuser \
  --temporary-password Test1234!

aws cognito-idp admin-add-user-to-group \
  --user-pool-id <UserPoolId> \
  --username testuser \
  --group-name task-users
```

### Get JWT token

```bash
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <ClientId> \
  --auth-parameters USERNAME=testuser,PASSWORD=Test1234!
```

### Example requests

```bash
# Submit a task
curl -X POST https://<api-id>.execute-api.<region>.amazonaws.com/dev/tasks \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"taskId": "<uuid-v4>", "payload": {"key": "value"}}'

# Poll for status
curl https://<api-id>.execute-api.<region>.amazonaws.com/dev/tasks/status/<taskId> \
  -H "Authorization: Bearer <JWT>"
```
