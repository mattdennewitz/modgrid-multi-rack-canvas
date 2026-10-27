import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractUserId, parseCollectionHtml } from '../src/lib/parseCollection';
import { isValidSlug, parseModuleHtml } from '../src/lib/parseModule';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('extractUserId', () => {
  it('accepts urls and bare ids', () => {
    expect(extractUserId('https://modulargrid.net/s/users/view/254121')).toBe('254121');
    expect(extractUserId(' 254121 ')).toBe('254121');
    expect(extractUserId('https://modulargrid.net/e/racks/view/3246217')).toBeNull();
  });
});

describe('parseCollectionHtml', () => {
  const entries = parseCollectionHtml(fixture('user-254121.html'));

  it('reads every module in the collection', () => {
    expect(entries).toHaveLength(66);
    expect(entries[0]).toEqual({ slug: 'joranalogue-audio-design-step-8', name: 'Step 8' });
    expect(entries.at(-1)).toEqual({ slug: 'verbos-electronics-harmonic-oscillator', name: 'Harmonic Oscillator' });
  });

  it('decodes entities and keeps odd slugs intact', () => {
    expect(entries.find((e) => e.slug === 'make-noise-qmmg-black-gold')?.name).toBe('QMMG (Black & Gold)');
    expect(entries.find((e) => e.slug === 'make-noise-maths--')?.name).toBe('Maths');
    expect(entries.every((e) => isValidSlug(e.slug))).toBe(true);
  });

  it('rejects pages without a collection', () => {
    expect(() => parseCollectionHtml('<html></html>')).toThrow(/No collection/);
  });
});

describe('parseModuleHtml', () => {
  it('reads specs from a module page', () => {
    expect(parseModuleHtml(fixture('module-step-8.html'), 'joranalogue-audio-design-step-8')).toMatchObject({
      moduleId: '34886',
      name: 'Step 8',
      vendor: 'Joranalogue Audio Design',
      hp: 16,
      depth: 40,
      is1u: false,
      power: { plus12: 110, minus12: 45, plus5: 0 },
    });
  });

  it('flags 1U tiles', () => {
    expect(parseModuleHtml(fixture('module-fsr-1u.html'), 'intellijel-fsr-1u')).toMatchObject({
      name: 'FSR 1U',
      hp: 10,
      is1u: true,
    });
  });

  it('rejects unsafe slugs', () => {
    expect(isValidSlug('../etc/passwd')).toBe(false);
    expect(isValidSlug('a/b')).toBe(false);
  });
});
