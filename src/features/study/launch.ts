import { useNavigate } from 'react-router-dom';
import { toast } from '@/ui/toast';
import { SessionError, startSession, type StartSessionInput } from './sessions';

/** Crea la sesión y entra en ella. Lo usan Inicio y Estudiar: un toque y a estudiar. */
export function useLaunchSession(): (input: StartSessionInput) => Promise<void> {
  const navigate = useNavigate();
  return async (input) => {
    try {
      navigate(`/study/session/${await startSession(input)}`);
    } catch (error) {
      toast.error(error instanceof SessionError ? error.message : 'No se ha podido crear la sesión.');
    }
  };
}
