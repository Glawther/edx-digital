/**
 * EDX Digital - The week's agenda
 * Tasks laid out by day, and the way out to a calendar the person already uses: a link that
 * opens Google Agenda with the event filled in, and a file (.ics) any calendar imports.
 * Pure functions. Tests: tests/unit/agenda.test.mjs
 */

const pad = (n) => String(n).padStart(2, '0');
const dateText = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * The seven days of a week, Monday first
 * @param {number} offset - 0 for the current week, -1 for the one before, 1 for the next
 * @returns {Array<{date: string, weekday: string, label: string, isToday: boolean}>}
 */
export function weekDays(now = new Date(), offset = 0) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + offset * 7);
  const today = dateText(now);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
    const date = dateText(day);
    return {
      date,
      weekday: ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'][index],
      label: `${pad(day.getDate())}/${pad(day.getMonth() + 1)}`,
      isToday: date === today
    };
  });
}

/** "12 a 18 de outubro" or "28 de setembro a 4 de outubro" */
export function weekTitle(days) {
  const month = (date) => new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long' });
  const first = days[0];
  const last = days[6];
  const dayOf = (day) => Number(day.date.slice(8));
  return month(first.date) === month(last.date)
    ? `${dayOf(first)} a ${dayOf(last)} de ${month(last.date)}`
    : `${dayOf(first)} de ${month(first.date)} a ${dayOf(last)} de ${month(last.date)}`;
}

/**
 * The tasks of each day of the week, by time; the ones without a time come last
 * @returns {Object<string, Array>} date -> tasks
 */
export function tasksByDay(tasks, days) {
  const byDay = Object.fromEntries(days.map(day => [day.date, []]));
  for (const task of tasks || []) {
    if (task.dueDate && byDay[task.dueDate]) byDay[task.dueDate].push(task);
  }
  for (const list of Object.values(byDay)) {
    list.sort((a, b) => Number(Boolean(a.completed)) - Number(Boolean(b.completed)) ||(a.dueTime || '99:99').localeCompare(b.dueTime || '99:99') || String(a.title).localeCompare(String(b.title)));
  }
  return byDay;
}

const validTime = (time) => /^\d{2}:\d{2}$/.test(String(time || ''));
const compact = (date) => date.replace(/-/g, '');

function nextDay(date) {
  const day = new Date(date + 'T12:00:00');
  day.setDate(day.getDate() + 1);
  return dateText(day);
}

/** Start and end as calendars write them: a half-hour slot, or the whole day when there is no time */
function span(task) {
  if (!validTime(task.dueTime)) return { allDay: true, start: compact(task.dueDate), end: compact(nextDay(task.dueDate)) };
  const [hour, minute] = task.dueTime.split(':').map(Number);
  const end = new Date(`${task.dueDate}T12:00:00`);
  end.setHours(hour, minute + 30, 0, 0);
  return {
    allDay: false,
    start: `${compact(task.dueDate)}T${pad(hour)}${pad(minute)}00`,
    end: `${compact(dateText(end))}T${pad(end.getHours())}${pad(end.getMinutes())}00`
  };
}

const describe = (task) => [task.customerName, task.customerCompany].filter(Boolean).join(', ');

/** The address that opens Google Agenda with this task already written as an event */
export function googleCalendarUrl(task) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(task.dueDate || ''))) return '';
  const { start, end } = span(task);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: describe(task) ? `${task.title} (${task.customerName})` : String(task.title),
    dates: `${start}/${end}`,
    details: describe(task) ? `Tarefa do EDX Digital para ${describe(task)}.` : 'Tarefa do EDX Digital.'
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

// Text inside a calendar file: these four characters have a meaning of their own there
const icsText = (value) => String(value ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

// Lines longer than 75 bytes continue on the next one, which starts with a space
function fold(line) {
  const parts = [];
  let rest = line;
  while (rest.length > 73) {
    parts.push(rest.slice(0, 73));
    rest = ' ' + rest.slice(73);
  }
  parts.push(rest);
  return parts.join('\r\n');
}

/**
 * The pending tasks as a calendar file. Times are "floating": 14:00 is 14:00 wherever it is opened.
 */
export function tasksToIcs(tasks, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EDX Digital//Tarefas//PT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const task of tasks || []) {
    if (task.completed || !/^\d{4}-\d{2}-\d{2}$/.test(String(task.dueDate || ''))) continue;
    const { allDay, start, end } = span(task);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${String(task.id).replace(/[^A-Za-z0-9_-]/g, '')}@edx-digital`,
      `DTSTAMP:${stamp}`,
      allDay ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`,
      allDay ? `DTEND;VALUE=DATE:${end}` : `DTEND:${end}`,
      `SUMMARY:${icsText(describe(task) ? `${task.title} (${task.customerName})` : task.title)}`,
      ...(describe(task) ? [`DESCRIPTION:${icsText(`Tarefa do EDX Digital para ${describe(task)}.`)}`] : []),
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
