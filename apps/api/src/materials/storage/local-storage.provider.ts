import { Injectable } from '@nestjs/common';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { StorageProvider, StorageSaveParams } from './storage-provider.interface.js';

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  private readonly root: string;

  constructor() {
    this.root = resolve(process.env['STORAGE_LOCAL_DIR'] ?? './storage');
  }

  async save(params: StorageSaveParams): Promise<void> {
    const target = this.targetPath(params.key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, params.data);
  }

  async delete(key: string): Promise<void> {
    await rm(this.targetPath(key), { force: true });
  }

  private targetPath(key: string): string {
    return join(this.root, key);
  }
}