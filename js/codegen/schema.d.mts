export interface HostMethod {
  name: string;
  targets: string[];
}
export const hostMethods: HostMethod[];
export const node: { swift: string; ts: string };
export const structs: unknown[];
export const tsOnly: unknown[];
