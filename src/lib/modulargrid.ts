import type { ModuleItem, Power } from './types';

const BASE = 'https://modulargrid.net';

/** ModularGrid's rack-sized panel render: 10px/HP x 255px at 1x. */
export function panelImageUrl(m: Pick<ModuleItem, 'moduleId' | 'versionId'>) {
  const id = m.versionId ? `${m.moduleId}_v${m.versionId}` : m.moduleId;
  return `${BASE}/img/modcache/${id}.r@2x.png`;
}

export function modulePageUrl(m: Pick<ModuleItem, 'slug'>) {
  return `${BASE}/e/${m.slug}`;
}

export function sumPower(modules: Pick<ModuleItem, 'power'>[]): Power {
  return modules.reduce(
    (acc, m) => ({
      plus12: acc.plus12 + m.power.plus12,
      minus12: acc.minus12 + m.power.minus12,
      plus5: acc.plus5 + m.power.plus5,
    }),
    { plus12: 0, minus12: 0, plus5: 0 },
  );
}
