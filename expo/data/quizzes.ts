export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

/** A QuizQuestion tagged with its subtopic slug — what getQuizForModule returns. */
export type TaggedQuizQuestion = QuizQuestion & { subtopicSlug: string };

export interface QuizModule {
  moduleId: string;
  title: string;
  theme: string;
  questions: TaggedQuizQuestion[];
}

/** A question set tagged with its subtopic slug. */
interface QuestionSet {
  subtopicSlug: string;
  questions: QuizQuestion[];
}

interface QuizModuleData {
  moduleId: string;
  title: string;
  theme: string;
  questionSets: QuestionSet[];
}

/** Fisher-Yates shuffle (returns a new array, does not mutate input). */
function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const QUIZ_DATA: Record<string, QuizModuleData> = {
  "Módulo 1": {
    moduleId: "mod-1",
    title: "Módulo 1",
    theme: "Anatomía, estructura y función del periodonto",
    questionSets: [
      /* ───────────── Set A — Encía: clínica, epitelio y diagnóstico ───────────── */
      {
        subtopicSlug: "caracteristicas_clinicas",
        questions: [
        {
          id: "a1",
          question:
            "¿Cuál es la función principal del periodonto en el mantenimiento de la salud dental?",
          options: [
            "A. Proveer soporte para la función dentaria y protección al diente.",
            "B. Facilitar la absorción de nutrientes por el esmalte.",
            "C. Permitir la movilidad excesiva del diente para la masticación.",
            "D. Regular la producción de saliva y la lubricación bucal.",
          ],
          correctIndex: 0,
          explanation:
            "El periodonto protege y provee el soporte necesario para el mantenimiento de la función dentaria, resguardando el diente y las estructuras internas.",
        },
        {
          id: "a2",
          question:
            "¿Cuáles son los cuatro elementos principales que componen el periodonto?",
          options: [
            "A. Esmalte, dentina, pulpa y hueso alveolar.",
            "B. Encía, ligamento periodontal, cemento radicular y hueso alveolar.",
            "C. Mucosa bucal, lengua, paladar y mejillas.",
            "D. Vasos sanguíneos, nervios, vasos linfáticos y músculo.",
          ],
          correctIndex: 1,
          explanation:
            "El periodonto está compuesto por la encía, el ligamento periodontal, el cemento radicular y el hueso alveolar, cada uno con una función protectora y de soporte.",
        },
        {
          id: "a3",
          question:
            "¿Qué característica de la encía marginal es considerada la más importante para el diagnóstico de enfermedad periodontal activa?",
          options: [
            "A. Su grosor, que indica resistencia a las fuerzas masticatorias.",
            "B. Su coloración, debido a su contacto directo con la placa bacteriana.",
            "C. La presencia de punteado en cáscara de naranja (stippling).",
            "D. Su capacidad de queratinización completa.",
          ],
          correctIndex: 1,
          explanation:
            "La encía marginal, al estar en contacto directo con la placa, es la primera en mostrar cambios de coloración, tamaño y consistencia, siendo un indicador clave de enfermedad periodontal activa.",
        },
        {
          id: "a4",
          question:
            "¿Qué tipo de epitelio caracteriza a la encía, según su nivel de queratinización?",
          options: [
            "A. Epitelio plano estratificado no queratinizado.",
            "B. Epitelio cúbico simple ortoqueratinizado.",
            "C. Epitelio plano estratificado paraqueratinizado.",
            "D. Epitelio cilíndrico seudoestratificado.",
          ],
          correctIndex: 2,
          explanation:
            "La encía está formada por un epitelio plano estratificado paraqueratinizado, lo que significa que nunca se queratiniza completamente, a diferencia de la piel.",
        },
        {
          id: "a5",
          question:
            "¿Cuál es la principal función de los desmosomas y hemidesmosomas en el tejido gingival?",
          options: [
            "A. Permitir el paso de iones y moléculas pequeñas entre células.",
            "B. Producir melanina para la pigmentación de la encía.",
            "C. Unir las células entre sí y al tejido conectivo subyacente, proporcionando resistencia e impermeabilidad.",
            "D. Actuar como terminaciones nerviosas para la percepción táctil.",
          ],
          correctIndex: 2,
          explanation:
            "Los desmosomas y hemidesmosomas son estructuras de unión celular que aseguran la cohesión del tejido gingival, haciéndolo resistente e impermeable a las fuerzas externas.",
        },
        {
          id: "a6",
          question:
            "¿Qué tipo de células del epitelio gingival actúan como presentadoras de antígenos, contribuyendo a la defensa inmunológica?",
          options: [
            "A. Queratinocitos.",
            "B. Melanocitos.",
            "C. Células de Merkel.",
            "D. Células de Langerhans.",
          ],
          correctIndex: 3,
          explanation:
            "Las células de Langerhans son células de defensa con capacidad para reconocer antígenos y presentarlos a las células que pueden destruirlos, desempeñando un papel importante en la respuesta inmune.",
        },
        {
          id: "a7",
          question:
            "¿Cuál es la principal diferencia entre la encía insertada y la encía marginal en cuanto a su grosor y resistencia?",
          options: [
            "A. La encía marginal es más gruesa y resistente que la encía insertada.",
            "B. La encía insertada es más gruesa y resistente, especialmente en los anterosuperiores, debido a su función de protección.",
            "C. Ambas tienen el mismo grosor y resistencia en todas las áreas de la boca.",
            "D. La encía insertada es más delgada en los anterosuperiores y más gruesa en los molares.",
          ],
          correctIndex: 1,
          explanation:
            "La encía insertada es fisiológicamente importante por su grosor, que es mayor en los anterosuperiores y se adelgaza hacia los molares, ofreciendo mayor resistencia a la enfermedad periodontal debido a su contenido de fibra.",
        },
        {
          id: "a8",
          question:
            "¿Qué estructura de la encía es considerada un criterio diagnóstico automático de salud, especialmente en casos de gingivitis incipiente?",
          options: [
            "A. El grosor de la encía insertada.",
            "B. El color de la encía marginal.",
            "C. La papila interdental.",
            "D. La línea mucogingival.",
          ],
          correctIndex: 2,
          explanation:
            "La papila interdental es un criterio diagnóstico vital, ya que es la primera parte de la encía en inflamarse durante una gingivitis debido a su mayor contacto con la placa bacteriana en el espacio interdental.",
        },
        {
          id: "a9",
          question: "¿Cuál es la tasa de renovación completa del tejido gingival?",
          options: [
            "A. Cada 24 horas.",
            "B. Cada 5 a 6 días.",
            "C. Cada 10 a 12 días.",
            "D. Cada 30 a 45 días.",
          ],
          correctIndex: 2,
          explanation:
            "La encía se renueva completamente cada 10 a 12 días, lo que refleja una alta actividad metabólica y de reparación.",
        },
        {
          id: "a10",
          question:
            "¿Qué factor es responsable de la característica de 'cáscara de naranja' o graneado gingival en la encía?",
          options: [
            "A. La densidad de los vasos sanguíneos en el tejido conectivo.",
            "B. La presencia de melanocitos en el epitelio.",
            "C. Las proyecciones papilares resultantes de la unión fuerte entre el epitelio y el tejido conectivo subyacente.",
            "D. El nivel de queratinización del estrato córneo.",
          ],
          correctIndex: 2,
          explanation:
            "El graneado gingival es una característica física dada por las proyecciones papilares, que son el resultado de la fuerte unión entre el epitelio y el tejido conectivo subyacente.",
        },
      ],
      },

      /* ─── Set B — Surco gingival, epitelio de unión, conectivo y vascularización ─── */
      {
        subtopicSlug: "anatomia_periodontal",
        questions: [
        {
          id: "b1",
          question:
            "¿Cuál es la profundidad de sondaje de un surco gingival clínicamente normal en humanos?",
          options: ["A. 0 mm.", "B. 2 a 3 mm.", "C. 5 a 6 mm.", "D. 8 a 10 mm."],
          correctIndex: 1,
          explanation:
            "La profundidad de sondaje de un surco gingival clínicamente normal en humanos es de 2 a 3 mm. La profundidad histológica puede ser menor y no necesariamente coincide con la penetración de la sonda.",
        },
        {
          id: "b2",
          question:
            "¿En qué región es generalmente mayor el ancho de la encía insertada?",
          options: [
            "A. En la región molar.",
            "B. En la región premolar.",
            "C. En la región incisiva.",
            "D. Es igual en todas las áreas.",
          ],
          correctIndex: 2,
          explanation:
            "El ancho de la encía insertada es generalmente mayor en la región incisiva (3,5 a 4,5 mm en el maxilar) y más estrecho en los segmentos posteriores (1,9 mm en los primeros premolares maxilares).",
        },
        {
          id: "b3",
          question:
            "¿A partir de qué estructura se forma el epitelio de unión durante la erupción dental?",
          options: [
            "A. Únicamente del epitelio oral.",
            "B. Del epitelio reducido del esmalte (REE) al unirse con el epitelio oral.",
            "C. Del folículo dental.",
            "D. De la vaina radicular de Hertwig.",
          ],
          correctIndex: 1,
          explanation:
            "Cuando el diente penetra la mucosa oral, el epitelio reducido del esmalte (REE) se une con el epitelio oral y se transforma en el epitelio de unión. Las células migran en dirección coronal hacia el surco gingival donde se descaman.",
        },
        {
          id: "b4",
          question:
            "¿Qué porcentaje del tejido conectivo gingival está compuesto por fibras de colágeno?",
          options: ["A. Aproximadamente 35%.", "B. Aproximadamente 5%.", "C. Aproximadamente 60%.", "D. Aproximadamente 90%."],
          correctIndex: 2,
          explanation:
            "Los componentes principales del tejido conectivo gingival son fibras de colágeno (aproximadamente 60% en volumen), fibroblastos (5%), vasos, nervios y matriz (aproximadamente 35%).",
        },
        {
          id: "b5",
          question:
            "¿Cuál de los siguientes NO es uno de los tres grupos principales de fibras gingivales?",
          options: [
            "A. Fibras gingivodentales.",
            "B. Fibras circulares.",
            "C. Fibras transceptales.",
            "D. Fibras oblicuas.",
          ],
          correctIndex: 3,
          explanation:
            "Las fibras gingivales se organizan en tres grupos: gingivodentales, circulares y transceptales. Las fibras oblicuas pertenecen al ligamento periodontal, no a las fibras gingivales.",
        },
        {
          id: "b6",
          question:
            "¿Cuál es una función primaria de las fibras gingivales?",
          options: [
            "A. Transmitir las fuerzas oclusales al hueso.",
            "B. Sostener firmemente la encía marginal contra el diente.",
            "C. Regular el flujo vascular.",
            "D. Producir melanina para la pigmentación.",
          ],
          correctIndex: 1,
          explanation:
            "Las fibras gingivales sostienen la encía marginal firmemente contra el diente, proporcionan la rigidez necesaria para resistir las fuerzas masticatorias y unen la encía marginal libre con el cemento radicular.",
        },
        {
          id: "b7",
          question:
            "¿Qué produce el característico color 'rosa coral' de la encía normal?",
          options: [
            "A. Únicamente el pigmento de melanina.",
            "B. El aporte vascular, el grosor y grado de queratinización del epitelio, y las células con pigmento.",
            "C. La densidad de las fibras de colágeno.",
            "D. La presencia de punteado (stippling).",
          ],
          correctIndex: 1,
          explanation:
            "El color de la encía se produce por el aporte vascular, el grosor y el grado de queratinización del epitelio, y la presencia de células que contienen pigmento. El color varía entre individuos y se correlaciona con la pigmentación cutánea.",
        },
        {
          id: "b8",
          question:
            "¿Cuál de las siguientes NO es una función del fluido gingival (crevicular)?",
          options: [
            "A. Limpiar material del surco.",
            "B. Contener proteínas plasmáticas que mejoran la adhesión del epitelio al diente.",
            "C. Poseer propiedades antimicrobianas.",
            "D. Producir nuevas fibras de colágeno.",
          ],
          correctIndex: 3,
          explanation:
            "El fluido gingival limpia material del surco, contiene proteínas plasmáticas para la adhesión epitelial, posee propiedades antimicrobianas y ejerce actividad de anticuerpos. No produce fibras de colágeno; esa es función de los fibroblastos.",
        },
        {
          id: "b9",
          question: "¿Cuántas fuentes de irrigación sanguínea tiene la encía?",
          options: ["A. Una.", "B. Dos.", "C. Tres.", "D. Cuatro."],
          correctIndex: 2,
          explanation:
            "La encía recibe irrigación de tres fuentes: arteriolas supraperiósticas a lo largo de las superficies vestibular y lingual del hueso alveolar, vasos del ligamento periodontal que se extienden hacia la encía, y arteriolas que emergen de la cresta de los tabiques interdentales.",
        },
        {
          id: "b10",
          question:
            "¿En qué dirección migran las células regeneradoras del epitelio de unión?",
          options: [
            "A. En dirección apical hacia la raíz.",
            "B. En dirección coronal hacia el surco gingival.",
            "C. Lateralmente hacia la encía insertada.",
            "D. No migran; permanecen estacionarias.",
          ],
          correctIndex: 1,
          explanation:
            "Las células regeneradoras del epitelio de unión se mueven hacia la superficie del diente y a lo largo de ella en dirección coronal hacia el surco gingival, donde se descaman. Esto proporciona una adherencia continua al diente.",
        },
      ],
      },

      /* ───── Set C — Ligamento periodontal, cemento y hueso alveolar ───── */
      {
        subtopicSlug: "funcion_periodontal",
        questions: [
        {
          id: "c1",
          question:
            "¿Cuál es el ancho promedio del espacio del ligamento periodontal?",
          options: ["A. Aproximadamente 0,5 mm.", "B. Aproximadamente 0,2 mm.", "C. Aproximadamente 1,0 mm.", "D. Aproximadamente 0,05 mm."],
          correctIndex: 1,
          explanation:
            "El ancho promedio del espacio del ligamento periodontal está documentado en aproximadamente 0,2 mm, con variaciones considerables. El espacio disminuye en dientes sin función y aumenta en dientes con hiperfunción.",
        },
        {
          id: "c2",
          question:
            "¿En cuántos grupos se organizan las fibras principales del ligamento periodontal?",
          options: ["A. Cuatro.", "B. Cinco.", "C. Seis.", "D. Ocho."],
          correctIndex: 2,
          explanation:
            "Las fibras principales del ligamento periodontal se organizan en seis grupos que se desarrollan secuencialmente: transceptales, crestales alveolares, horizontales, oblicuas, apicales e interradiculares.",
        },
        {
          id: "c3",
          question: "¿Qué son las fibras de Sharpey?",
          options: [
            "A. Fibras que forman el tejido conectivo gingival.",
            "B. Las porciones terminales de las fibras principales insertadas en el cemento y el hueso.",
            "C. Fibras elásticas en el ligamento periodontal.",
            "D. Fibras nerviosas en la encía.",
          ],
          correctIndex: 1,
          explanation:
            "Las porciones terminales de las fibras principales que se insertan en el cemento y el hueso se denominan fibras de Sharpey. Una vez incrustadas en la pared del alvéolo o en el diente, se calcifican en un grado significativo.",
        },
        {
          id: "c4",
          question:
            "¿Qué grupo de fibras principales constituye el grupo más grande del ligamento periodontal?",
          options: [
            "A. Fibras crestales alveolares.",
            "B. Fibras horizontales.",
            "C. Fibras oblicuas.",
            "D. Fibras apicales.",
          ],
          correctIndex: 2,
          explanation:
            "Las fibras oblicuas constituyen el grupo más grande del ligamento periodontal. Soportan la mayor parte de las tensiones masticatorias verticales y las transforman en tensión sobre el hueso alveolar.",
        },
        {
          id: "c5",
          question: "¿Cuáles son los dos tipos principales de cemento?",
          options: [
            "A. Cemento acelular (primario) y cemento celular (secundario).",
            "B. Cemento compacto y cemento esponjoso.",
            "C. Cemento coronal y cemento radicular.",
            "D. Cemento queratinizado y cemento no queratinizado.",
          ],
          correctIndex: 0,
          explanation:
            "Los dos tipos principales de cemento son el acelular (primario) y el celular (secundario). Ambos consisten en una matriz interfibrilar calcificada y fibrillas de colágeno. El acelular se forma primero y cubre el tercio cervical de la raíz.",
        },
        {
          id: "c6",
          question: "¿Cuál es el contenido inorgánico del cemento?",
          options: ["A. 97%.", "B. 70%.", "C. 65%.", "D. 45% a 50%."],
          correctIndex: 3,
          explanation:
            "El contenido inorgánico del cemento es del 45% al 50%, lo que es menor que el del hueso (65%), el esmalte (97%) o la dentina (70%).",
        },
        {
          id: "c7",
          question:
            "¿En qué porcentaje de casos el cemento solapa al esmalte en la unión cementoesmalte?",
          options: ["A. Aproximadamente 30%.", "B. Aproximadamente 60% a 65%.", "C. Aproximadamente 5% a 10%.", "D. Aproximadamente 90%."],
          correctIndex: 1,
          explanation:
            "En aproximadamente 60% a 65% de los casos, el cemento solapa al esmalte; en cerca del 30% existe una unión borde a borde; y en el 5% al 10% el cemento y el esmalte no se encuentran, lo que puede causar sensibilidad si hay recesión gingival.",
        },
        {
          id: "c8",
          question:
            "¿Cuál de los siguientes NO es un componente del proceso alveolar?",
          options: [
            "A. Placa externa de hueso cortical.",
            "B. Pared interna del alvéolo (hueso alveolar propiamente dicho/placa cribiforme).",
            "C. Trabéculas cancelosas.",
            "D. Pulpa dental.",
          ],
          correctIndex: 3,
          explanation:
            "El proceso alveolar consta de una placa externa de hueso cortical, la pared interna del alvéolo (hueso alveolar propiamente dicho o placa cribiforme) y trabéculas cancelosas entre estas dos capas compactas. La pulpa dental no forma parte del proceso alveolar.",
        },
        {
          id: "c9",
          question:
            "¿Cómo se llama el proceso en el que los osteoblastos y osteoclastos trabajan conjuntamente en la remodelación ósea?",
          options: ["A. Anquilosis.", "B. Acoplamiento (coupling).", "C. Hiperementosis.", "D. Atrofia por desuso."],
          correctIndex: 1,
          explanation:
            "La interdependencia de osteoblastos y osteoclastos en la remodelación se denomina acoplamiento (coupling). La resorción ósea por osteoclastos está acoplada con la formación ósea por osteoblastos, constituyendo un principio fundamental del remodelado óseo.",
        },
        {
          id: "c10",
          question:
            "¿Cuál es la diferencia entre fenestración y dehiscencia ósea?",
          options: [
            "A. La fenestración compromete el hueso marginal; la dehiscencia no.",
            "B. En la fenestración el hueso marginal está intacto; en la dehiscencia el área desnuda se extiende a través del hueso marginal.",
            "C. La fenestración ocurre solo en superficies linguales; la dehiscencia solo en vestibulares.",
            "D. No hay diferencia entre ambas.",
          ],
          correctIndex: 1,
          explanation:
            "Las fenestraciones son áreas aisladas donde la raíz queda desnuda de hueso pero el hueso marginal está intacto. La dehiscencia ocurre cuando las áreas desnudas se extienden a través del hueso marginal. Ambas ocurren en aproximadamente el 20% de los dientes.",
        },
      ],
      },
    ],
  },
  "Módulo 2": {
    moduleId: "mod-2",
    title: "Módulo 2",
    theme: "Clasificación de la enfermedad periodontal (World Workshop 2017)",
    questionSets: [
      /* ─────── Set A — Esquema de clasificación y formas de periodontitis ─────── */
      {
        subtopicSlug: "clasificacion_2017",
        questions: [
        {
          id: "m2a1",
          question:
            "¿Cuál fue el cambio principal en la clasificación de la periodontitis según el World Workshop de 2017?",
          options: [
            "A. Creó cinco nuevas categorías de periodontitis.",
            "B. Agrupó la periodontitis «crónica» y «agresiva» en una sola categoría.",
            "C. Eliminó la categoría de periodontitis necrosante.",
            "D. Clasificó la periodontitis únicamente por edad de inicio.",
          ],
          correctIndex: 1,
          explanation:
            "El World Workshop de 2017 agrupó las formas antes reconocidas como «crónica» o «agresiva» en una sola categoría («periodontitis»), ya que la evidencia actual no las respalda como dos enfermedades patofisiológicamente distintas.",
        },
        {
          id: "m2a2",
          question:
            "¿Cuántas formas de periodontitis se identificaron según la patofisiología en la clasificación de 2017?",
          options: ["A. Dos.", "B. Tres.", "C. Cuatro.", "D. Cinco."],
          correctIndex: 1,
          explanation:
            "Según la patofisiología se identificaron tres formas: periodontitis necrosante, periodontitis como manifestación directa de enfermedades sistémicas y periodontitis (el grupo principal que engloba las antiguas formas crónica y agresiva).",
        },
        {
          id: "m2a3",
          question:
            "¿Qué organizaciones patrocinaron conjuntamente el World Workshop de 2017?",
          options: [
            "A. La AAP y la OMS.",
            "B. La EFP y la OMS.",
            "C. La AAP y la EFP.",
            "D. La ADA y la AAP.",
          ],
          correctIndex: 2,
          explanation:
            "El taller fue co-patrocinado por la American Academy of Periodontology (AAP) y la European Federation of Periodontology (EFP), con participantes expertos de todo el mundo.",
        },
        {
          id: "m2a4",
          question:
            "¿Qué parámetro debe ser el principal para establecer los umbrales de gingivitis según el World Workshop de 2017?",
          options: [
            "A. Profundidad de sondaje.",
            "B. Pérdida de inserción clínica.",
            "C. Sangrado al sondaje.",
            "D. Pérdida ósea radiográfica.",
          ],
          correctIndex: 2,
          explanation:
            "El taller acordó que el sangrado al sondaje (BOP) debe ser el parámetro principal para establecer los umbrales de gingivitis.",
        },
        {
          id: "m2a5",
          question:
            "¿Cuál de las siguientes NO es una de las tres formas de periodontitis identificadas por patofisiología en 2017?",
          options: [
            "A. Periodontitis necrosante.",
            "B. Periodontitis como manifestación de enfermedad sistémica.",
            "C. Periodontitis crónica.",
            "D. Periodontitis.",
          ],
          correctIndex: 2,
          explanation:
            "La clasificación de 2017 eliminó la «periodontitis crónica» como categoría separada. Las tres formas son: periodontitis necrosante, periodontitis como manifestación de enfermedad sistémica, y periodontitis (que incluye las antiguas formas crónica y agresiva).",
        },
        {
          id: "m2a6",
          question: "¿Qué término reemplazó a «ancho biológico» en la nueva clasificación?",
          options: [
            "A. Tejidos unidos supracrestales.",
            "B. Longitud del epitelio de unión.",
            "C. Inserción de tejido conectivo.",
            "D. Profundidad sulcular.",
          ],
          correctIndex: 0,
          explanation:
            "El término «ancho biológico» (biologic width) fue reemplazado por «tejidos unidos supracrestales» (supracrestal attached tissues) en la nueva clasificación.",
        },
        {
          id: "m2a7",
          question: "¿Qué término reemplazó a «fuerza oclusal excesiva»?",
          options: [
            "A. Fuerza oclusal funcional.",
            "B. Fuerza oclusal traumática.",
            "C. Fuerza oclusal patológica.",
            "D. Fuerza oclusal adaptativa.",
          ],
          correctIndex: 1,
          explanation:
            "«Fuerza oclusal traumática» (traumatic occlusal force) reemplazó a «fuerza oclusal excesiva», definida como la fuerza que excede la capacidad adaptativa del periodonto y/o de los dientes.",
        },
        {
          id: "m2a8",
          question: "¿Qué término reemplazó a «biotipo periodontal»?",
          options: [
            "A. Fenotipo gingival.",
            "B. Fenotipo periodontal.",
            "C. Biotipo gingival.",
            "D. Fenotipo mucogingival.",
          ],
          correctIndex: 1,
          explanation:
            "El término «biotipo periodontal» fue reemplazado por «fenotipo periodontal» (periodontal phenotype) en el informe de consenso.",
        },
        {
          id: "m2a9",
          question:
            "¿Cuál es la definición de caso de periodontitis en el contexto de la atención clínica?",
          options: [
            "A. Pérdida de inserción interdental ≥1 mm en un diente.",
            "B. Pérdida de inserción interdental detectable en ≥2 dientes no adyacentes, o pérdida de inserción vestibular/lingual ≥3 mm con sondaje >3 mm en ≥2 dientes.",
            "C. Profundidad de sondaje ≥4 mm en cualquier sitio.",
            "D. Pérdida ósea radiográfica en un solo diente.",
          ],
          correctIndex: 1,
          explanation:
            "Un paciente es caso de periodontitis si la pérdida de inserción interdental es detectable en ≥2 dientes no adyacentes, o si hay pérdida de inserción vestibular/lingual ≥3 mm con sondaje >3 mm en ≥2 dientes, y la pérdida de inserción no puede atribuirse a causas no relacionadas con periodontitis.",
        },
        {
          id: "m2a10",
          question:
            "¿Cuál de las siguientes NO es una causa de pérdida de inserción que debe excluirse al diagnosticar periodontitis?",
          options: [
            "A. Recesión gingival de origen traumático.",
            "B. Caries dental que se extiende a la región cervical.",
            "C. Lesión endodóntica que drena a través del periodonto marginal.",
            "D. Periodontitis agresiva.",
          ],
          correctIndex: 3,
          explanation:
            "Las causas no periodontales de pérdida de inserción que deben excluirse incluyen: recesión de origen traumático, caries cervicales, pérdida de inserción asociada a malposición/extracción del tercer molar, lesiones endodónticas que drenan por el periodonto y fractura radicular vertical. La periodontitis agresiva ya no es una categoría separada.",
        },
      ],
      },

      /* ─────── Set B — Estadificación y gradación de la periodontitis ─────── */
      {
        subtopicSlug: "staging_grading",
        questions: [
        {
          id: "m2b1",
          question: "¿En qué depende principalmente la estadificación (staging) de la periodontitis?",
          options: [
            "A. De la edad del paciente.",
            "B. De la severidad al momento de presentación y la complejidad del manejo.",
            "C. De la tasa de progresión de la enfermedad.",
            "D. Del número de factores de riesgo presentes.",
          ],
          correctIndex: 1,
          explanation:
            "La estadificación depende principalmente de la severidad de la enfermedad al momento de presentación y de la complejidad del manejo, mientras que la gradación proporciona información complementaria sobre características biológicas.",
        },
        {
          id: "m2b2",
          question: "¿Cuántos estadios (stages) de periodontitis existen?",
          options: [
            "A. Tres (I, II, III).",
            "B. Cuatro (I, II, III, IV).",
            "C. Cinco (0, I, II, III, IV).",
            "D. Seis (I a VI).",
          ],
          correctIndex: 1,
          explanation:
            "La estadificación comprende cuatro categorías (estadios I a IV), determinadas tras considerar la pérdida de inserción clínica, la pérdida ósea, la profundidad de sondaje y otros factores de complejidad.",
        },
        {
          id: "m2b3",
          question: "¿Qué indica la gradación (grading) de la periodontitis?",
          options: [
            "A. La severidad de la pérdida de inserción.",
            "B. La tasa de progresión de la enfermedad.",
            "C. El número de dientes afectados.",
            "D. La edad de inicio de la enfermedad.",
          ],
          correctIndex: 1,
          explanation:
            "El grado debe utilizarse como indicador de la tasa de progresión de la periodontitis, siendo los criterios primarios la evidencia directa o indirecta de progresión.",
        },
        {
          id: "m2b4",
          question: "¿Cuántos grados (grades) de periodontitis existen?",
          options: [
            "A. Dos (A, B).",
            "B. Tres (A, B, C).",
            "C. Cuatro (A, B, C, D).",
            "D. Cinco (1 a 5).",
          ],
          correctIndex: 1,
          explanation:
            "La gradación incluye tres niveles: grado A (bajo riesgo), grado B (riesgo moderado) y grado C (alto riesgo de progresión).",
        },
        {
          id: "m2b5",
          question: "¿Qué grado debe asumir el clínico inicialmente por defecto?",
          options: ["A. Grado A.", "B. Grado B.", "C. Grado C.", "D. No hay defecto; debe calcularse."],
          correctIndex: 1,
          explanation:
            "Los clínicos deben asumir inicialmente grado B y buscar evidencia específica para cambiar hacia grado A o C, si está disponible.",
        },
        {
          id: "m2b6",
          question: "¿Qué caracteriza al Estadio I de periodontitis?",
          options: [
            "A. La forma más severa con pérdida dental.",
            "B. La frontera entre gingivitis y periodontitis, que representa pérdida de inserción temprana.",
            "C. Periodontitis con bolsas profundas que se extienden hasta el tercio medio de la raíz.",
            "D. Periodontitis con disfunción masticatoria.",
          ],
          correctIndex: 1,
          explanation:
            "El Estadio I es la frontera entre gingivitis y periodontitis, representa las etapas tempranas de pérdida de inserción en respuesta a la inflamación gingival persistente y la disbiosis del biofilm.",
        },
        {
          id: "m2b7",
          question: "¿Qué caracteriza al Estadio IV de periodontitis?",
          options: [
            "A. Pérdida de inserción temprana con lesiones superficiales.",
            "B. Periodontitis establecida manejable con tratamiento estándar.",
            "C. Daño significativo con lesiones profundas hasta el tercio medio radicular.",
            "D. Daño considerable con pérdida dental y pérdida de la función masticatoria.",
          ],
          correctIndex: 3,
          explanation:
            "En el Estadio IV, la periodontitis causa daño considerable, pérdida dental significativa y pérdida de la función masticatoria. Sin el control adecuado y la rehabilitación, la dentición está en riesgo de perderse.",
        },
        {
          id: "m2b8",
          question: "¿Cuál es el criterio primario para determinar el grado (grade)?",
          options: [
            "A. La edad del paciente.",
            "B. Evidencia directa o indirecta de progresión.",
            "C. El número de dientes ausentes.",
            "D. El porcentaje de sangrado al sondaje.",
          ],
          correctIndex: 1,
          explanation:
            "Los criterios primarios para la gradación son la evidencia directa o indirecta de progresión. Cuando se dispone de evidencia directa, se utiliza; en su ausencia, la estimación indirecta usa la pérdida ósea en función de la edad (RBL/edad).",
        },
        {
          id: "m2b9",
          question: "¿Qué fórmula se utiliza para la estimación indirecta del grado?",
          options: [
            "A. Pérdida de inserción × edad.",
            "B. RBL/edad (pérdida ósea radiográfica como porcentaje de longitud radicular dividida por la edad).",
            "C. Profundidad de sondaje × número de dientes.",
            "D. %BOP × pérdida de inserción.",
          ],
          correctIndex: 1,
          explanation:
            "En ausencia de evidencia directa, la estimación indirecta se realiza usando la pérdida ósea radiográfica como porcentaje de la longitud radicular dividida por la edad del sujeto (RBL/edad) en el diente más afectado.",
        },
        {
          id: "m2b10",
          question: "¿Qué factores de riesgo pueden modificar el grado?",
          options: [
            "A. Únicamente el tabaquismo.",
            "B. Únicamente la diabetes.",
            "C. Tabaquismo y diabetes (niveles de HbA1c).",
            "D. Edad y género.",
          ],
          correctIndex: 2,
          explanation:
            "Una vez establecido el grado con base en la evidencia de progresión, puede modificarse según la presencia de factores de riesgo, particularmente el tabaquismo y el nivel de control metabólico de la diabetes (HbA1c).",
        },
      ],
      },

      /* ─── Set C — Salud periodontal, gingivitis y progresión de la enfermedad ─── */
      {
        subtopicSlug: "progression_rate",
        questions: [
        {
          id: "m2c1",
          question: "¿Cómo se define la salud periodontal en la clasificación de 2017?",
          options: [
            "A. Ausencia de placa dental.",
            "B. Ausencia de inflamación clínicamente detectable.",
            "C. Profundidades de sondaje de 0-1 mm.",
            "D. Ausencia completa de respuesta inmune.",
          ],
          correctIndex: 1,
          explanation:
            "La salud periodontal se define por la ausencia de inflamación clínicamente detectable. Existe un nivel biológico de vigilancia inmunológica compatible con la salud gingival clínica y la homeostasis.",
        },
        {
          id: "m2c2",
          question: "¿Cuál es el umbral de BOP para definir salud gingival en un periodonto intacto?",
          options: ["A. <5%.", "B. <10%.", "C. <15%.", "D. <20%."],
          correctIndex: 1,
          explanation:
            "Para un periodonto intacto y un periodonto reducido y estable, la salud gingival se define como <10% de sitios con sangrado con profundidades de sondaje ≤3 mm.",
        },
        {
          id: "m2c3",
          question: "¿Qué umbral de profundidad de sondaje define la salud en un paciente con periodontitis tratada y estable?",
          options: [
            "A. ≤2 mm.",
            "B. ≤3 mm.",
            "C. ≤4 mm (sin ningún sitio ≥4 mm con sangrado).",
            "D. ≤5 mm.",
          ],
          correctIndex: 2,
          explanation:
            "En un paciente con periodontitis tratada con éxito y estable, la salud se caracteriza por profundidades de sondaje ≤4 mm sin ningún sitio ≥4 mm que sangre al sondaje, y BOP <10%.",
        },
        {
          id: "m2c4",
          question: "¿Qué porcentaje de sitios con sangrado define la gingivitis localizada?",
          options: ["A. <10%.", "B. 10%-30%.", "C. 30%-50%.", "D. >50%."],
          correctIndex: 1,
          explanation:
            "La gingivitis localizada se define como 10%-30% de sitios con sangrado; la gingivitis generalizada se define como >30% de sitios con sangrado.",
        },
        {
          id: "m2c5",
          question: "¿Cuál fue la pérdida de inserción media anual encontrada en la población general?",
          options: [
            "A. 0,01 mm por año.",
            "B. 0,1 mm por año.",
            "C. 0,5 mm por año.",
            "D. 1,0 mm por año.",
          ],
          correctIndex: 1,
          explanation:
            "El meta-análisis mostró una pérdida de inserción media anual de 0,1 mm por año (IC 95% 0,068-0,132) en la población general, incluyendo personas con y sin periodontitis.",
        },
        {
          id: "m2c6",
          question: "¿Cuál fue la pérdida dental media anual encontrada en la revisión sistemática?",
          options: [
            "A. 0,02 dientes por año.",
            "B. 0,2 dientes por año.",
            "C. 1,0 dientes por año.",
            "D. 2,0 dientes por año.",
          ],
          correctIndex: 1,
          explanation:
            "La pérdida dental media anual fue de 0,2 dientes por año (IC 95% 0,10-0,33) en la revisión sistemática de estudios longitudinales.",
        },
        {
          id: "m2c7",
          question: "¿Qué factor se asoció con una pérdida de inserción media anual más de tres veces mayor?",
          options: [
            "A. La edad.",
            "B. El género.",
            "C. La ubicación geográfica (economías en desarrollo vs desarrolladas).",
            "D. El estado de tabaquismo.",
          ],
          correctIndex: 2,
          explanation:
            "La ubicación geográfica se asoció con una pérdida de inserción media anual más de tres veces mayor en Sri Lanka y China (0,20 mm) en comparación con Norteamérica y Europa (0,056 mm), P<0,001.",
        },
        {
          id: "m2c8",
          question: "¿Tuvieron la edad o el género un efecto significativo sobre el cambio del nivel de inserción?",
          options: [
            "A. Sí, ambos tuvieron efectos significativos.",
            "B. Solo la edad tuvo un efecto significativo.",
            "C. Solo el género tuvo un efecto significativo.",
            "D. No, ninguno de los dos tuvo un efecto discernible.",
          ],
          correctIndex: 3,
          explanation:
            "Hubo sorprendentemente poco efecto de la edad o el género sobre el cambio del nivel de inserción. Ni la edad ni el sexo tuvieron efectos discernibles sobre el cambio de la pérdida de inserción clínica.",
        },
        {
          id: "m2c9",
          question: "¿Cuáles son las tres características clínicas típicas de las enfermedades periodontales necrosantes?",
          options: [
            "A. Formación de bolsas, sangrado y recesión.",
            "B. Necrosis de papilas, sangrado y dolor.",
            "C. Movilidad, compromiso de furcación y sangrado.",
            "D. Inflamación, enrojecimiento y halitosis.",
          ],
          correctIndex: 1,
          explanation:
            "Las enfermedades periodontales necrosantes se caracterizan por tres características clínicas típicas: necrosis de las papilas interdentales, sangrado y dolor, y se asocian con alteraciones de la respuesta inmune del huésped.",
        },
        {
          id: "m2c10",
          question: "¿Cuál es la definición de absceso periodontal?",
          options: [
            "A. Una inflamación crónica del margen gingival.",
            "B. Una acumulación localizada de pus dentro de la pared gingival del bolsillo/surco periodontal.",
            "C. Una infección aguda de la pulpa dental.",
            "D. Una comunicación entre los tejidos pulpares y periodontales.",
          ],
          correctIndex: 1,
          explanation:
            "Un absceso periodontal es una acumulación localizada de pus dentro de la pared gingival del bolsillo/surco periodontal, que provoca una destrucción tisular significativa. Ocurre con mayor frecuencia en bolsillos periodontales preexistentes.",
        },
      ],
      },
    ],
  },
};

