export type Result<TValue, TError extends string = string> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: TError; readonly message: string };
