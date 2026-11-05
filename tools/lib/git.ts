import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Git sobre la copia de la rama `data`. Se usa `execFile`, sin shell: ni un título de issue ni
 * nada de lo recibido puede inyectar un comando. Además, a git sólo le llegan números y textos
 * generados aquí.
 */
export interface GitPort {
  /** Deja la copia de trabajo igual que `origin/data`. */
  syncData(): Promise<void>;
  /** Crea una rama para una aportación, a partir de `origin/data`. */
  startBranch(name: string): Promise<void>;
  /** Hace commit de todo lo pendiente. Devuelve si había algo que guardar. */
  commitAll(message: string): Promise<boolean>;
  /** Descarta lo que no esté en un commit: deshace un envío que falló a medias. */
  discardChanges(): Promise<void>;
  pushBranch(name: string): Promise<void>;
  /** Sube `data`; si alguien se adelantó, integra sus cambios y reintenta. */
  pushData(): Promise<void>;
  headSha(): Promise<string>;
}

export class GitWorkspace implements GitPort {
  private readonly dir: string;
  readonly dataBranch: string;
  private readonly retryDelayMs: number;

  constructor(dir: string, dataBranch = 'data', options: { retryDelayMs?: number } = {}) {
    this.dir = dir;
    this.dataBranch = dataBranch;
    this.retryDelayMs = options.retryDelayMs ?? 3000;
  }

  private wait(attempt: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
  }

  /** Lo que toca la red puede fallar de forma pasajera: GitHub rechaza a veces un push válido. */
  private async network(...args: string[]): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await this.wait(attempt);
      try {
        return await this.git(...args);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private async git(...args: string[]): Promise<string> {
    const { stdout } = await exec('git', args, { cwd: this.dir, maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
  }

  async configureBot(): Promise<void> {
    await this.git('config', 'user.name', 'github-actions[bot]');
    await this.git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  }

  async syncData(): Promise<void> {
    await this.network('fetch', 'origin', this.dataBranch);
    await this.git('checkout', '-B', this.dataBranch, `origin/${this.dataBranch}`);
    await this.git('reset', '--hard', `origin/${this.dataBranch}`);
    await this.git('clean', '-fdq');
  }

  async startBranch(name: string): Promise<void> {
    await this.git('checkout', '-B', name, `origin/${this.dataBranch}`);
  }

  async commitAll(message: string): Promise<boolean> {
    await this.git('add', '-A');
    const status = await this.git('status', '--porcelain');
    if (!status) return false;
    await this.git('commit', '-m', message);
    return true;
  }

  async discardChanges(): Promise<void> {
    await this.git('reset', '--hard', 'HEAD');
    await this.git('clean', '-fdq');
  }

  async pushBranch(name: string): Promise<void> {
    await this.network('push', '--force', 'origin', `HEAD:refs/heads/${name}`);
  }

  async pushData(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await this.wait(attempt - 1);
      try {
        await this.git('push', 'origin', `HEAD:refs/heads/${this.dataBranch}`);
        return;
      } catch (error) {
        lastError = error;
        try {
          await this.network('pull', '--rebase', 'origin', this.dataBranch);
        } catch (pullError) {
          // Un conflicto deja el rebase a medias: se limpia y falla, y el barrido reprocesa.
          await this.git('rebase', '--abort').catch(() => undefined);
          throw pullError;
        }
      }
    }
    throw lastError;
  }

  headSha(): Promise<string> {
    return this.git('rev-parse', 'HEAD');
  }
}
