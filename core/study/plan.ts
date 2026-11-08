/**
 * Calendario de estudio: lo que falta de cada examen, repartido en los días que quedan. Es una
 * función pura del progreso: no se guarda, así que nunca se queda desfasado.
 */

export interface PlanExam {
  id: string;
  title: string;
  kind: 'mock' | 'final';
  date: string;
  subjectId: string;
  /** Vacío: toda la asignatura. */
  topicIds: readonly string[];
  /** Duración de la prueba, para ensayarla entera. */
  paperMinutes: number | null;
}

export interface PlanTopic {
  id: string;
  name: string;
  subjectId: string;
  total: number;
  seen: number;
  mastered: number;
  due: number;
  /** Nota de 0 a 1. `null` si no hay respuestas. */
  score: number | null;
}

export type PlanBlock =
  | { kind: 'exam'; examId: string; title: string; examKind: PlanExam['kind'] }
  | { kind: 'mock'; examId: string; title: string; minutes: number }
  | { kind: 'study'; examId: string; subjectId: string; topicId: string; title: string; count: number; reason: 'new' | 'weak' }
  | { kind: 'review'; title: string; count: number };

export interface PlanDay {
  date: string;
  rest: boolean;
  blocks: PlanBlock[];
}

export interface PlanShortfall {
  examId: string;
  /** Preguntas que no caben antes del examen. */
  questions: number;
  /** Minutos al día con los que sí cabrían. */
  minutesNeeded: number;
}

export interface StudyPlan {
  days: PlanDay[];
  shortfalls: PlanShortfall[];
  /** Preguntas al día que caben en el tiempo elegido. */
  capacity: number;
}

export interface PlanInput {
  today: string;
  exams: readonly PlanExam[];
  topics: readonly PlanTopic[];
  minutesPerDay: number;
  /** 0 es domingo. */
  restDays: readonly number[];
  /** Respuestas de hoy: lo ya hecho se descuenta. */
  doneToday: number;
}

/** Con la lectura de la explicación incluida; el desarrollo tarda más y el test menos. */
export const MINUTES_PER_QUESTION = 2.5;
const REVIEW_SHARE = 0.2;
/** Días antes del examen en los que se ensaya la prueba entera. */
const MOCK_OFFSETS = [14, 7, 3];
/** Más temas al día no se asientan. */
const MAX_TOPICS_PER_DAY = 3;
const MIN_CHUNK = 4;
/** Por debajo de esta nota, lo ya visto se vuelve a trabajar. */
const WEAK_BELOW = 0.7;

