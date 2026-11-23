export interface Power {
  plus12: number;
  minus12: number;
  plus5: number;
}

/** A module as it appears in an imported ModularGrid rack. */
export interface ImportedModule {
  moduleId: string;
  versionId: string | null;
  name: string;
  vendor: string;
  description: string;
  slug: string;
  hp: number;
  /** Depth behind the panel in mm; 0 when unknown. */
  depth: number;
  is1u: boolean;
  power: Power;
  /** 1-indexed row within the source rack. */
  row: number;
  /** 1-indexed HP column within the source rack. */
  col: number;
  inBounds: boolean;
}

/** A module's specs without any rack position, e.g. from a module page. */
export type CollectionModule = Omit<ImportedModule, 'row' | 'col' | 'inBounds'>;

/** One entry on a ModularGrid user's public collection list. */
export interface CollectionEntry {
  slug: string;
  name: string;
}

export interface ImportedRack {
  id: string;
  name: string;
  format: string;
  rows: number;
  hp: number;
  modules: ImportedModule[];
}

export type RowType = '3U' | '1U';

/** Clockwise rotation of a panel in degrees. */
export type Rotation = 0 | 90 | 180 | 270;

export interface Placement {
  caseId: string;
  row: number;
  col: number;
  /** Missing means 0. */
  rotation?: Rotation;
}

export interface ModuleItem {
  id: string;
  moduleId: string;
  versionId: string | null;
  name: string;
  vendor: string;
  description: string;
  slug: string;
  hp: number;
  /** Depth behind the panel in mm; 0 or missing when unknown (older saves). */
  depth?: number;
  is1u: boolean;
  power: Power;
  /** Name of the rack this module was imported from. */
  source: string;
  /** null means the module is sitting in the tray. */
  placement: Placement | null;
  /** Locked modules can't be moved, removed or evicted. Only meaningful while placed. */
  locked?: boolean;
}

export interface CaseItem {
  id: string;
  name: string;
  rows: number;
  hp: number;
  /** One entry per row; missing means every row is 3U. */
  rowTypes?: RowType[];
  x: number;
  y: number;
}

/** A module record sitting in a case. Only ever found in `Canvas.placed`. */
export type PlacedModule = ModuleItem & { placement: Placement };

/** One rack configuration: every case and every placed copy on one canvas. */
export interface Canvas {
  id: string;
  name: string;
  /** The canvas this was forked from. Missing means a root of the lineage forest. */
  parentId?: string;
  /** Array order is z-order and hit-test priority, as `AppState.cases` was before canvases existed. */
  cases: CaseItem[];
  placed: PlacedModule[];
}

export interface AppState {
  /** Flat; the lineage forest is the `parentId` edges. Never empty. */
  canvases: Canvas[];
  /** The canvas you view and edit. Always names a canvas in `canvases`. */
  activeId: string;
  /** The bookmarked canvas: a label and a sibling sort key, nothing more. Always names a canvas. */
  primaryId: string;
  /** The global module pool: one record per module you own, every `placement` null. Shared by every canvas. */
  modules: ModuleItem[];
}

/** A save written before canvases existed: one canvas's cases, with the pool and placed copies mixed in `modules`. */
export interface LegacyAppState {
  cases: CaseItem[];
  modules: ModuleItem[];
}
