import { describe, expect, it } from 'vitest';
import { mergeFriends, parseLogin } from '@/features/friends/friends';

describe('amigos', () => {
  it('reconoce el usuario escrito de varias formas', () => {
    expect(parseLogin('Ana')).toBe('ana');
    expect(parseLogin(' @Ana-G ')).toBe('ana-g');
    expect(parseLogin('https://github.com/Ana?tab=repositories')).toBe('ana');
    expect(parseLogin('github.com/luis/')).toBe('luis');
    expect(parseLogin('dos palabras')).toBeNull();
    expect(parseLogin('-ana')).toBeNull();
    expect(parseLogin('')).toBeNull();
  });

  it('combina listas sin repetir y descarta lo que no es un usuario', () => {
    expect(mergeFriends(['ana'], ['Ana', '@luis', 42, 'mal usuario', null])).toEqual(['ana', 'luis']);
  });
});
