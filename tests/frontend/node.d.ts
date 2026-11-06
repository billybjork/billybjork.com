/** The one Node API the tests use: reading the fixtures shared with the Python tests. */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf-8'): string;
}
