/**
 * Entry models for the Strategy Lab.
 *
 * The point of the lab is to answer the question the trader cannot answer by
 * intuition: does waiting for more confirmation actually pay, or does it just
 * cost fills? Each model is a different amount of evidence demanded before the
 * entry triggers at the same location.
 */

export type EntryModelId = 'A' | 'B' | 'C' | 'D';

export interface EntryModel {
  id: EntryModelId;
  name: string;
  description: string;
  /** Entry fires as soon as price enters the zone. */
  requiresZoneTouch: true;
  /** A candle must react out of the zone before entry. */
  requiresReaction: boolean;
  /** A structure break must precede the FVG. */
  requiresStructureBreak: boolean;
  /** A further continuation break must print after the retracement. */
  requiresSecondBreak: boolean;
}

export const ENTRY_MODELS: Record<EntryModelId, EntryModel> = {
  A: {
    id: 'A',
    name: 'FVG touch',
    description:
      'Limit entry the moment price trades into the fresh FVG. Most fills, least confirmation. Included as the baseline to measure the others against — not as a recommended way to trade.',
    requiresZoneTouch: true,
    requiresReaction: false,
    requiresStructureBreak: false,
    requiresSecondBreak: false,
  },
  B: {
    id: 'B',
    name: 'FVG + LTF reaction',
    description:
      'Wait for a rejection or decisive close out of the zone before entering.',
    requiresZoneTouch: true,
    requiresReaction: true,
    requiresStructureBreak: false,
    requiresSecondBreak: false,
  },
  C: {
    id: 'C',
    name: 'FVG + structure break',
    description:
      'The zone must have been created by the leg that broke structure, and price must react out of it.',
    requiresZoneTouch: true,
    requiresReaction: true,
    requiresStructureBreak: true,
    requiresSecondBreak: false,
  },
  D: {
    id: 'D',
    name: 'FVG + structure break + second continuation break',
    description:
      'As C, plus a further continuation break after the retracement. Fewest trades, most evidence.',
    requiresZoneTouch: true,
    requiresReaction: true,
    requiresStructureBreak: true,
    requiresSecondBreak: true,
  },
};

export const ENTRY_MODEL_IDS: EntryModelId[] = ['A', 'B', 'C', 'D'];
