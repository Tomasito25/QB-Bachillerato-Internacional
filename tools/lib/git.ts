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

  constructor(dir: string, dataBranch = 'data') {
    this.dir = dir;
    this.dataBranch = dataBranch;
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
    await this.git('fetch', 'origin', this.dataBranch);
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
    await this.git('push', '--force', 'origin', `HEAD:refs/heads/${name}`);
  }

  async pushData(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await this.git('push', 'origin', `HEAD:refs/heads/${this.dataBranch}`);
        return;
      } catch (error) {
        lastError = error;
        await this.git('pull', '--rebase', 'origin', this.dataBranch);
      }
    }
    throw lastError;
  }

  headSha(): Promise<string> {
    return this.git('rev-parse', 'HEAD');
  }
}
