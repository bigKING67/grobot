export function expect(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function expectIncludes(source: string, fragment: string, message: string): void {
  expect(source.includes(fragment), `${message}: missing ${fragment}`);
}

export function expectAllIncludes(source: string, fragments: readonly string[], message: string): void {
  for (const fragment of fragments) {
    expectIncludes(source, fragment, message);
  }
}

export function expectThrowsIncludes(run: () => void, fragment: string, message: string): void {
  try {
    run();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    expect(errorMessage.includes(fragment), `${message}: expected ${fragment}, got ${errorMessage}`);
    return;
  }
  throw new Error(`${message}: expected throw containing ${fragment}`);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringArray(value: unknown, label: string): string[] {
  expect(Array.isArray(value), `${label} must be array`);
  return value.map((item) => {
    expect(typeof item === "string", `${label} items must be strings`);
    return item;
  });
}
