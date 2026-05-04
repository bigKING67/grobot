export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === "string");
}

export function recordArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => isRecord(item));
}

export function parseBoolean(value) {
  return value === true || value === "true" || value === "1";
}

export function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
