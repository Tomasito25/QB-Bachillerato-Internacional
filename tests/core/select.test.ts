import { describe, expect, it } from 'vitest';
import { selectBalanced, selectDue, selectPractice, shuffledOptions, type SelectionProgress } from '@core/study/select';
import { seededRandom } from '@core/util/rng';

const NOW = Date.UTC(2026, 10, 5);
const items = (n: number, topic = 't') => Array.from({ length: n }, (_, i) => ({ id: `${topic}${i}`, topicIds: [topic] }));

describe('selección de práctica', () => {
  it('nunca devuelve más de lo pedido ni repite', () => {
    const picked = selectPractice(items(30), 10, new Map(), NOW, seededRandom('a'));
    expect(picked).toHaveLength(10);
    expect(new Set(picked.map((p) => p.id)).size).toBe(10);
  });

  it('devuelve lo que haya si el banco es pequeño', () => {
    expect(selectPractice(items(3), 10, new Map(), NOW, seededRandom('a'))).toHaveLength(3);
  });

  it('da prioridad a lo que toca repasar frente a lo ya sabido', () => {
    const pool = items(200);
    const progress = new Map<string, SelectionProgress>();
    pool.forEach((item, i) => {
      progress.set(item.id, i < 100 ? { due: NOW - 1000, attempts: 3, lastCorrect: true } : { due: NOW + 1e9, attempts: 3, lastCorrect: true });
    });
    let due = 0;
    for (let round = 0; round < 50; round++) {
      due += selectPractice(pool, 20, progress, NOW, seededRandom(`r${round}`)).filter((p) => Number(p.id.slice(1)) < 100).length;
    }
    // Con peso 6 frente a 1, la inmensa mayoría debe ser de las vencidas, sin ser todas.
    expect(due / (50 * 20)).toBeGreaterThan(0.75);
  });

  it('es reproducible con la misma semilla', () => {
    const a = selectPractice(items(50), 5, new Map(), NOW, seededRandom('x'));
    const b = selectPractice(items(50), 5, new Map(), NOW, seededRandom('x'));
    expect(a).toEqual(b);
  });
});

describe('selección de examen', () => {
  it('reparte entre temas aunque uno tenga muchas más preguntas', () => {
    const pool = [...items(100, 'grande'), ...items(5, 'chico1'), ...items(5, 'chico2')];
    const picked = selectBalanced(pool, 15, seededRandom('e'));
    expect(picked).toHaveLength(15);
    const counts = new Map<string, number>();
    for (const item of picked) counts.set(item.topicIds[0] as string, (counts.get(item.topicIds[0] as string) ?? 0) + 1);
    expect(counts.get('chico1')).toBe(5);
    expect(counts.get('chico2')).toBe(5);
    expect(counts.get('grande')).toBe(5);
  });

  it('completa con lo que quede cuando un tema se agota', () => {
    const pool = [...items(2, 'a'), ...items(20, 'b')];
    expect(selectBalanced(pool, 10, seededRandom('e'))).toHaveLength(10);
  });

  it('no se queda colgado si se piden más de las que hay', () => {
    expect(selectBalanced(items(3), 10, seededRandom('e'))).toHaveLength(3);
  });
});

describe('selección de repaso', () => {
  it('sólo lo vencido, y lo más antiguo primero', () => {
    const pool = items(4);
    const progress = new Map<string, SelectionProgress>([
      ['t0', { due: NOW - 100, attempts: 1, lastCorrect: true }],
      ['t1', { due: NOW - 900, attempts: 1, lastCorrect: true }],
      ['t2', { due: NOW + 100, attempts: 1, lastCorrect: true }],
      ['t3', { due: NOW - 500, attempts: 0, lastCorrect: null }],
    ]);
    expect(selectDue(pool, 10, progress, NOW).map((p) => p.id)).toEqual(['t1', 't0']);
  });
});

describe('orden de las opciones', () => {
  it('no cambia al recargar la misma sesión', () => {
    const options = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(shuffledOptions(options, 's1', 'q1')).toEqual(shuffledOptions(options, 's1', 'q1'));
  });

  it('varía entre sesiones', () => {
    const options = 'abcdefghijkl'.split('');
    expect(shuffledOptions(options, 's1', 'q1')).not.toEqual(shuffledOptions(options, 's2', 'q1'));
  });
});
