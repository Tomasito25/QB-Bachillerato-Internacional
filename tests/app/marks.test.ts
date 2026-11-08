import { describe, expect, it } from 'vitest';
import { bandPercent, markColor, monogram, subjectCode, unitParts } from '@/ui/marks';

describe('marcas de la interfaz', () => {
  it('el porcentaje de la banda siempre queda entre 0 y 100', () => {
    expect(bandPercent(0.844)).toBe(84);
    expect(bandPercent(-1)).toBe(0);
    expect(bandPercent(4)).toBe(100);
    expect(bandPercent(Number.NaN)).toBe(0);
    expect(bandPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('cada asignatura conserva su color y su código', () => {
    expect(markColor('b14c1cad')).toBe(markColor('b14c1cad'));
    expect(subjectCode('Fisica SL IB')).toBe('FS');
    expect(subjectCode('Química')).toBe('QU');
    expect(subjectCode('  (Biología) HL')).toBe('BH');
  });

  it('separa la letra de la unidad de su nombre', () => {
    expect(unitParts('A. Espacio, tiempo y movimiento', 0)).toEqual({ code: 'A', name: 'Espacio, tiempo y movimiento' });
    expect(unitParts('Ondas', 2)).toEqual({ code: '3', name: 'Ondas' });
  });

  it('saca las iniciales del nombre de la app', () => {
    expect(monogram('QuestionBank')).toBe('QB');
    expect(monogram('estudio')).toBe('ES');
  });
});
