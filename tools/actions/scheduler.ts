import { buildScheduledCompetition } from '../../core/competitions/competitions.ts';
import { buildTaxonomyIndex } from '../../core/taxonomy/merge.ts';
import { sha256Hex } from '../../core/util/encoding.ts';
import type { DataStore } from '../lib/data-store.ts';
import type { GitPort } from '../lib/git.ts';
import type { GitHubApi } from '../lib/github.ts';

/**
 * Crea los retos programados. Es idempotente: si el cron se ejecuta dos veces, o tarde, no
 * pasa nada. Si GitHub se salta una ejecución, ese reto se crea en la siguiente del mismo día.
 */
export async function runScheduler(deps: { api: GitHubApi; store: DataStore; git: GitPort; now: () => number; log: (message: string) => void; defaultBranch: string }): Promise<string[]> {
  const { api, store, git, now, log } = deps;
  await git.syncData();
  await store.load();
  const available = [...store.questions.values()].filter((q) => !store.hidden.has(q.id) && !store.retired.has(q.id));
  const index = buildTaxonomyIndex(store.subjects());
  const head = await git.headSha();
  const created: string[] = [];
  for (const kind of ['daily', 'weekly'] as const) {
    const draft = buildScheduledCompetition(kind, now(), 'f'.repeat(64), available, index);
    if (!draft) {
      log(`No hay preguntas suficientes para el reto ${kind}.`);
      continue;
    }
    if (await store.readCompetition(draft.id)) continue;
    // La semilla depende del commit: no se puede saber de antemano qué preguntas tocarán.
    const seed = await sha256Hex(`${draft.id}:${head}`);
    const competition = buildScheduledCompetition(kind, now(), seed, available, index);
    if (!competition) continue;
    await store.putCompetition(competition);
    created.push(competition.id);
  }
  if (created.length > 0 && (await git.commitAll(`Retos programados: ${created.join(', ')}`))) {
    await git.pushData();
    await api.dispatchWorkflow('deploy.yml', deps.defaultBranch);
  }
  // Un cron de despliegue refresca también los periodos de ranking aunque no se haya creado nada.
  return created;
}
