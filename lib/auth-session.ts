export const AUTH_SESSION_MAX_AGE_SECONDS = 3 * 24 * 60 * 60;

export const AUTH_COOKIE_OPTIONS = {
  maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
} as const;
