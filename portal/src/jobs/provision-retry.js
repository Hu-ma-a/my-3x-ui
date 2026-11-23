export function startProvisionRetryJob({ orders, logger, intervalMs = 30000 }) {
  let timer = null;
  const run = async () => {
    try {
      await orders.retryPending();
    } catch (err) {
      logger.warn('自动重试开通任务失败：', err.message);
    }
  };
  return {
    start(customIntervalMs = intervalMs) {
      if (timer) return;
      timer = setInterval(run, customIntervalMs);
      timer.unref?.();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    run,
  };
}
