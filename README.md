# wacrm (aplicación) — Servidor IA (192.168.0.123)

## Resumen

Aplicación Next.js instalada en `/home/ino/wacrm`: es **wacrm**, un template open-source (MIT, [github.com/ArnasDon/wacrm](https://github.com/ArnasDon/wacrm)) de CRM autoalojable para WhatsApp Business API — bandeja compartida, contactos, pipelines de venta, broadcasts y automatizaciones sin código. No es un desarrollo propio de INO; es un producto de terceros que se está evaluando/instalando, con algunas herramientas experimentales de IA agregadas encima (RAG, prototipo de agente con grafo de conocimiento). El backend de datos es el stack Supabase Docker documentado en "Base de datos wacrm (Supabase)".

## Arquitectura

```
/home/ino/wacrm/  (checkout del proyecto, usuario "ino")
   │
   ├── Next.js 16 (App Router) ──► corriendo en modo DEV (`next dev`, puerto 3001, proceso manual, no systemd)
   │        └──► Supabase (NEXT_PUBLIC_SUPABASE_URL, service role key) — ver doc "Base de datos wacrm"
   │        └──► WhatsApp Business API oficial (Meta) — vía META_APP_SECRET
   │
   ├── mcp-server/  — servidor MCP oficial del proyecto (Node/TS), expone la API pública /api/v1
   │        de wacrm como herramientas MCP para clientes tipo Claude Desktop/Code, Cursor, etc.
   │
   ├── rag/  — prototipo propio (Python/FastAPI, "DENT RAG API"), usa ChromaDB local (chroma_db/)
   │        para responder preguntas dentales; NO está corriendo actualmente
   │
   └── graphify_test/  — prototipo propio (Python/Flask) que construye un grafo de conocimiento
            a partir de documentos (PDF/DOCX/MD/etc.), consulta el RAG (localhost:8008/retrieve),
            el diccionario dental de DentWeb12 y usa Claude (claude-sonnet-4-5) como motor de
            razonamiento; NO está corriendo actualmente
```

## Especificaciones técnicas

- **Ubicación**: `/home/ino/wacrm`, propiedad del usuario `ino` (no `root`)
- **Producto base**: wacrm v0.8.0, Next.js 16, licencia MIT, autor Arnas Donauskas
- **Estado de ejecución**: corriendo en modo desarrollo (`next dev`), lanzado manualmente desde una terminal (no hay unidad systemd para esta app) — puerto **3001**
- **Backend**: Supabase local (proyecto "wacrm", ver documento de base de datos dedicado)
- **Variables de entorno relevantes** (`.env`, valores no incluidos): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `META_APP_SECRET` (confirma integración oficial con Meta/WhatsApp Business API), `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_LOCALE`, `ALLOWED_DEV_ORIGINS`
- **Internacionalización**: `messages/en.json`, `es.json`, `ko.json` (soporte multi-idioma nativo del template)
- **Componentes UI**: `components.json` indica uso de shadcn/ui
- **Archivo adicional relevante**: `dent_diccionario.json` (268KB) — diccionario de terminología dental, usado por el prototipo `graphify_test`

### Componentes experimentales agregados (no parte del template oficial)

- **`rag/`** ("DENT RAG API"): FastAPI con endpoints `/health`, `/query`, `/retrieve`, `/run-agent`, `/run-sql`; usa ChromaDB (`chroma_db/`) como almacén vectorial local, con scripts de construcción de chunks (`build_chunks.py`) e ingesta (`ingest_chroma.py`) independientes del `ai_knowledge_chunks`/pgvector que ya existe dentro del esquema de Supabase — es decir, hay dos mecanismos de RAG en paralelo (uno en Postgres/pgvector, otro en ChromaDB standalone).
- **`graphify_test/`**: Flask + SQLite (`config.db`) que construye un grafo de conocimiento a partir de documentos subidos, consulta el RAG anterior (`http://localhost:8008/retrieve`), el endpoint de diccionario de DentWeb12 (`http://192.168.43.183/DentWeb12/dent/rest/diccionario.jsp`) y el endpoint genérico de consultas (`queryGptJson.jsp`), todo autenticado con el mismo token estático (`987654321`) visto en Presupuesto INO y Reportería INO. Usa Claude (`claude-sonnet-4-5-20250929`) como modelo de razonamiento — el único servicio de este servidor que usa Anthropic directamente en vez de (u además de) Ollama.
- **`mcp-server/`**: este sí es parte del proyecto oficial upstream — un servidor MCP en Node/TypeScript que envuelve la API pública `/api/v1` de wacrm para que asistentes de IA (Claude Desktop/Code, Cursor) puedan operar el CRM en lenguaje natural (consultar conversaciones, contactos, enviar plantillas, etc.), respetando la autenticación/scopes de la propia API de wacrm.

## Modelo de datos

Ver documento dedicado **"Base de datos wacrm (Supabase)"** para el esquema completo (contactos, conversaciones, mensajes, pipelines, deals, automatizaciones, IA, etc.). El prototipo `rag/` mantiene además su propio almacén vectorial local en ChromaDB (`rag/chroma_db/`), separado de la base Postgres.

## Lógica de negocio

- La aplicación Next.js es la interfaz (bandeja compartida, contactos, pipelines, broadcasts, automatizaciones sin código) sobre el esquema documentado en la base de datos wacrm.
- Los prototipos `rag/` y `graphify_test/` son experimentos de IA para responder preguntas dentales combinando: (a) una base de conocimiento vectorial local, (b) un grafo de conocimiento construido a partir de documentos internos, (c) el diccionario de terminología dental de DentWeb12, y (d) el modelo Claude como razonador — actualmente no están en ejecución, por lo que no forman parte del flujo operativo activo, pero el código y los datos ya existen en el servidor.
- El servidor MCP (`mcp-server/`) permite, en teoría, operar el CRM completo desde un asistente de IA compatible con MCP, sin necesidad de tocar la UI web — útil como capa de automatización adicional sobre wacrm.

Regla no obvia: la app corre en modo desarrollo (`next dev`), no en modo producción (`next build && next start`) ni bajo un gestor de procesos — cualquier reinicio del servidor o cierre de la sesión de terminal donde se lanzó podría detenerla, ya que no hay una unidad systemd que la mantenga viva ni la reinicie automáticamente.

## Guía de soporte

| Síntoma | Comando | Interpretación | Acción |
|---|---|---|---|
| No se sabe si wacrm (la app) está corriendo | `ss -tlnp \| grep 3001` o `ps aux \| grep "next dev"` | Confirma si el proceso `next dev` sigue vivo en el puerto 3001 | Si no está, no hay una forma automática de reiniciarlo (no es un servicio systemd) — hay que relanzarlo manualmente desde `/home/ino/wacrm` (`npm run dev` o equivalente) |
| La app no carga o da error | Revisar la salida de la terminal/sesión donde se lanzó `next dev` | Los errores de Next.js en modo dev se imprimen directo en esa terminal, no en `journalctl` | Si la sesión se perdió, no hay logs persistentes — considerar migrar esto a un servicio systemd con build de producción |
| Duda sobre configuración (claves, URLs) | `grep -o "^[A-Z_]*=" /home/ino/wacrm/.env` | Lista los nombres de variables configuradas sin exponer valores | Confirmar que las variables esperadas (Supabase, Meta) estén presentes |
| Revisar si los prototipos de IA (`rag/`, `graphify_test/`) están activos | `ps aux \| grep -E "rag/api\|graphify_test/app"` | Si no aparecen, no están corriendo actualmente | Deben iniciarse manualmente (`python api.py` / `python app.py` dentro de sus respectivos `venv`) si se quieren probar |
| Ver qué modelo de IA usa el prototipo de grafo | Revisar `graphify_test/app.py` (`ANTHROPIC_MODEL`) | Confirma que usa Claude directamente (Anthropic API), no Ollama | Requiere una API key de Anthropic configurada para funcionar, distinta de las demás integraciones de este servidor |

## Documentos relacionados

- Base de datos wacrm / Supabase (Servidor IA) — esquema de datos completo consumido por esta app
- Docker (Servidor IA) — aloja el stack Supabase que esta app usa como backend
- Ollama (Servidor IA) — usado por otros servicios de IA de este servidor; este prototipo específico (`graphify_test`) usa Claude en su lugar
