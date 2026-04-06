export const SQS_LIMITS = {
  // Maximum SQS message size. Payloads exceeding this require the Claim Check Pattern (S3 + reference).
  MAX_PAYLOAD_BYTES: 256 * 1024,
};
