import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Button, ButtonLink } from '@/ui/Button';
import { EmptyState } from '@/ui/Surface';

export function ErrorPage() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  if (notFound) return <NotFound />;
  const message = error instanceof Error ? error.message : 'Error desconocido';
  // Tras desplegar, un chunk antiguo deja de existir: recargar resuelve el caso más común.
  return (
    <div className="mx-auto max-w-lg p-6 pt-16">
      <EmptyState
        title="Algo ha fallado en esta pantalla"
        action={
          <>
            <Button variant="primary" onClick={() => window.location.reload()}>
              Recargar
            </Button>
            <ButtonLink to="/">Ir al inicio</ButtonLink>
          </>
        }
      >
        Tus datos están a salvo en este dispositivo.
        <p className="mt-2 font-mono text-xs break-words">{message}</p>
      </EmptyState>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="pt-12">
      <EmptyState title="Esta página no existe" action={<ButtonLink to="/" variant="primary">Ir al inicio</ButtonLink>}>
        Puede que el enlace esté mal o que el contenido se haya retirado.
      </EmptyState>
    </div>
  );
}
