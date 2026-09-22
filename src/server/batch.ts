export async function startBoundedBatch<T>(
  tasks: readonly T[],
  maxConcurrent: number,
  launch: (task: T, index: number) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error("maxConcurrent debe ser un entero positivo");
  }

  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      const task = tasks[index];
      if (task !== undefined) await launch(task, index);
    }
  };

  const workers = Array.from(
    { length: Math.min(maxConcurrent, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
}
