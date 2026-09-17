/**
 * Guitar Pro 7 (.gp) and alphaTex export.
 *
 * alphaTab ships a Gp7 exporter, so this rides on the same Score model the
 * renderer and the player use - what you see is what lands in the file. The
 * import is dynamic so alphaTab stays out of the initial bundle.
 */

import type { Arrangement } from '../types';

export interface GuitarProStatus {
  available: boolean;
  reason: string;
}

export function guitarProStatus(): GuitarProStatus {
  return {
    available: true,
    reason: 'Guitar Pro 7 format (.gp). Opens in Guitar Pro 7/8 and in TuxGuitar 1.6+.',
  };
}

export async function toGuitarPro(a: Arrangement, title?: string): Promise<Blob> {
  const { toGuitarProBytes } = await import('../render/score');
  return new Blob([toGuitarProBytes(a, title) as BlobPart], { type: 'application/gp' });
}

export async function toAlphaTexSource(a: Arrangement, title?: string): Promise<string> {
  const { toAlphaTex } = await import('../render/score');
  return toAlphaTex(a, title);
}
