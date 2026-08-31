/**
 * Replaceable boundary #3 — INTERFACE ONLY.
 *
 * This is the future seam for Morrow (approved technical work execution).
 * It is NOT implemented, wired, or called anywhere in V0. Do not add an
 * implementation until the Morrow integration phase.
 */
export interface WorkOrder {
  opportunityId: string;
  clientId: string;
  scope: string[];
}

export interface ExecutionResult {
  workOrderId: string;
  status: "queued" | "in_progress" | "completed" | "failed";
  detail?: string;
}

export interface ExecutionProvider {
  submitWorkOrder(order: WorkOrder): Promise<ExecutionResult>;
  getResult(workOrderId: string): Promise<ExecutionResult>;
}
