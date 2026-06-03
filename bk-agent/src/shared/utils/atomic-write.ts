/**
 * @description Escritura atomica de archivos: escribe a .tmp y luego rename.
 * Garantiza que un crash durante la escritura no deja el archivo corrupto.
 */

import { writeFileSync, renameSync, copyFileSync, unlinkSync, mkdirSync } from 'fs';
import { writeFile, rename, copyFile, unlink, mkdir } from 'fs/promises';
import { dirname } from 'path';

export function atomicWriteSync(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, content, 'utf-8');
  try {
    renameSync(tmp, filePath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') {
      mkdirSync(dirname(filePath), { recursive: true });
      copyFileSync(tmp, filePath);
      try { unlinkSync(tmp); } catch { /* ignorar */ }
    } else {
      throw e;
    }
  }
}

export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, content, 'utf-8');
  try {
    await rename(tmp, filePath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') {
      await mkdir(dirname(filePath), { recursive: true });
      await copyFile(tmp, filePath);
      try { await unlink(tmp); } catch { /* ignorar */ }
    } else {
      throw e;
    }
  }
}
