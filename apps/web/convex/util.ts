export const safeStringify = (value: unknown, limit = 4000): string => {
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return "";
    }
    return serialized.length > limit ? `${serialized.slice(0, limit)}…` : serialized;
  } catch {
    return String(value);
  }
};
