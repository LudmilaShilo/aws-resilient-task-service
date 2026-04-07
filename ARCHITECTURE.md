# Architecture Decision Record

## 1. Problem & Goals

Build a resilient backend service that:

- Accepts tasks via HTTP API (`POST /tasks`)
- Processes them asynchronously
- Retries failed tasks up to 2 times
- Marks permanently failed tasks as FAILED
- Allows clients to poll task status (`GET /tasks/status/:taskId`)

---

## 2. Assumptions

**1. Data Distribution**
`taskId` is generated on the client side as a UUID v4. This ensures even distribution of requests across DynamoDB partitions, automatically eliminating the Hot Key problem for this use case.

**2. Payload Size**
Payload size is assumed to be ≤ 256 KB — the SQS message size limit. If payloads were larger, a Claim Check Pattern would be required: store the data in S3 and send only a reference to SQS. For this task, we assume payloads are lightweight.

**3. CloudWatch Logs**
We assume logs older than 14 days are not needed for analysis. Log retention is limited to 14 days to avoid unnecessary CloudWatch costs. For privacy reasons, `userId` is never included in logs.

**4. DynamoDB Table Structure**
The table currently contains only the fields required for this assignment. In a real-world scenario, additional fields and a different table structure might be needed for broader use cases. If old tasks are not needed, a TTL field should be added to limit table size.

**5. Task Access Roles**
Only authenticated users can create tasks. A user can only view the status of tasks they created themselves.

**6. Client Status Polling**
For simplicity, we assume the client polls for task status using exponential backoff:
`retry 1: 1s → retry 2: 2s → retry 3: 4s → retry 4: 8s...`

**7. Explicitly NOT Required**
The assignment lists Authentication, UI/frontend, Perfect error handling, Production-grade infrastructure, and High throughput optimization as explicitly not required. We implemented all backend-relevant items as conscious choices to demonstrate production-oriented thinking: Cognito auth, structured error handling with graceful degradation, CloudWatch Alarms + Log Groups + IAM least privilege, and SQS batching with `maximumBatchingWindow`. UI/frontend is the only item intentionally left out of scope.

**8. No Task Result Returned**
Of the two common async task patterns — Fire-and-Forget and Asynchronous Request-Response — we implement the scenario where the client only needs to know that the task completed successfully, not receive the actual computation result. The `GET /tasks/status/:taskId` endpoint returns only `{ taskId, status }`.

---

## 3. Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│                        AWS Cloud                        │
│                                                         │
│  Client ──► API Gateway ──► Lambda (NestJS API)         │
│               (Cognito JWT    │                         │
│                throttle)      ▼                         │
│                          DynamoDB                       │
│                          (Tasks table)                  │
│                               │                         │
│                         Streams (INSERT)                │
│                               │                         │
│                      EventBridge Pipe                   │
│                               │                         │
│                          SQS TaskQueue                  │
│                          (VisTimeout=180s)              │
│                               │                         │
│                    Lambda Consumer (×10 concurrency)    │
│                    ┌──────────┴──────────┐              │
│                 Success               Failure           │
│                    │                     │              │
│              DynamoDB                DynamoDB           │
│              COMPLETED               RETRYING           │
│                                         │ (3× SQS retry)│
│                                     TaskDLQ             │
│                                         │              │
│                                  Lambda DLQ Handler     │
│                                  ┌──────┴──────┐        │
│                               Success       Failure     │
│                                  │              │       │
│                             DynamoDB     EmergencyDLQ   │
│                             FAILED       + CW Alarm     │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Trade-offs

**1. Eventual Consistency instead of Real-time**
After `POST /tasks`, the client may not see the PROCESSING status immediately due to the propagation delay in DynamoDB Streams + EventBridge Pipe.
We prioritize throughput over instant UI updates. This allows the API to remain lightweight and ensures the system does not collapse under peak load.

**2. At-least-once Delivery**
We acknowledge that a message may be processed more than once. Instead of building an expensive infrastructure-level deduplication system, we push this logic into the Lambda code via `ConditionExpression: status IN (PENDING, RETRYING)` on DynamoDB. This is significantly cheaper and easier to maintain, while the business logic remains protected.

**3. Fixed Concurrency Limit (Maximum Concurrency)**
Under extreme task load, queue wait time (latency) will increase. We deliberately limit processing speed to protect the AWS budget from unpredictable costs and to avoid exceeding DynamoDB throughput limits. _"Slower is better than expensive or error-prone."_

**4. Cost and Deployment Simplicity vs. Performance**
In the classical approach, NestJS runs as a persistent server and Lambda handles only async task processing — architecturally the more correct choice for production. We chose "everything in Lambda" via `@vendia/serverless-express` to avoid paying for an always-on server in a demo project.

---

## 5. Key Design Decisions

**1. Structured Lifecycle Logging**
Every step of the task lifecycle is logged with a structured event from a dedicated `TaskEvent` enum (e.g. `TASK_RECEIVED`, `TASK_EXECUTION_STARTED`, `TASK_COMPLETED`, `TASK_IN_DLQ_FAILED`). Each log entry includes `taskId` and a timestamp, making it possible to reconstruct the full lifecycle of any task from logs alone.

**2. RETRYING Status (beyond the spec)**
The assignment defines 4 statuses: PENDING, PROCESSING, COMPLETED, FAILED. We added a fifth: RETRYING. Without it, a failed task would reset to PENDING, producing a confusing status progression for polling clients:
`PENDING → PROCESSING → PENDING → PROCESSING → PENDING → PROCESSING → COMPLETED`

RETRYING makes the progression unambiguous:
`PENDING → PROCESSING → RETRYING → PROCESSING → RETRYING → PROCESSING → COMPLETED`

