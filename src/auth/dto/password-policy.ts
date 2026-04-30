/**
 * Shared password complexity rule.
 *   - At least one lowercase letter
 *   - At least one uppercase letter
 *   - At least one digit OR non-word character (symbol)
 *   - Minimum 8 characters
 *
 * Apply to a class-validator field via:
 *   @Matches(PASSWORD_REGEX, { message: PASSWORD_RULE_MESSAGE })
 */
export const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*[\d\W])[\s\S]{8,}$/;

export const PASSWORD_RULE_MESSAGE =
  'Password must be at least 8 characters and include upper, lower, and a digit or symbol.';
