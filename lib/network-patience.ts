/**
 * Longer timeout for low-bandwidth / flaky networks (2G).
 */
export async function withPatience<T>(
  operation: () => Promise<T>,
  options: { patient: boolean }
): Promise<T> {
  const ms = options.patient ? 60_000 : 18_000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          options.patient
            ? "Still trying… connection is very slow. Wait or check your signal."
            : "Request timed out. Check your connection."
        )
      );
    }, ms);
  });
  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
