/**
 * Legacy error helpers for account-control - re-exports from consolidated error-utils
 * @deprecated Use error-utils-consolidated.ts directly
 */

export * from "../../helpers/error-utils-consolidated"

// Export specific legacy names that might differ
export { expectRevert as expectRevertAny } from "../../helpers/error-utils-consolidated"
export { expectCustomErrorWithArgs as expectCustomError } from "../../helpers/error-utils-consolidated"
