/** "Frame 3: The Nightmare" (just "Frame 3" when the title is blank). index is 0-based. */
export function frameLabel(index: number, title: string): string {
  const t = title.trim();
  return t ? `Frame ${index + 1}: ${t}` : `Frame ${index + 1}`;
}

/** "Entry 2: Triptych" (just "Entry 2" when the name is blank). index is 0-based. */
export function entryLabel(index: number, name: string): string {
  const t = name.trim();
  return t ? `Entry ${index + 1}: ${t}` : `Entry ${index + 1}`;
}
