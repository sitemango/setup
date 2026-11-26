/** Dated FA-II notice, Sem-I 2026–27. This is not a recurring class timetable. */
const row = (date, weekday, name, code, marks, time = 'As instructed by Course teacher') => ({ date, weekday, name, code, marks, time });
const mon = (name, code, marks) => row('2026-11-30', 'Monday', name, code, marks);
const tue = (name, code, marks) => row('2026-12-01', 'Tuesday', name, code, marks);
const wed = (name, code, marks) => row('2026-12-02', 'Wednesday', name, code, marks);
const thu = (name, code, marks, time) => row('2026-12-03', 'Thursday', name, code, marks, time);
const fri = (name, code, marks, time) => row('2026-12-04', 'Friday', name, code, marks, time);
const evening = '5:00–6:00 PM';
const shared = {
  A: [tue('Indian Knowledge System', 'BSH31IK01', 25), wed('Constitution of India', 'BSH31VE01', 25), thu('Linear Algebra & Univariate', 'BSH31BS01', 20, evening)],
  B: [tue('Constitution of India', 'BSH31VE01', 25), thu('Engineering Physics', 'BSH31BS03', 20, evening), fri('Linear Algebra & Univariate', 'BSH31BS01', 20, evening)],
};

export const FA_II_BRANCHES = {
  A: {
    'Mechanical Engineering': [mon('Fundamentals of Electromechanical Systems', 'BME31ES02', 10), mon('Engineering Chemistry', 'BSH31BS06', 20), tue('Engineering Graphics', 'BME31PC01', 20), fri('Basic Mechanical Engineering', 'BME31ES02', 20)],
    'Electronics and Telecommunication': [mon('Fundamentals of Electrical Engineering', 'BET31ES01', 20), mon('Engineering Chemistry', 'BSH31BS08', 20), fri('Programming for Problem Solving', 'BET31ES02', 10)],
    VLSI: [mon('Fundamentals of Electrical Engineering', 'BEE31ES01', 20), mon('Engineering Chemistry', 'BSH31BS08', 20), fri('Programming for Problem Solving', 'BEE31ES02', 10)],
    Civil: [mon('Engineering Mechanics', 'BCI31ES01', 20), mon('Engineering Chemistry', 'BSH31BS06', 20), fri('Elements of Civil Engineering', 'BCI31ES02', 20)],
    'Civil (RL)': [mon('Engineering Mechanics', 'BCIR31ES01', 20), mon('Engineering Chemistry', 'BSH31BS06', 20), fri('Elements of Civil Engineering', 'BCIR31ES02', 20)],
  },
  B: {
    Comp: [mon('Computational Thinking and Problem Solving', 'BCE31ES01', 10), wed('Digital Electronics and Computer Organization', 'BCE31ES02', 20)],
    'Comp (RL)': [mon('Computational Thinking and Problem Solving', 'BCER31ES01', 10), wed('Digital Electronics and Computer Organization', 'BCER31ES02', 20)],
    'Information Technology': [mon('Discrete Mathematics', 'BIT31ES02', 20), wed('Digital Electronics and Logic Design', 'BIT31ES01', 10)],
    'CSE AIML': [mon('Discrete Mathematics', 'BCS31ES01', 20), wed('Digital Electronics and Logic Design', 'BCS31ES02', 10)],
  },
};

export function faIIRows(group, branch) {
  const specific = FA_II_BRANCHES[group]?.[branch];
  if (!specific) return [];
  // Shared entries precede specific entries on the same date (notably IKS / EG).
  return [...shared[group], ...specific].sort((a, b) => a.date.localeCompare(b.date));
}

/** Only map profile labels that identify one notice branch, never generic Civil/Comp. */
export function faIIPreselection(branch) {
  const mapping = {
    'Mechanical Engineering': ['A', 'Mechanical Engineering'],
    'Electronics & Telecommunication': ['A', 'Electronics and Telecommunication'],
    'Electronics and Telecommunication': ['A', 'Electronics and Telecommunication'],
    VLSI: ['A', 'VLSI'],
    'Civil (RL)': ['A', 'Civil (RL)'],
    'Comp (RL)': ['B', 'Comp (RL)'],
    'Information Technology': ['B', 'Information Technology'],
    'AI & ML': ['B', 'CSE AIML'],
    'CSE AIML': ['B', 'CSE AIML'],
  };
  return mapping[branch] || null;
}
