// El proyecto no depende de @types/node; los tests solo necesitan leer el wasm compilado.
declare module 'node:fs' {
  export function readFileSync(path: URL | string): Uint8Array;
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
}
