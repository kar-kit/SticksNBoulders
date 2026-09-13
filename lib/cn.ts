/**
 * Join class names, dropping falsy entries.
 *
 * Deliberately not clsx + tailwind-merge. Merge only earns its cost when
 * callers pass conflicting utilities for the same property, and the component
 * APIs here take a `variant` rather than a class override precisely so that
 * cannot happen. Revisit if a component ever needs to accept arbitrary
 * overriding classes.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
