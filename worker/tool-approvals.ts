import { OperationError } from "./errors";

type Waiter = {
  taskId: string;
  resolve: (value: { approved: boolean; note: string }) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

const waiters = new Map<string, Waiter>();

export function hasToolApprovalWaiter(id: string) {
  return waiters.has(id);
}

export function waitForToolApproval(
  id: string,
  taskId: string,
  signal?: AbortSignal,
) {
  if (signal?.aborted)
    return Promise.reject(new OperationError("Task stopped by user"));
  return new Promise<{ approved: boolean; note: string }>((resolve, reject) => {
    const waiter: Waiter = { taskId, resolve, reject, signal };
    if (signal) {
      const abort = () => {
        waiters.delete(id);
        reject(new OperationError("Task stopped by user"));
      };
      waiter.abort = () => signal.removeEventListener("abort", abort);
      signal.addEventListener("abort", abort, { once: true });
    }
    waiters.set(id, waiter);
  });
}

export function resolveToolApproval(
  id: string,
  approved: boolean,
  note: string,
) {
  const waiter = waiters.get(id);
  if (!waiter) return false;
  waiters.delete(id);
  waiter.abort?.();
  waiter.resolve({ approved, note });
  return true;
}

export function cancelToolApprovals(
  taskId: string | null,
  error: unknown,
) {
  for (const [id, waiter] of waiters)
    if (!taskId || waiter.taskId === taskId) {
      waiters.delete(id);
      waiter.abort?.();
      waiter.reject(error);
    }
}
