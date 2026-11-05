import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataStore } from '../lib/data-store.ts';
import { GitWorkspace } from '../lib/git.ts';
import { RestGitHub } from '../lib/github.ts';
import { runIntake } from './intake.ts';
import { pullClosed, pullNumberFromEvent, reviewPull } from './review-pr.ts';
import { runScheduler } from './scheduler.ts';

/** Punto de entrada de los workflows: `tsx tools/actions/main.ts <intake|review-pr|scheduler>`. */

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

function log(message: string): void {
  console.log(message);
}

async function main() {
  const command = process.argv[2];
  const repo = env('GITHUB_REPOSITORY');
  const api = new RestGitHub(repo, env('GITHUB_TOKEN'));
  const dataDir = resolve(process.env.QB_DATA_DIR ?? '.data');
  const git = new GitWorkspace(dataDir);
  await git.configureBot();
  const deps = {
    api,
    git,
    store: new DataStore(dataDir),
    now: () => Date.now(),
    log,
    // La fusión automática se desactiva con la variable de repositorio QB_AUTO_MERGE=false.
    autoMerge: process.env.QB_AUTO_MERGE !== 'false',
    defaultBranch: process.env.QB_DEFAULT_BRANCH || 'main',
    repo,
  };

  switch (command) {
    case 'intake': {
      const result = await runIntake(deps);
      log(`Procesados: ${result.processed}. Datos publicados: ${result.published}.`);
      break;
    }
    case 'review-pr': {
      const { number, action } = pullNumberFromEvent(env('GITHUB_EVENT_PATH'));
      if (action === 'closed') await pullClosed(deps, number);
      else log(`Resultado del PR #${number}: ${await reviewPull(deps, number)}`);
      break;
    }
    case 'scheduler': {
      const created = await runScheduler(deps);
      log(created.length > 0 ? `Creados: ${created.join(', ')}` : 'Nada que crear.');
      break;
    }
    default:
      throw new Error(`Orden desconocida: ${command}`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Orden \`${command}\` completada.\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
