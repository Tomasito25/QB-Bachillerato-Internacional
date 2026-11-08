import { FileText, Trash2, Upload } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef } from 'react';
import { kvDelete, kvGet, kvSet } from '@/infra/db/db';
import { Button } from '@/ui/Button';
import { Card, CardHeader, PageHeader } from '@/ui/Surface';
import { toast } from '@/ui/toast';
import { downloadBlob } from '@/features/bank/importExport';
import { FormulaSheet } from './FormulaSheet';

const KEY = 'booklet-pdf';
const MAX_BYTES = 30 * 1024 * 1024;

interface StoredPdf {
  name: string;
  blob: Blob;
}

function openPdf(pdf: StoredPdf) {
  const url = URL.createObjectURL(pdf.blob);
  // Algunos navegadores móviles no abren PDF en otra pestaña: entonces se descarga.
  if (!window.open(url, '_blank')) downloadBlob(pdf.blob, pdf.name);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** El cuadernillo oficial tiene derechos del IB: no se publica, pero cada cual puede guardar el suyo aquí. */
function OwnBooklet() {
  const pdf = useLiveQuery(() => kvGet<StoredPdf>(KEY), []);
  const input = useRef<HTMLInputElement>(null);
  const add = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf') return toast.error('Tiene que ser un PDF.');
    if (file.size > MAX_BYTES) return toast.error('El PDF es demasiado grande.');
    await kvSet(KEY, { name: file.name, blob: file });
    toast.success('PDF guardado en este dispositivo.');
  };
  return (
    <Card>
      <CardHeader title="Tu cuadernillo oficial" description="El del IB tiene derechos de autor y no se puede publicar aquí. Si tienes tu PDF, déjalo a mano: se queda sólo en este dispositivo." />
      <div className="flex flex-wrap items-center gap-2 p-4">
        <input ref={input} type="file" accept="application/pdf" className="sr-only" aria-label="Elegir tu PDF" onChange={(e) => void add(e.target.files?.[0])} />
        {pdf ? (
          <>
            <Button variant="primary" icon={<FileText size={16} aria-hidden />} onClick={() => openPdf(pdf)}>
              Abrir {pdf.name}
            </Button>
            <Button variant="ghost" icon={<Trash2 size={16} aria-hidden />} onClick={() => void kvDelete(KEY)}>
              Quitar
            </Button>
          </>
        ) : (
          <Button icon={<Upload size={16} aria-hidden />} onClick={() => input.current?.click()}>
            Añadir mi PDF
          </Button>
        )}
      </div>
    </Card>
  );
}

export default function FormulasPage() {
  return (
    <>
      <PageHeader title="Formulario" description="Física: las ecuaciones de la asignatura y para qué sirve cada una." />
      <div className="flex flex-col gap-8">
        <OwnBooklet />
        <p className="text-[0.8125rem] text-muted">Escrito para esta app. No es el cuadernillo oficial del IB: en el examen usarás el que te entreguen.</p>
        <FormulaSheet />
      </div>
    </>
  );
}
