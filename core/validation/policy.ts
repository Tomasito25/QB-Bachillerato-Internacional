/**
 * Límites anti-abuso. Están en un solo sitio porque los aplica Actions y los anticipa el
 * cliente para avisar antes de enviar.
 */
export const POLICY = {
  /** Tiempo máximo de atraso de una respuesta: permite estudiar sin conexión varios días. */
  maxAnswerAgeDays: 14,
  /** Respuestas aceptadas por usuario y día de recepción. */
  maxAnswersPerDay: 3000,
  /** Nodos de temario nuevos por envío. Da para varias asignaturas completas de una vez. */
  maxNewTaxonomyNodes: 500,
  /** Competiciones creadas por usuario y día. */
  maxCompetitionsPerDay: 10,
  /** Imágenes nuevas por envío. Sin esto, una cuenta podría llenar el repositorio de una vez. */
  maxImageBytesPerSubmission: 40 * 1024 * 1024,
  /** Lo que se espera a que lleguen todas las partes de un envío antes de darlo por perdido. */
  maxPartWaitMs: 14 * 24 * 60 * 60 * 1000,
  /** Envíos que procesa cada ejecución de Actions. Respeta el límite de 80 creaciones/minuto. */
  maxSubmissionsPerRun: 25,
  /** Margen de reloj para fechas declaradas. */
  clockSkewMs: 24 * 60 * 60 * 1000,
  /** Margen tras el cierre de una competición. */
  competitionGraceMs: 5 * 60 * 1000,
} as const;
