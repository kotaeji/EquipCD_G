import { createContext, useContext } from 'react';
import type { ConfirmStamp } from '../model/confirmationLog';

/** `undefined` applies the edit without a confirmation row (no provider, or a non-confirming edit). */
export type ConfirmationRunner = (stamp: ConfirmStamp | undefined) => void;
export type ConfirmationGateFn = (run: ConfirmationRunner) => void;

export const ConfirmationGate = createContext<ConfirmationGateFn>((run) => run(undefined));

export function useConfirmationGate(): ConfirmationGateFn {
  return useContext(ConfirmationGate);
}