export function getQuizForModule(moduleName: string): QuizModule | undefined {
  const normalized = moduleName.trim();
  // Exact match first.
  let data: QuizModuleData | undefined = QUIZ_DATA[normalized];
  // Match by module number (e.g. "MÓDULO 1 · ..." -> "Módulo 1").
  if (!data) {
    const match = normalized.match(/M[oó]dulo\s*(\d+)/i);
    if (match) {
      const key = `Módulo ${match[1]}`;
      data = QUIZ_DATA[key];
    }
  }
  // No quiz available for this module — return undefined so the UI shows "próximamente".
  if (!data) return undefined;

  // Mix questions from ALL subtopic sets so every attempt contributes to
  // every subtopic's competency score. Take a few from each set, stamp each
  // question with its subtopicSlug, then shuffle the combined list.
  const QUESTIONS_PER_SET = 4;
  const mixed: TaggedQuizQuestion[] = [];
  for (const set of data.questionSets) {
    const picked = shuffle(set.questions).slice(0, QUESTIONS_PER_SET);
    for (const q of picked) {
      mixed.push({ ...q, subtopicSlug: set.subtopicSlug });
    }
  }
  const questions = shuffle(mixed);

  return {
    moduleId: data.moduleId,
    title: data.title,
    theme: data.theme,
    questions,
  };
}
