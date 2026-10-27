import { sumPower } from './modulargrid';
import { rowGaps } from './placement';
import type { AppState, CaseItem, ModuleItem } from './types';

function describeModule(m: ModuleItem) {
  const parts = [m.name, m.vendor, m.description].filter(Boolean).join(' — ');
  const specs = [`${m.hp}HP`];
  if (m.depth) specs.push(`${m.depth}mm deep`);
  specs.push(`+12V ${m.power.plus12}mA / −12V ${m.power.minus12}mA${m.power.plus5 ? ` / 5V ${m.power.plus5}mA` : ''}`);
  if (m.is1u) specs.push('1U (cannot be placed in 3U rows)');
  return `${parts} (${specs.join(', ')})${m.locked ? ' [LOCKED]' : ''}`;
}

function describeRow(c: CaseItem, row: number, modules: ModuleItem[]) {
  const entries = [
    ...modules
      .filter((m) => m.placement!.row === row)
      .map((m) => ({ col: m.placement!.col, line: `- HP ${m.placement!.col}–${m.placement!.col + m.hp - 1}: ${describeModule(m)}` })),
    ...rowGaps(modules, c, row).map((g) => ({ col: g.col, line: `- HP ${g.col}–${g.col + g.hp - 1}: empty (${g.hp}HP)` })),
  ].sort((a, b) => a.col - b.col);
  return [`Row ${row}:`, ...entries.map((e) => e.line)].join('\n');
}

/**
 * Plain-text description of the whole canvas for the LLM. Empty gaps are spelled
 * out so the model doesn't have to do HP arithmetic to find free space.
 */
export function summarizeLayout(state: AppState, selectedId?: string | null): string {
  const out: string[] = [
    '# Current layout',
    'HP columns are 1-indexed from the left edge of each row. Every row is a 3U Eurorack row.',
    'Canvas positions are in pixels (10px = 1HP); larger x is further right, larger y is further down.',
    'Modules marked [LOCKED] are fixed in place by the user and must not be moved.',
  ];

  if (state.cases.length === 0) out.push('', 'There are no cases yet.');
  for (const c of state.cases) {
    const modules = state.modules.filter((m) => m.placement?.caseId === c.id);
    const used = modules.reduce((n, m) => n + m.hp, 0);
    const power = sumPower(modules);
    out.push(
      '',
      `## Case "${c.name}": ${c.rows} row(s) × ${c.hp}HP, canvas position (${c.x}, ${c.y}), ${used}/${c.rows * c.hp}HP used`,
      `Total draw: +12V ${power.plus12}mA, −12V ${power.minus12}mA, 5V ${power.plus5}mA`,
    );
    for (let row = 1; row <= c.rows; row++) out.push(describeRow(c, row, modules));
  }

  const tray = state.modules.filter((m) => !m.placement);
  out.push('', '## Tray (owned but not placed in any case)');
  out.push(tray.length ? tray.map((m) => `- ${describeModule(m)}`).join('\n') : 'Empty.');

  const selected = state.modules.find((m) => m.id === selectedId);
  if (selected) {
    const p = selected.placement;
    const c = p && state.cases.find((x) => x.id === p.caseId);
    const where = p && c ? `case "${c.name}", row ${p.row}, HP ${p.col}–${p.col + selected.hp - 1}` : 'the tray';
    out.push('', `The user currently has "${selected.name}" selected (in ${where}).`);
  }
  return out.join('\n');
}
