/** Busca un nodo obligatorio: si falta, el HTML y el shell no coinciden y conviene fallar temprano. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}
