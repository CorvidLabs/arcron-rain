/**
 * The read the create form does, exercised against real form elements.
 *
 * Every other test of that page reads the component as text, which is how a
 * hundred passing tests sat beside three dead controls: nothing built a form
 * and asked what came out of it. `gate`, `mode` and `prize` are all radio
 * groups, and all three read as '' until this landed.
 */

import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { fieldValue } from './form-values';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const globals = globalThis as Record<string, unknown>;
globals['document'] = dom.window.document;
globals['FormData'] = dom.window.FormData;
globals['HTMLInputElement'] = dom.window.HTMLInputElement;

const GROUPS: Record<string, readonly string[]> = {
  gate: ['corvid', 'open', 'custom'],
  mode: ['split', 'wave', 'one'],
  prize: ['algo', 'asa'],
};

function formWith(checked: Record<string, string>): HTMLFormElement {
  const form = dom.window.document.createElement('form');
  for (const [group, options] of Object.entries(GROUPS)) {
    for (const option of options) {
      const input = dom.window.document.createElement('input');
      input.type = 'radio';
      input.name = group;
      input.value = option;
      if (checked[group] === option) input.checked = true;
      form.appendChild(input);
    }
  }
  const label = dom.window.document.createElement('input');
  label.name = 'label';
  label.value = 'Stake';
  form.appendChild(label);
  return form as unknown as HTMLFormElement;
}

describe('fieldValue', () => {
  test('each radio group reports the option that is checked', () => {
    const form = formWith({ gate: 'corvid', mode: 'wave', prize: 'asa' });
    expect(fieldValue(form, 'gate')).toBe('corvid');
    expect(fieldValue(form, 'mode')).toBe('wave');
    expect(fieldValue(form, 'prize')).toBe('asa');
  });

  test('every option of every group survives a round trip', () => {
    for (const [group, options] of Object.entries(GROUPS)) {
      for (const option of options) {
        expect(fieldValue(formWith({ [group]: option }), group)).toBe(option);
      }
    }
  });

  test('a lone text input still reads', () => {
    expect(fieldValue(formWith({}), 'label')).toBe('Stake');
  });

  test('an absent field is empty rather than undefined', () => {
    expect(fieldValue(formWith({}), 'gateCreator')).toBe('');
  });

  test('nothing checked in a group is empty', () => {
    expect(fieldValue(formWith({}), 'gate')).toBe('');
  });

  test('namedItem, which this replaced, could not read a group at all', () => {
    // The defect itself, pinned. Delete `fieldValue` and go back to this and
    // the three assertions above stop describing the page.
    const form = formWith({ gate: 'corvid', mode: 'wave', prize: 'asa' });
    for (const group of Object.keys(GROUPS)) {
      const field = form.elements.namedItem(group);
      expect(field instanceof dom.window.HTMLInputElement).toBe(false);
    }
    expect(form.elements.namedItem('label') instanceof dom.window.HTMLInputElement).toBe(true);
  });
});
