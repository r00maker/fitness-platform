/**
 * Errors carry a stable `code` (for the apps to react to) and a plain-English
 * `message` (safe to show users as-is). Internal details are never sent to clients.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(400, code, message, details);
export const unauthorized = () => new AppError(401, "not_signed_in", "Please sign in to continue.");
export const forbidden = (message = "You don't have permission to do that.") => new AppError(403, "forbidden", message);
export const notFound = (thing: string) => new AppError(404, "not_found", `We couldn't find that ${thing}.`);
export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(409, code, message, details);
