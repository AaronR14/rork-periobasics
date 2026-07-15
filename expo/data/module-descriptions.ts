/**
 * Fixed module descriptions for the library page.
 *
 * Each entry has a title and a short description shown above the module's
 * video list. These are static for now — a future backend tool can replace
 * `MODULE_DESCRIPTIONS` with fetched data using the same `ModuleDescription`
 * shape and `getModuleDescription` helper.
 */

export interface ModuleDescription {
  /** Display title for the module (e.g. "Periodoncio Sano"). */
  title: string;
  /** Short summary shown beneath the title. */
  description: string;
}

/**
 * Keyed by the exact module name used throughout the app
 * ("Módulo 1", "Módulo 2", …). Unknown modules fall back to a default.
 */
export const MODULE_DESCRIPTIONS: Record<string, ModuleDescription> = {
  "Módulo 1": {
    title: "Módulo 1 - El Periodonto Sano",
    description:
      "Este módulo ofrece una visión integral de las estructuras que componen el periodonto en estado de salud. A lo largo de las lecciones, revisaremos la formación de estos tejidos, sus divisiones anatómicas y sus funciones principales. Nos enfocaremos en el estudio detallado de sus características clínicas e histológicas, brindándote las herramientas teóricas y visuales necesarias para evaluar la salud periodontal con criterio científico. Es el bloque fundamental para comprender el comportamiento de los tejidos ante los desafíos clínicos.",
  },
  "Módulo 2": {
    title: "Módulo 2 - La Clasificación de la Enfermedad Periodontal",
    description:
      "Este módulo está dedicado al estudio y aplicación de la clasificación mundial de 2017 establecida por la AAP y la EFP. Analizaremos los cambios clave respecto a clasificaciones anteriores y desglosaremos las tres grandes categorías: salud periodontal/gingival, periodontitis y otras condiciones que afectan al periodonto. Aprenderás a dominar los conceptos de extensión, severidad (Estadios I-IV) y el perfil de progresión del paciente (Grados A-C) para establecer diagnósticos estandarizados y basados en la evidencia.",
  },
  "Módulo 3": {
    title: "Terapia Básica",
    description:
      "Raspaje y alisado radicular, control de placa y terapia de soporte. Dominio de la fase causal y el mantenimiento periodontal.",
  },
};

/** Fallback description for modules without an explicit entry. */
const DEFAULT_DESCRIPTION: ModuleDescription = {
  title: "Módulo del Curso",
  description:
    "Contenido formativo del programa de periodoncia. Explora los videos de este módulo para profundizar en el tema.",
};

/**
 * Returns the description for a module name, or a sensible default.
 * Use this in components so swapping to backend data only changes one file.
 */
export function getModuleDescription(moduleName: string): ModuleDescription {
  return MODULE_DESCRIPTIONS[moduleName] ?? DEFAULT_DESCRIPTION;
}
