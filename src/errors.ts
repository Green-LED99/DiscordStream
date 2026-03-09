export enum ExitCode {
  Ok = 0,
  Config = 10,
  Auth = 20,
  Gateway = 30,
  Media = 40,
  Dave = 50,
  Transport = 60,
  Internal = 70,
}

export class AppError extends Error {
  public readonly exitCode: ExitCode;
  public readonly details: Record<string, unknown> | undefined;

  public constructor(message: string, exitCode: ExitCode, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(error.message, ExitCode.Internal);
  }

  return new AppError('Unknown internal error', ExitCode.Internal);
}
