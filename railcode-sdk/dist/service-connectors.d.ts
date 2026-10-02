import type { ConnectorHandle, ServiceConnectorDocs, ServiceConnectorInfo } from "./types";
/** A handle scoped to one named connector: `connector('stripe')`. */
export declare const connector: (name: string) => ConnectorHandle;
/** The service connectors this app may call — its manifest-declared subset.
 * Name/kind/auth-type/methods + `has_docs`/`has_openapi`/`has_tools` hints;
 * never the credential. */
export declare const serviceConnectors: () => Promise<ServiceConnectorInfo[]>;
/** The docs bundle for one connector, so you (or an agent) learn how to call it.
 * A connector the manifest didn't declare is a 404, same as the list. */
export declare const serviceConnectorDocs: (name: string) => Promise<ServiceConnectorDocs>;
