import { createNetworkClient } from "../../../network/client";
import { createAgentAdminClient } from "./agent-admin-client";
import { createAgentClient } from "./agent-client";
import { createImprovementsClient } from "./improvements-client";
import { createPiClient } from "./pi-client";
import { resolveWorkspaceSubscription } from "./workspace-source";

/**
 * Clientes del shell.
 *
 * Se crean una vez por proceso, fuera de React: si vivieran dentro del
 * componente, cada render fabricaría clientes nuevos y con ellos nuevos
 * sondeos. Tenerlos aquí además deja a App sin trabajo de infraestructura.
 */
export const piClient = createPiClient();
export const agentClient = createAgentClient();
export const agentAdminClient = createAgentAdminClient();
export const improvementsClient = createImprovementsClient();
export const networkClient = createNetworkClient();

/*
 * Empuje del escritorio activo desde el compositor. Se resuelve una sola vez:
 * si el puente aún no existe, la barra sigue funcionando con la lectura HTTP.
 */
export const workspaceSubscription = resolveWorkspaceSubscription(agentClient);
