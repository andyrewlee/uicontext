export const logInfo = (message: string, payload?: Record<string, unknown>) => {
  const base = `[contexts][info] ${message}`;
  console.log(payload ? `${base} :: ${JSON.stringify(payload)}` : base);
};

export const logError = (message: string, payload?: Record<string, unknown>) => {
  const base = `[contexts][error] ${message}`;
  console.error(payload ? `${base} :: ${JSON.stringify(payload)}` : base);
};