**3. GSI on `status` (inspecting failed tasks)**
Failed tasks are already observable via structured logs with the `TASK_SET_FAILED_STATUS` event. We added a Global Secondary Index with `status` as the Partition Key to provide a complementary, database-level alternative: retrieving all failed tasks with a single query (`status = 'FAILED'`) directly from DynamoDB, without touching the logs.

**4. Privacy vs. Audit: HMAC Blind Index**
We do not log `userId` for privacy reasons. However, when a user attempts to access another user's task (`TASK_MALICIOUS_ASK`), we need to be able to identify the malicious actor.

For this purpose we log `userIdIndex` — HMAC-SHA256 of `userId` with a secret key stored in AWS SSM Parameter Store. The index is deterministic: the same `userId` always produces the same `userIdIndex`, enabling lookup without exposing the identifier.

Our solution does not require a `users` table, but in a real project such a table would likely exist. It could store `userIdIndex` alongside user data, allowing quick identification of a malicious actor from logs.

**5. DynamoDB Streams + EventBridge Pipe as trigger**
We need atomicity: a task must be both saved to DynamoDB and enqueued in SQS, or neither. Calling `SQS.send()` directly in the API Lambda after a DynamoDB write does not guarantee this — if SQS is temporarily unavailable, the task is saved but never processed.

Instead, we use DynamoDB Streams + EventBridge Pipe filtered on `INSERT` events. The write to DynamoDB is the single source of truth; the pipe handles enqueuing independently and retries automatically on failure. This makes it impossible for a task to be saved but never enqueued.

**6. Cognito User Pools + JWT**
We chose Cognito over alternatives (custom JWT middleware, Auth0, etc.) because it is a managed AWS service: it integrates natively with API Gateway, requires zero token validation code on our side, and adds user management with no additional infrastructure to maintain.

**7. EmergencyDLQ without a Lambda consumer**
If the DLQ Lambda fails after 3 attempts, the message moves to EmergencyDLQ and triggers a CloudWatch Alarm. We deliberately do not add another Lambda here — if the DLQ processor itself is failing, the problem is infrastructural and requires human intervention. Adding another automation layer would only create false confidence.

**8. DLQ Batch Size: 1**
Tasks that reach the DLQ have already exhausted 3 retry attempts — throughput here is irrelevant. Processing one message per invocation keeps the handler simple: no `ReportBatchItemFailures` needed, and retry semantics are unambiguous — one message fails, that exact message is retried.

---

## 6. Status State Machine

```
                    ┌─────────┐
              POST ─►  PENDING │
                    └────┬────┘
                         │ Lambda picks up from SQS
                    ┌────▼──────┐
                    │ PROCESSING│◄──────────────┐
                    └────┬──────┘               │
              ┌──────────┴──────────┐           │
           Success               Failure        │
              │                     │           │
        ┌─────▼──────┐       ┌──────▼──────┐    │
        │ COMPLETED  │       │  RETRYING   │────┘
        └────────────┘       └──────┬──────┘
                              (after 3 SQS attempts)
                                    │
                              ┌─────▼──────┐
                              │   FAILED   │
                              └────────────┘
```

---

## 7. Retry Strategy

**Layer 1 — SQS automatic retries:**

- If Lambda throws an error, SQS makes the message visible again
- `maxReceiveCount: 3` means 1 initial attempt + 2 retries, satisfying the requirement of up to 2 retries
- `VisibilityTimeout = lambdaTimeout × 6` ensures SQS does not make the message visible again (and count it as a failed attempt) while Lambda is still processing it
- `ReportBatchItemFailures` ensures only failed messages in a batch are retried, not the entire batch

**Layer 2 — DynamoDB atomic status lock:**

- Before processing, Lambda updates status to PROCESSING using `ConditionExpression: status IN (PENDING, RETRYING)`
- This prevents two Lambda instances from processing the same task simultaneously
- On failure, status is reset from PROCESSING back to RETRYING — required so that the next SQS delivery attempt passes the `ConditionExpression: status IN (PENDING, RETRYING)` check and the task is picked up for reprocessing

**Layer 3 — Dead Letter Queue:**

- After 3 failed SQS deliveries, the message moves to TaskDLQ
- A dedicated Lambda reads from TaskDLQ and marks the task FAILED in DynamoDB
- If this Lambda also fails 3 times, the message moves to EmergencyDLQ
- EmergencyDLQ triggers a CloudWatch Alarm — requires manual intervention

---

## 8. Task Processing Simulation

Background task processing is simulated via `executeTaskWork`:

- waits for `PROCESSING_TIME_MS` milliseconds (configurable via environment variable, default 3000ms)
- randomly fails ~30% of tasks to simulate real-world processing errors

This satisfies the requirement to _"simulate processing logic"_ without a specific domain implementation.

---

## 9. Known Limitations

**1. Tasks can get stuck in PROCESSING**
If DynamoDB calls that update task status to COMPLETED or FAILED fail after business logic execution, the task status remains PROCESSING permanently. This could be solved with a watchdog Lambda on a schedule that picks up stale PROCESSING records, transitions them to RETRYING, and re-queues them in SQS. However, this requires `executeTaskWork` to be idempotent, which is impossible to implement in the abstract — it depends on the specific domain and type of work performed. This scenario is intentionally left out of scope.

**2. Single dev environment**
This demo project is deployed to one AWS account with a single `dev` stage and a simple `tasks` table name. In a production scenario, separate AWS Accounts per environment (Staging/Production) would be used for environment isolation, which is the security best practice.

**3. UUID collision**
Generating two identical `taskId` values via UUID v4 is theoretically possible but extremely rare. We intentionally leave this edge case out of scope to avoid complicating the logic. If the same `taskId` arrives again, we treat it as a duplicate request from the client and return `{ taskId, duplicate: true }`.
