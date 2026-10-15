export const shouldHoldForRetry = (status: number | undefined) =>
  !status || status === 429 || status >= 500;
