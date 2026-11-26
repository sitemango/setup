// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import FaIISchedule from '@/components/timetable/FaIISchedule';
import { FA_II_BRANCHES, faIIPreselection, faIIRows } from '@/lib/timetable/fa-ii-2026-27-sem1';

const change = async (element, value) => {
  await act(async () => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); });
};
let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ''; root = null; });

describe('FA-II notice', () => {
  it('contains nine branches and 51 ordered dated rows with the correct shared algebra', () => {
    let count = 0;
    expect(Object.values(FA_II_BRANCHES).flatMap(Object.keys)).toHaveLength(9);
    for (const group of ['A', 'B']) for (const branch of Object.keys(FA_II_BRANCHES[group])) {
      const rows = faIIRows(group, branch);
      expect(rows).toHaveLength(branch === 'Mechanical Engineering' ? 7 : group === 'A' ? 6 : 5);
      expect(rows.map((r) => r.date)).toEqual(rows.map((r) => r.date).sort());
      expect(rows.find((r) => r.code === 'BSH31BS01')).toMatchObject({ date: group === 'A' ? '2026-12-03' : '2026-12-04', time: '5:00–6:00 PM' });
      count += rows.length;
    }
    expect(count).toBe(51);
    const mech = faIIRows('A', 'Mechanical Engineering');
    expect(mech.filter((r) => r.code === 'BME31ES02').map((r) => r.name)).toEqual(['Fundamentals of Electromechanical Systems', 'Basic Mechanical Engineering']);
    expect(mech.filter((r) => r.date === '2026-12-01').map((r) => r.name)).toEqual(['Indian Knowledge System', 'Engineering Graphics']);
    expect(faIIRows('A', 'Comp')).toEqual([]);
  });
  it('preselects only unambiguous profile branches', () => {
    expect(faIIPreselection('Information Technology')).toEqual(['B', 'Information Technology']);
    expect(faIIPreselection('Computer Engineering')).toBeNull();
    expect(faIIPreselection('Civil Engineering')).toBeNull();
  });
  it('replaces rows when switching branches and clears them when switching groups', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(React.createElement(FaIISchedule, { initialSelection: ['A', 'Mechanical Engineering'] })));
    expect(container.textContent).toContain('BME31ES02');
    const [group, branch] = container.querySelectorAll('select');
    await change(branch, 'Civil');
    expect(container.textContent).toContain('BCI31ES01');
    expect(container.textContent).not.toContain('BME31ES02');
    await change(group, 'B');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
    await change(branch, 'Comp (RL)');
    expect(container.textContent).toContain('BCER31ES01');
    expect(container.textContent).not.toContain('BCI31ES01');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5);
  });
});
