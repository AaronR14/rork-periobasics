# PerioBasics

App educativa de periodoncia. Frontend Expo/React Native, backend Cloudflare Worker, Supabase como base de datos y autenticación.

## Arquitectura

- **Frontend** (`expo/`): Expo/React Native, Expo Router. Desplegado y gestionado a través de **Rork** (plataforma que también edita el código vía su propio chat/editor — ver "Restricciones del entorno" abajo).
- **Backend** (`functions/index.ts`): un único Cloudflare Worker, también desplegado vía Rork. Expone endpoints REST consumidos por el frontend (`/chat`, `/progress-assessment`, `/generate-quiz`, `/evaluate-answer`, `/session-title`, `/video`, `/videos`, `/suggest-video`, `/thumb`, `/classify-transcripts`).
- **Supabase**: autenticación (Google OAuth) y base de datos (progreso del estudiante, sesiones de chat, intentos de quiz, tabla `admins`). No hay migraciones versionadas en el repo — el esquema real solo existe en el proyecto de Supabase.
- **Bunny**: hosting y CDN de los videos del curso (`video.bunnycdn.com` para la API de administración, dominio `*.b-cdn.net` para el CDN de las miniaturas/streaming).
- **Gemini** (Google AI Studio): modelo detrás del tutor de IA, generación de quizzes, y evaluación de respuestas — todas las llamadas ocurren server-side en `functions/index.ts`, nunca desde el cliente.

## Decisiones de seguridad (2026-07-17)

- **Todos los endpoints del backend que devuelven datos de un usuario específico o cuestan dinero (llamadas a Gemini) verifican el token de sesión de Supabase** vía `verifySupabaseUser()` en `functions/index.ts`. La URL de Supabase usada para verificar viene siempre de variables de entorno del servidor, nunca de un header enviado por el cliente (evita que alguien apunte la verificación a un servidor falso).
- **`/classify-transcripts`** (endpoint de mantenimiento, no debe llamarse desde la app) requiere que el usuario esté en la tabla `public.admins` de Supabase — **no** usa un secret de Cloudflare (`ADMIN_API_KEY`), porque no hay acceso directo a la configuración de variables de entorno de Cloudflare del lado de Rork. La tabla `admins` tiene RLS: un usuario autenticado solo puede leer si su propia fila existe ahí; no hay política de `INSERT`/`UPDATE` desde el cliente — el rol de admin se otorga manualmente desde el SQL Editor de Supabase.
- **Rate limiting best-effort, en memoria**, en los endpoints que llaman a Gemini (20/min, 300/día por usuario). No es una garantía dura: el contador vive en la memoria del Worker y se reinicia cada vez que Cloudflare recicla la instancia (idle eviction, redeploys, escalado) — el límite diario es el más afectado por esto. No se usó Cloudflare Rate Limiting / KV / Durable Objects porque requieren configuración en el dashboard de Cloudflare, al que no hay acceso directo.
- **`/thumb`** valida que la URL de destino pertenezca al dominio `b-cdn.net` de Bunny antes de reenviarla — antes era un proxy abierto a cualquier URL http(s).
- **Login obligatorio con Google** al abrir la app (sin sesión anónima) — `AuthGate` en `expo/app/_layout.tsx` bloquea toda ruta hasta que exista una sesión. La sesión se persiste vía `expo/lib/secure-storage.ts` (keychain/keystore en nativo, `localStorage` en web) — antes se usaba `AsyncStorage` sin cifrar.
- Todas las llamadas del frontend a los endpoints protegidos mandan `Authorization: Bearer <token>` usando `getValidAccessToken()` (`expo/lib/supabase.ts`).

## Restricciones del entorno

- **No hay acceso directo al dashboard de Cloudflare de Rork** (secrets, bindings, Rate Limiting Rules, KV, Durable Objects). Cualquier solución que requiera configurar algo ahí necesita una alternativa (tabla en Supabase, variable de entorno vía Rork Integrations) o hay que preguntar primero — no asumir que se puede configurar directamente.
- El despliegue de `functions/index.ts` y de la app lo gestiona Rork automáticamente al hacer push a `main` (confirmado empíricamente: un push a `main` se refleja en producción sin pasos manuales adicionales).
- El editor propio de Rork también puede commitear directamente a `main` (commits tipo "New version from Rork") — verificar con `git fetch` antes de asumir que `main` local está al día.
- Para pruebas locales del backend contra Supabase real sin tocar producción: `cd functions && npx wrangler dev --port 8787`, con un `functions/.dev.vars` (gitignored) con `SUPABASE_URL`/`SUPABASE_ANON_KEY`. Dejar `GOOGLE_AI_STUDIO_KEY`/`BUNNY_ACCESS_KEY` sin definir ahí es útil: cualquier llamada que pase la verificación de sesión pero necesite esas llaves falla rápido y gratis (500 controlado), en vez de gastar cuota real.

## Pendientes conocidos

- **Login de Google en Android sin verificar** — confirmado funcionando de punta a punta en iOS (Expo Go + QR oficial de Rork, 2026-07-17); Android usa un mecanismo de redirect distinto (Chrome Custom Tabs vs. `ASWebAuthenticationSession`) y no se ha probado.
- **"Sign in with Apple" pendiente** — Apple lo exige como alternativa en cuanto la app se distribuya a testers externos de TestFlight o a la App Store (no aplica con testers internos únicamente). El plumbing ya soporta `provider: "apple"` en `useAuth().signIn()`; solo falta el botón en `expo/components/LoginScreen.tsx`. TODO documentado junto a `signIn()` en `expo/hooks/useAuth.tsx`.
- **Sistema de calificaciones falsificable desde el cliente** — las respuestas correctas de los quizzes viajan en el bundle de la app (`expo/data/quizzes.ts`), y tanto la nota del quiz como los eventos de competencia del chat se insertan directo a Supabase desde el cliente sin que el servidor los vuelva a validar. No se corrigió en la sesión de seguridad del 2026-07-17 — queda como tarea aparte.
- **Bug preexistente en `expo/app/index.tsx`**: hooks de React (`useState`, `useRef`, `useCallback`, `useEffect`) declarados después de un `return` condicional (`if (!params.videoId) return <Redirect .../>`), violando las reglas de hooks (22 errores de `react-hooks/rules-of-hooks` en `expo lint`). No causado por el trabajo de seguridad; no se corrigió porque estaba fuera de alcance.
- Sin migraciones de Supabase versionadas en el repo — el esquema real (tablas, RLS, funciones RPC como `recalculate_progress`) solo existe en el proyecto de Supabase, no hay forma de reconstruirlo desde el código.
