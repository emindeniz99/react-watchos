import type { HostMethod } from "../codegen/schema.mjs";

/** Gateable features a target's binary provides (its host methods' features,
 *  excluding the always-present "core"). */
export function providedFeatures(
  hostMethods: HostMethod[],
  schemaTarget: string,
): Set<string>;

/** Declared features the target's binary does NOT provide — empty = runnable. */
export function unprovidedFeatures(
  declared: string[] | undefined,
  hostMethods: HostMethod[],
  schemaTarget: string,
): string[];
