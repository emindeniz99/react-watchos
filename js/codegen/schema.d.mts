export interface HostArg {
  name: string;
  type: "string" | "int" | "double";
}
export interface HostMethod {
  name: string;
  targets: string[];
  feature?: string;
  since?: number;
  /** When "invoke", the method is dispatched through the generic invoke channel
   *  rather than installed as its own host function (SD-1). */
  via?: "invoke";
  /** Signature (CX-023): the whole synchronous bridge is generated from these.
   *  Direct methods only — `via:"invoke"` methods carry none. */
  args?: HostArg[];
  returns?: "void" | "string?" | "int";
  /** Non-optional in the generated TS QuickJSHostGlobal (commit/log/setTimer). */
  tsRequired?: boolean;
  /** Doc comment carried to the generated TS interface. */
  doc?: string;
}
export const hostMethods: HostMethod[];
/** Host bridge protocol version (ARCH-01), stamped into the OTA manifest. */
export const bridgeProtocol: number;
export interface Component {
  name: string;
  widget: "full" | "degraded";
}
export const components: Component[];
export const node: { swift: string; ts: string };
export const structs: unknown[];
export const tsOnly: unknown[];
