import { InjectionToken } from '@nestjs/common';

// Storage abstraction for uploaded material files. Local filesystem for dev;
// the module maps the same token to any S3-compatible provider.
export interface StorageSaveParams {
  key: string;
  data: Buffer;
}

export interface StorageProvider {
  save(params: StorageSaveParams): Promise<void>;
  delete(key: string): Promise<void>;
}

export const STORAGE_PROVIDER: InjectionToken = Symbol('STORAGE_PROVIDER');