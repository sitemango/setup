'use client';

import { useState } from 'react';
import { FA_II_BRANCHES, faIIRows } from '@/lib/timetable/fa-ii-2026-27-sem1';

export default function FaIISchedule({ initialSelection }) {
  const [group, setGroup] = useState(initialSelection?.[0] || '');
  const [branch, setBranch] = useState(initialSelection?.[1] || '');
  const rows = faIIRows(group, branch);

  return (
    <section className="fa-island mt-8" aria-labelledby="fa-schedule-heading">
      <div className="fa-island__heading">
        <div>
          <p className="fa-island__eyebrow">FA-II · SEM-I 2026–27</p>
          <h2 id="fa-schedule-heading" className="fa-island__title">Assessment schedule</h2>
          <p className="fa-island__description">Choose your group and branch to view your assessments.</p>
        </div>
        <span className="fa-island__date">30 NOV — 04 DEC</span>
      </div>
      <div className="fa-filters mt-4">
        <label>Group
          <select value={group} onChange={(event) => { setGroup(event.target.value); setBranch(''); }}>
            <option value="">Choose a group</option><option value="A">Group A</option><option value="B">Group B</option>
          </select>
        </label>
        <label>Branch
          <select value={branch} disabled={!group} onChange={(event) => setBranch(event.target.value)}>
            <option value="">Choose a branch</option>
            {Object.keys(FA_II_BRANCHES[group] || {}).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>
      {rows.length ? (
        <div className="fa-table-wrap mt-6">
          <table className="fa-table">
            <caption>{branch} · Group {group}</caption>
            <thead><tr><th scope="col">Sr. no.</th><th scope="col">Course name</th><th scope="col">Course code</th><th scope="col">Completion date &amp; weekday</th><th scope="col">Time</th><th scope="col">Marks</th></tr></thead>
            <tbody>{rows.map((entry, index) => <tr key={`${entry.date}-${index}`}>
              <td data-label="Sr. no.">{index + 1}</td><td data-label="Course name">{entry.name}</td><td data-label="Course code">{entry.code}</td><td data-label="Completion date & weekday"><time dateTime={entry.date}>{entry.date} · {entry.weekday}</time></td><td data-label="Time">{entry.time}</td><td data-label="Marks">{entry.marks}</td>
            </tr>)}</tbody>
          </table>
        </div>
      ) : <p className="fa-empty mt-6">Choose a group and branch to see its assessments.</p>}
    </section>
  );
}
