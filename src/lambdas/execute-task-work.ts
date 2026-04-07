const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const executeTaskWork = async (
  processingTimeMs: number,
): Promise<void> => {
  await sleep(processingTimeMs);
  if (Math.random() < 0.3) {
    throw new Error('Simulated random failure');
  }
};
