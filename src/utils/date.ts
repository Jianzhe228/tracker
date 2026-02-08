export function formatDate(input: Date): string {
  return input.toISOString().slice(0, 10);
}
