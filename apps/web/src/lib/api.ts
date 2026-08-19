import { NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { UnauthorizedError } from './auth';

/**
 * Route helpers.
 *
 * A failed request returns a reason the UI can display verbatim. The
 * application's rule against fabricating data extends to its error messages:
 * "something went wrong" tells the trader nothing about whether to trust the
 * screen in front of them.
 */

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as object, init);
}

export function apiError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) {
    return apiError('Not signed in.', 401);
  }
  if (error instanceof ZodError) {
    return apiError('Invalid request.', 422, {
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  // Log the full error server-side; return the message so the UI can be specific.
  console.error('[api]', error);
  return apiError(message, 500);
}

export async function parseBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ZodError([
      { code: 'custom', path: [], message: 'Request body must be valid JSON.' },
    ]);
  }
  return schema.parse(payload);
}

export function searchNumber(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function searchString(url: URL, key: string, fallback?: string): string | undefined {
  return url.searchParams.get(key) ?? fallback;
}
