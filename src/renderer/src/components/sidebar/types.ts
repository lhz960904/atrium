import type { RouterOutputs } from '../../lib/trpc';

export type ThreadItem = RouterOutputs['threads']['list'][number];
export type ProjectItem = RouterOutputs['projects']['list'][number];
