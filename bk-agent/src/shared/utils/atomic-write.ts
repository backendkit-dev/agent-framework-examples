/**
 * @description Escritura atomica de archivos: escribe a un temporal unico y
 * luego hace rename. Garantiza que un crash durante la escritura no deja el
 * archivo a medio escribir.
 *
 * El temporal incluye pid + sufijo aleatorio: con un nombre fijo
 * (`<archivo>.tmp`) dos procesos concurrentes se pisaban el temporal y uno de
 * los dos escritores perdia su contenido.
 */

import { writeFileSync, renameSync, copyFileSync, unlinkSync, mkdirSync } from 'fs';
import { writeFile, rename, copyFile, unlink, mkdir } from 'fs/promises';
import { dirname } from 'path';

/** Ruta del temporal, unica por proceso y por escritura. */
export function tempPathFor(filePath: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${filePath}.${process.pid}.${rand}.tmp`;
}

export function atomicWriteSync(filePath: string, content: string): void {
  const tmp = tempPathFor(filePath);
  writeFileSync(tmp, content, 'utf-8');
  try {
    renameSync(tmp, filePath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') {
      // Windows puede rechazar el rename si el destino esta bloqueado:
      // se cae a copia + borrado del temporal.
      mkdirSync(dirname(filePath), { recursive: true });
      copyFileSync(tmp, filePath);
      try { unlinkSync(tmp); } catch { /* ignorar */ }
    } else {
      try { unlinkSync(tmp); } catch { /* ignorar */ }
      throw e;
    }
  }
}

export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmp = tempPathFor(filePath);
  await writeFile(tmp, content, 'utf-8');
  try {
    await rename(tmp, filePath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') {
      await mkdir(dirname(filePath), { recursive: true });
      await copyFile(tmp, filePath);
      try { await unlink(tmp); } catch { /* ignorar */ }
    } else {
      try { await unlink(tmp); } catch { /* ignorar */ }
      throw e;
    }
  }
}
