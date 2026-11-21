# Auditoría de dependencias

Resultado: **auditoría pendiente**, no «sin vulnerabilidades». La revisión prohibía el
contacto con servicios remotos. No se descargaron dependencias ni datos de avisos.

| Ecosistema | Comando y salida observada | ID / dependencia afectada | Mitigación y próxima verificación |
|---|---|---|---|
| Rust | `CARGO_NET_OFFLINE=true cargo audit` → `error: no such command: audit` (101). `CARGO_NET_OFFLINE=true cargo install cargo-audit --locked` → `could not find cargo-audit in registry crates-io with version *` (101). | No determinado; sin auditor ni base RustSec local. | Proveer `cargo-audit` y una copia reciente de RustSec por un canal autorizado; ejecutar `cargo audit --no-fetch` con esa base para `Cargo.lock` y `core/Cargo.lock` o autorizar la consulta habitual. |
| Bun | `sandbox-exec -p '(version 1) (allow default) (deny network*)' bun audit` → `POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - DNSResolveFailed` (1). | No determinado; sin respuesta del registro de avisos. | Ejecutar `bun audit` con acceso autorizado al registro de avisos. Cualquier cambio a `bun.lock` o `package.json` necesita autorización separada. |

No se aplicaron actualizaciones de versiones sin evidencia. El inventario de locks
está en [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). Una vez obtenidos los
resultados, registrar por cada hallazgo el ID, la dependencia/versión, y la corrección
aplicada o su mitigación si no se puede actualizar.
