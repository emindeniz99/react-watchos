import { invoke } from "./invoke";

/**
 * In-app purchase (StoreKit 2). Products and entitlements are resolved
 * natively; JS drives the flow. A watch app can sell consumables,
 * non-consumables, and subscriptions the same as iOS.
 *
 * All calls reject (INVOKE error) on a StoreKit failure — a declined purchase
 * resolves with `{ status: "userCancelled" }` rather than rejecting, so the UI
 * can distinguish "failed" from "user backed out".
 */
export interface IAPProduct {
  id: string;
  displayName: string;
  description: string;
  /** Localized price string, e.g. "$1.99". */
  displayPrice: string;
  /** Numeric price in the storefront currency. */
  price: number;
  type: "consumable" | "nonConsumable" | "autoRenewable" | "nonRenewable";
}

export interface PurchaseResult {
  status: "success" | "pending" | "userCancelled";
  /** The transaction's product id when status is "success". */
  productId?: string;
  /** Opaque transaction id, for your server to verify. */
  transactionId?: string;
}

/** Loads product metadata for the given identifiers (order not guaranteed;
 *  unknown ids are omitted). */
export function getProducts(productIds: string[]): Promise<IAPProduct[]> {
  return invoke<IAPProduct[]>("getProducts", { productIds });
}

/** Starts a purchase. A user cancel resolves `{ status: "userCancelled" }`;
 *  a StoreKit error rejects. */
export function purchase(productId: string): Promise<PurchaseResult> {
  return invoke<PurchaseResult>("purchase", { productId });
}

/** The product ids the user is currently entitled to (owned non-consumables +
 *  active subscriptions). */
export function currentEntitlements(): Promise<string[]> {
  return invoke<string[]>("currentEntitlements");
}

/** Restores previous purchases (syncs with the App Store); resolves with the
 *  refreshed entitlement id list. */
export function restorePurchases(): Promise<string[]> {
  return invoke<string[]>("restorePurchases");
}
