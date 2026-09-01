# Selección del modelo de Pi

## Qué modelo usa Pi

`gpt-5.6-sol` con esfuerzo de razonamiento `low`, sobre la suscripción de Codex
(proveedor `openai-codex`, OAuth). Ambos valores viven en
`components/ui/dev/pi-harness.ts`:

```ts
export const DEFAULT_PI_MODEL_PREFERENCE = ["gpt-5.6-sol", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"];
export const DEFAULT_PI_THINKING_LEVEL = "low" as const;
```

La lista es una preferencia, no una imposición: `selectModel()` recorre los ids
en orden y se queda con el primero que exista en el registro de modelos.

## Por qué hace falta un catálogo propio

`selectModel()` solo puede elegir modelos que estén en `ModelRegistry`. El
registro se construía con `ModelRegistry.inMemory(authStorage)`, y `inMemory`
pasa `modelsJsonPath = undefined`: carga **únicamente** el catálogo compilado
dentro de `@mariozechner/pi-ai`.

Ese catálogo va por detrás de lo que sirve la suscripción. Ni siquiera la última
versión publicada (0.73.1) conoce `gpt-5.6-sol`: bajo `openai-codex` llega solo
hasta `gpt-5.5`. Con `inMemory`, pedir `gpt-5.6-sol` no daba ningún error —
simplemente no encontraba el id, seguía bajando por la lista y acababa en
`gpt-5.4`, que es lo que la interfaz mostraba con toda la razón.

Por eso el registro se crea ahora con `ModelRegistry.create(authStorage, path)` y
`writePiCustomModels()` deja en `<agentDir>/models.json` la definición de
`gpt-5.6-sol`. `mergeCustomModels` añade los ids nuevos al catálogo interno, así
que el modelo pasa a ser elegible. Como `openai-codex` es un proveedor built-in,
la definición no necesita `baseUrl` ni `apiKey`: hereda `api` y `baseUrl` del
proveedor y la autenticación sigue saliendo del OAuth de `AuthStorage`.

No declaramos `cost`: la suscripción no factura por token y es preferible dejar
ceros a inventarse un precio.

`models.json` se reescribe en cada arranque a propósito. El modelo de Pi es una
decisión de producto, no una preferencia del usuario, y así una imagen
actualizada converge sola en vez de quedarse con el fichero de la versión
anterior.

## El fallback ya no es mudo

Cuando el modelo preferido no está en el registro, `selectModel()` sigue cayendo
al siguiente disponible —dejar a Pi sin sesión porque OpenAI retire un modelo
sería peor— pero ahora lo avisa por consola.

Esta caída silenciosa ya había costado tiempo antes: `docs/audit/pi-learning-loop.md`
registra un `gpt-5.5-instant` pedido que acabó ejecutándose como `gpt-5.1` sin
que nada lo dijera.

La red de seguridad real es un test en `components/ui/dev/pi-harness.test.ts`,
que comprueba que **todos** los ids de `DEFAULT_PI_MODEL_PREFERENCE` existen en
el catálogo que el registro va a cargar (built-in + propios). Una entrada
fantasma no se nota en runtime, porque Pi sigue funcionando con otro modelo; ese
test es el único sitio donde salta.

## Cambiar de modelo

- Si el modelo ya está en el catálogo de `pi-ai`: basta con ponerlo primero en
  `DEFAULT_PI_MODEL_PREFERENCE`.
- Si no lo está: añadirlo también a `PI_CUSTOM_MODELS`. El catálogo real de la
  cuenta se puede consultar en `~/.codex/models_cache.json` (`slug`,
  `context_window`, `input_modalities`, `default_reasoning_level`).
- `AGENOS_PI_MODEL_ID` antepone un id a la lista en tiempo de ejecución, pero
  sigue estando sujeto a que el modelo exista en el registro.
