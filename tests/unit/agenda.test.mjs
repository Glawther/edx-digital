/**
 * Agenda da semana e a saída para outros calendários.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekDays, weekTitle, tasksByDay, googleCalendarUrl, tasksToIcs } from '../../js/core/agenda.js';

const SATURDAY = new Date(2026, 9, 10, 15, 0, 0); // sábado, 10 de outubro de 2026

test('a semana começa na segunda e marca o dia de hoje', () => {
  const days = weekDays(SATURDAY);
  assert.deepEqual(days.map(day => day.date), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  assert.deepEqual([days[0].weekday, days[6].weekday, days[5].label], ['Segunda', 'Domingo', '10/10']);
  assert.deepEqual(days.filter(day => day.isToday).map(day => day.date), ['2026-10-10']);
  // num domingo, a semana é a que termina nele
  assert.equal(weekDays(new Date(2026, 9, 11))[0].date, '2026-10-05');
  assert.equal(weekDays(new Date(2026, 9, 12))[0].date, '2026-10-12');
});

test('semana anterior, seguinte, e o título quando ela atravessa o mês', () => {
  assert.equal(weekDays(SATURDAY, 1)[0].date, '2026-10-12');
  assert.equal(weekDays(SATURDAY, -1)[0].date, '2026-09-28');
  assert.equal(weekTitle(weekDays(SATURDAY)), '5 a 11 de outubro');
  assert.equal(weekTitle(weekDays(SATURDAY, -1)), '28 de setembro a 4 de outubro');
  assert.equal(weekDays(SATURDAY, 1).some(day => day.isToday), false);
});

test('as tarefas caem no dia certo, por horário, as sem horário por último e as concluídas no fim', () => {
  const tasks = [
    { id: 'a', title: 'Sem hora', dueDate: '2026-10-07' },
    { id: 'b', title: 'Tarde', dueDate: '2026-10-07', dueTime: '15:00' },
    { id: 'c', title: 'Manhã', dueDate: '2026-10-07', dueTime: '09:00' },
    { id: 'd', title: 'Feita cedo', dueDate: '2026-10-07', dueTime: '08:00', completed: true },
    { id: 'e', title: 'Outra semana', dueDate: '2026-10-20' },
    { id: 'f', title: 'Sem data' }
  ];
  const byDay = tasksByDay(tasks, weekDays(SATURDAY));
  assert.deepEqual(byDay['2026-10-07'].map(task => task.id), ['c', 'b', 'a', 'd']);
  assert.deepEqual(byDay['2026-10-08'], []);
  assert.equal(Object.values(byDay).flat().length, 4);
});

test('o link do Google Agenda leva o título, o cliente e o horário; sem horário, o dia inteiro', () => {
  const timed = new URL(googleCalendarUrl({ title: 'Ligar & confirmar', dueDate: '2026-10-07', dueTime: '14:45', customerName: 'Ana Lima', customerCompany: 'Loja' }));
  assert.equal(timed.origin + timed.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(timed.searchParams.get('text'), 'Ligar & confirmar (Ana Lima)');
  assert.equal(timed.searchParams.get('dates'), '20261007T144500/20261007T151500');
  assert.equal(timed.searchParams.get('details'), 'Tarefa do EDX Digital para Ana Lima, Loja.');

  const allDay = new URL(googleCalendarUrl({ title: 'Visita', dueDate: '2026-10-31' }));
  assert.equal(allDay.searchParams.get('dates'), '20261031/20261101');
  // perto da meia-noite o fim cai no dia seguinte
  assert.equal(new URL(googleCalendarUrl({ title: 'x', dueDate: '2026-12-31', dueTime: '23:50' })).searchParams.get('dates'), '20261231T235000/20270101T002000');
  assert.equal(googleCalendarUrl({ title: 'Sem data' }), '');
});

test('o arquivo de calendário leva só as tarefas pendentes com data, com o texto protegido', () => {
  const ics = tasksToIcs([
    { id: 'task-1', title: 'Ligar; confirmar, hoje', dueDate: '2026-10-07', dueTime: '09:30', customerName: 'Ana', customerCompany: 'Loja' },
    { id: 'task-2', title: 'Dia inteiro', dueDate: '2026-10-08' },
    { id: 'task-3', title: 'Já feita', dueDate: '2026-10-08', completed: true },
    { id: 'task-4', title: 'Sem data' }
  ], new Date(Date.UTC(2026, 9, 10, 18, 0, 0)));
  const lines = ics.split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines.at(-2), 'END:VCALENDAR');
  assert.equal(lines.filter(line => line === 'BEGIN:VEVENT').length, 2);
  assert.ok(lines.includes('UID:task-1@edx-digital'));
  assert.ok(lines.includes('DTSTAMP:20261010T180000Z'));
  assert.ok(lines.includes('DTSTART:20261007T093000'));
  assert.ok(lines.includes('DTEND:20261007T100000'));
  assert.ok(lines.includes('SUMMARY:Ligar\\; confirmar\\, hoje (Ana)'));
  assert.ok(lines.includes('DTSTART;VALUE=DATE:20261008'));
  assert.ok(lines.includes('DTEND;VALUE=DATE:20261009'));
  assert.equal(ics.includes('Já feita'), false);
  assert.ok(lines.every(line => line.length <= 75), 'nenhuma linha passa do tamanho que os calendários aceitam');
});
