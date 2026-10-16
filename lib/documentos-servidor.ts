/**
 * [expediente] La parte de servidor de los documentos: sha256 y ruta final.
 * ---------------------------------------------------------------------------
 * Separado de lib/documentos.ts porque depende de node:crypto y aquel módulo lo
 * importa también la ficha (componente de cliente).
 */

import { createHash } from 'node:crypto';
import {
  type DocumentoValidado,
  type EntradaDocumento,
  rutaStorage,
  validarDocumento,
} from './documentos';

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface DocumentoPreparado extends DocumentoValidado {
  sha256: string;
  ruta: string;
}

/** Valida y, si pasa, agrega el sha256 calculado aquí y la ruta del objeto. */
export function prepararDocumento(
  e: EntradaDocumento,
): { ok: true; doc: DocumentoPreparado } | { ok: false; error: string } {
  const v = validarDocumento(e);
  if (!v.ok) return v;
  const sha256 = sha256Hex(e.bytes);
  return {
    ok: true,
    doc: { ...v.doc, sha256, ruta: rutaStorage(v.doc.tipo, v.doc.codigo, v.doc.fecha, sha256) },
  };
}
