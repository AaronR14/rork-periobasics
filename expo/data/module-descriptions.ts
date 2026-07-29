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
    title: "Módulo 3 - El Diagnóstico Periodontal",
    description:
      "Este módulo traduce la teoría de los bloques anteriores en criterio clínico: cómo reconocer la enfermedad periodontal frente al paciente. Revisaremos las características clínicas que distinguen a los tejidos enfermos y el sondaje periodontal como herramienta central de exploración, entrando de lleno en la lectura de las bolsas periodontales. Complementaremos el examen clínico con los estudios radiográficos y tomográficos, entendiendo qué aporta y qué limita cada uno. Cierra con el proceso de toma de decisiones: cómo integrar todos esos hallazgos en un diagnóstico ordenado y sostenible.",
  },
  "Módulo 4": {
    title: "Módulo 4 - Pronóstico y Plan de Tratamiento",
    description:
      "Este módulo aborda qué hacer una vez establecido el diagnóstico. Comenzaremos con las generalidades del pronóstico periodontal —qué factores lo determinan y cómo se establece— para después aplicarlos sobre un caso clínico completo. Con el pronóstico en la mano construiremos el plan de tratamiento: sus componentes, su secuencia y los criterios para organizarlo de forma que garantice la mejor atención al paciente. Terminaremos con la Fase I, antes conocida como fase etiotrópica, el bloque fundamental de la terapia periodontal y el punto donde se define buena parte del resultado.",
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
