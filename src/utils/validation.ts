export function validateTaskTitle(title: string): boolean {
  return title.trim().length > 0 && title.trim().length <= 100;
}
