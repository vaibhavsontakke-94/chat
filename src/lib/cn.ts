export type ClassValue = string | number | null | undefined | false | ClassValue[]

/** Minimal class-name joiner - keeps conditional class lists readable. */
export function cn(...values: ClassValue[]): string {
  const classes: string[] = []

  for (const value of values) {
    if (!value) continue
    if (Array.isArray(value)) {
      const nested = cn(...value)
      if (nested.length > 0) classes.push(nested)
    } else {
      classes.push(String(value))
    }
  }

  return classes.join(' ')
}
