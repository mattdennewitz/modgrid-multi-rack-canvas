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

export interface Placement {
  caseId: string;
  row: number;
  col: number;
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
  x: number;
  y: number;
}

export interface AppState {
  cases: CaseItem[];
  modules: ModuleItem[];
}