const toUtc = (date: string) => Date.parse(`${date}T12:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (date: string, days: number): string => fromUtc(toUtc(date) + days * 86_400_000);
export const daysBetween = (from: string, to: string): number => Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
export const weekdayOf = (date: string): number => new Date(toUtc(date)).getUTCDay();

interface Slot extends PlanDay {
  free: number;
}

interface Task {
  topic: PlanTopic;
  left: number;
  reason: 'new' | 'weak';
  examId: string;
}

function tasksFor(exam: PlanExam, topics: readonly PlanTopic[], taken: Set<string>): Task[] {
  const tasks: Task[] = [];
  for (const topic of topics) {
    if (topic.subjectId !== exam.subjectId || taken.has(topic.id)) continue;
    if (exam.topicIds.length > 0 && !exam.topicIds.includes(topic.id)) continue;
    // Un tema que entra en dos exámenes se prepara para el primero: lo que falte saldrá en el siguiente plan.
    taken.add(topic.id);
    const unseen = topic.total - topic.seen;
    const weak = topic.score !== null && topic.score < WEAK_BELOW ? topic.seen - topic.mastered : 0;
    if (weak > 0) tasks.push({ topic, left: weak, reason: 'weak', examId: exam.id });
    if (unseen > 0) tasks.push({ topic, left: unseen, reason: 'new', examId: exam.id });
  }
  // Primero lo que peor va; lo nuevo queda repartido detrás, en el orden del temario.
  return tasks.sort((a, b) => (a.reason === b.reason ? (a.topic.score ?? 0) - (b.topic.score ?? 0) : a.reason === 'weak' ? -1 : 1));
}

function placeMocks(exam: PlanExam, byDate: Map<string, Slot>, capacity: number): void {
  if (exam.paperMinutes === null) return;
  for (const offset of MOCK_OFFSETS) {
    let date = addDays(exam.date, -offset);
    while (byDate.has(date) && ((byDate.get(date) as Slot).rest || (byDate.get(date) as Slot).blocks.length > 0)) date = addDays(date, -1);
    const slot = byDate.get(date);
    if (!slot) continue;
    slot.blocks.push({ kind: 'mock', examId: exam.id, title: `Simulacro: ${exam.title}`, minutes: exam.paperMinutes });
    slot.free = Math.max(0, slot.free - Math.ceil(exam.paperMinutes / MINUTES_PER_QUESTION));
    if (capacity === 0) slot.free = 0;
  }
}

function reserveReview(slot: Slot, today: string, capacity: number, dueNow: number): void {
  if (slot.rest || slot.free === 0 || slot.blocks.some((block) => block.kind === 'exam')) return;
  const count = Math.min(slot.free, slot.date === today ? dueNow : Math.ceil(capacity * REVIEW_SHARE));
  if (count <= 0) return;
  slot.blocks.push({ kind: 'review', title: 'Repaso espaciado', count });
  slot.free -= count;
}

function allocate(exam: PlanExam, tasks: Task[], slots: readonly Slot[], capacity: number, minutesPerDay: number): PlanShortfall | null {
  const window = slots.filter((slot) => slot.date < exam.date && !slot.rest);
  let left = tasks.reduce((sum, task) => sum + task.left, 0);

  const place = (slot: Slot, task: Task, take: number) => {
    task.left -= take;
    slot.free -= take;
    left -= take;
    const same = slot.blocks.find((block): block is Extract<PlanBlock, { kind: 'study' }> => block.kind === 'study' && block.topicId === task.topic.id && block.reason === task.reason);
    if (same) same.count += take;
    else slot.blocks.push({ kind: 'study', examId: exam.id, subjectId: task.topic.subjectId, topicId: task.topic.id, title: `${task.reason === 'weak' ? 'Reforzar' : 'Estudiar'}: ${task.topic.name}`, count: take, reason: task.reason });
  };

  const fill = (slot: Slot, wanted: number, maxTopics: number) => {
    let quota = Math.min(slot.free, wanted);
    // Primero lo que más queda, con lo flojo por delante: así todos los temas avanzan a la vez.
    const urgency = (task: Task) => task.left * (task.reason === 'weak' ? 2 : 1);
    const queue = tasks.filter((task) => task.left > 0).sort((a, b) => urgency(b) - urgency(a));
    const topics = new Set<string>();
    const picks = queue.filter((task) => {
      if (topics.has(task.topic.id) || topics.size >= maxTopics) return false;
      topics.add(task.topic.id);
      return true;
    });
    for (const [index, task] of picks.entries()) {
      if (quota === 0) break;
      const take = Math.min(task.left, quota, Math.max(MIN_CHUNK, Math.ceil(quota / (picks.length - index))));
      place(slot, task, take);
      quota -= take;
    }
  };

  for (const [index, slot] of window.entries()) {
    if (left > 0 && slot.free > 0) fill(slot, Math.ceil(left / (window.length - index)), MAX_TOPICS_PER_DAY);
  }
  // Lo que no haya cabido va a los últimos días con hueco: mejor más temas un día que dejar preguntas fuera.
  for (const slot of [...window].reverse()) {
    while (left > 0 && slot.free > 0) {
      const before = slot.free;
      fill(slot, slot.free, Number.POSITIVE_INFINITY);
      if (slot.free === before) break;
    }
  }
  if (left === 0) return null;
  const days = Math.max(1, window.length);
  // Parte de cada día se reserva para repasar: lo que falta tiene que caber en el resto.
  const needed = (capacity + left / (days * (1 - REVIEW_SHARE))) * MINUTES_PER_QUESTION;
  return { examId: exam.id, questions: left, minutesNeeded: Math.max(minutesPerDay + 5, Math.ceil(needed / 5) * 5) };
}

export function buildPlan(input: PlanInput): StudyPlan {
  const { today, topics, minutesPerDay, restDays, doneToday } = input;
  const capacity = Math.max(1, Math.floor(minutesPerDay / MINUTES_PER_QUESTION));
  const exams = input.exams.filter((exam) => exam.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const last = exams[exams.length - 1];
  if (!last) return { days: [], shortfalls: [], capacity };

  const slots: Slot[] = [];
  for (let date = today; date <= last.date; date = addDays(date, 1)) {
    const rest = restDays.includes(weekdayOf(date));
    slots.push({ date, rest, blocks: [], free: rest ? 0 : date === today ? Math.max(0, capacity - doneToday) : capacity });
  }
  const byDate = new Map(slots.map((slot) => [slot.date, slot]));

  for (const exam of exams) {
    const slot = byDate.get(exam.date) as Slot;
    slot.blocks.push({ kind: 'exam', examId: exam.id, title: exam.title, examKind: exam.kind });
    slot.free = 0;
  }
  for (const exam of exams) placeMocks(exam, byDate, capacity);
  const dueNow = topics.reduce((sum, topic) => sum + topic.due, 0);
  for (const slot of slots) reserveReview(slot, today, capacity, dueNow);

  const taken = new Set<string>();
  const shortfalls: PlanShortfall[] = [];
  for (const exam of exams) {
    const shortfall = allocate(exam, tasksFor(exam, topics, taken), slots, capacity, minutesPerDay);
    if (shortfall) shortfalls.push(shortfall);
  }
  return { days: slots.map(({ free: _free, ...day }) => day), shortfalls, capacity };
}
